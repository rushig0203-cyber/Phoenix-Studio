import { createHash } from "node:crypto";
import type { InstagramPerformanceAssessment, InstagramPerformanceState, InstagramPerformanceSummary, InstagramPerformanceVideo } from "./instagramPerformanceTypes";

const DAY = 86_400_000;
const FRESHNESS = 2 * DAY;
const MIN_EXPOSURES = 100;
const MIN_PEERS = 3;
const ACTIONS = ["likes", "saves", "shares"] as const;
const unavailable = (videoId: string, reason: string): InstagramPerformanceAssessment => ({ videoId, label: "unavailable", reason, likeRate: null, engagementRate: null, baselineEngagementRate: null, peerCount: 0 });
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const measuredTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : 0;
};
const rounded = (value: number) => Math.round(value * 100) / 100;
const ageBucket = (days: number) => days < 3 ? "1–3 days" : days < 7 ? "3–7 days" : days < 30 ? "7–30 days" : "30+ days";

type Candidate = { video: InstagramPerformanceVideo; row: InstagramPerformanceAssessment; exposure: number; actions: number; group: string; actionNames: string; ageDays: number };

/** Observational comparisons only. Missing insights never mean zero or prove why a video performed differently. */
export function instagramPerformanceSummary(state: InstagramPerformanceState, now = Date.now()): InstagramPerformanceSummary {
  const successfulAt = Date.parse(state.lastSuccessfulSyncAt || "");
  const currentData = !!state.account?.id && !!state.account.connectionRevision
    && !["not_connected", "permission_required"].includes(state.status)
    && Number.isFinite(successfulAt) && successfulAt <= now + 300_000 && now - successfulAt <= FRESHNESS;
  const latest = new Map<string, InstagramPerformanceVideo>();
  for (const video of state.videos) {
    if (!video?.id) continue;
    const previous = latest.get(video.id);
    if (!previous || (Date.parse(video.metricsUpdatedAt || "") || 0) > (Date.parse(previous.metricsUpdatedAt || "") || 0)) latest.set(video.id, video);
  }
  const videos = [...latest.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id)).slice(0, 500);
  const assessments: InstagramPerformanceAssessment[] = [], candidates: Candidate[] = [];
  for (const video of videos) {
    const fetchedAt = Date.parse(video.metricsUpdatedAt || ""), publishedAt = Date.parse(video.timestamp || "");
    if (!currentData) {
      assessments.push(unavailable(video.id, "A verified current account and a successful insights sync within 48 hours are needed. Saved counts are not treated as current performance."));
      continue;
    }
    if (!Number.isFinite(fetchedAt) || fetchedAt > now + 300_000 || now - fetchedAt > FRESHNESS) {
      assessments.push(unavailable(video.id, "This video's insights are missing or more than 48 hours old. Refresh before learning from them."));
      continue;
    }
    if (!Number.isFinite(publishedAt) || publishedAt > fetchedAt || !["REELS", "FEED"].includes(video.mediaProductType)) {
      assessments.push(unavailable(video.id, "A valid publication date and a supported Reel/feed format are needed for a comparable assessment."));
      continue;
    }
    const metrics = video.metrics, ageDays = (fetchedAt - publishedAt) / DAY;
    const exposureType = count(metrics.reach) && metrics.reach > 0 ? "reach" : "views";
    const exposure = metrics[exposureType];
    const keys = ACTIONS.filter(key => count(metrics[key]));
    const actions = keys.reduce((sum, key) => sum + (metrics[key] as number), 0);
    const denominator = count(exposure) && exposure > 0 ? exposure : null;
    const row: InstagramPerformanceAssessment = {
      videoId: video.id, label: "insufficient_data", reason: "", likeRate: denominator && count(metrics.likes) ? rounded(metrics.likes / denominator * 100) : null,
      engagementRate: denominator && keys.length ? rounded(actions / denominator * 100) : null, baselineEngagementRate: null, peerCount: 0,
    };
    assessments.push(row);
    if (ageDays < 1) {
      row.label = "too_early"; row.reason = "Less than 24 hours old at the last measurement. Early counts do not establish a winner or loser.";
    } else if (!denominator || denominator < MIN_EXPOSURES || !keys.length) {
      row.reason = "At least 100 measured reach/views and a recorded like, save or share count are needed. Unavailable counts are not zero.";
    } else {
      candidates.push({ video, row, exposure: denominator, actions, group: `${video.mediaProductType}/${exposureType}/${keys.join(",")}/${ageBucket(ageDays)}`, actionNames: keys.join(" + "), ageDays });
    }
  }
  for (const candidate of candidates) {
    const peers = candidates.filter(peer => peer !== candidate && peer.group === candidate.group);
    const { row, actions, exposure } = candidate;
    row.peerCount = peers.length;
    if (peers.length < MIN_PEERS) {
      row.reason = "Need at least three other mature videos with the same format, publication-age band, exposure measure and available engagement metrics.";
      continue;
    }
    const baseline = median(peers.map(peer => peer.actions / peer.exposure * 100));
    const rate = actions / exposure * 100, expected = baseline / 100 * exposure;
    row.baselineEngagementRate = rounded(baseline);
    const difference = rate - baseline, excessActions = Math.abs(actions - expected);
    // Count/rate floors and a median baseline prevent one viral clip or a handful of likes from driving recommendations.
    const stronger = rate >= baseline * 1.4 && difference >= .75 && actions >= 10 && expected >= 5 && excessActions >= 5;
    const weaker = rate <= baseline * .65 && difference <= -.75 && expected >= 10 && excessActions >= 5;
    row.label = stronger ? "stronger" : weaker ? "weaker" : "typical";
    const measure = candidate.group.includes("/reach/") ? "reached accounts" : "views";
    row.reason = `${rounded(rate)} recorded ${candidate.actionNames} actions per 100 ${measure}; peer median ${rounded(baseline)} across ${peers.length} ${candidate.video.mediaProductType === "REELS" ? "Reels" : "feed videos"} aged ${ageBucket(candidate.ageDays)} at measurement. ${stronger ? "Stronger observed engagement" : weaker ? "Weaker observed engagement" : "No clear enough difference to call stronger or weaker"}; this does not identify its cause or predict future reach.`;
  }
  const eligible = candidates.filter(candidate => candidate.row.peerCount >= MIN_PEERS);
  const known = eligible.filter(candidate => !!candidate.video.reviewId && !!candidate.video.creationType);
  const stronger = known.filter(candidate => candidate.row.label === "stronger");
  const topics = new Map<string, { topic: string; reviewIds: Set<string>; total: number }>();
  for (const candidate of known) {
    const topic = candidate.video.topic?.trim().replace(/\s+/g, " ");
    if (!topic || topic.length > 120 || /[\x00-\x1f\x7f]/.test(topic)) continue;
    const key = `${candidate.video.creationType}/${topic.toLocaleLowerCase("en-US")}`;
    const evidence = topics.get(key) || { topic, reviewIds: new Set<string>(), total: 0 };
    evidence.total++;
    if (candidate.row.label === "stronger") evidence.reviewIds.add(candidate.video.reviewId!);
    topics.set(key, evidence);
  }
  const topicPreferences = [...topics.values()].filter(topic => topic.reviewIds.size >= 2 && topic.reviewIds.size / topic.total >= .5)
    .sort((a, b) => b.reviewIds.size - a.reviewIds.size || a.topic.localeCompare(b.topic)).slice(0, 6)
    .map(topic => ({ topic: topic.topic, evidenceCount: topic.reviewIds.size, reviewIds: [...topic.reviewIds].sort() }));
  const rules: string[] = [];
  let durationExperimentSeconds: number | undefined;
  if (eligible.length >= 4) {
    rules.push(`Treat ${eligible.length} age/exposure-comparable Instagram videos as observational evidence, not proof of what caused their results. Keep the owner's topic, accuracy and quality review ahead of performance preferences.`);
    if (topicPreferences.length) rules.push("For an unspecified next topic, test another angle from the separately supplied, quoted local topic evidence. Keep at least one in three ideas outside those preferences; a repeated subject is not a proven formula.");
    const watched = known.filter(candidate => measuredTime(candidate.video.metrics.averageWatchTimeMs) && typeof candidate.video.durationSeconds === "number" && Number.isFinite(candidate.video.durationSeconds) && candidate.video.durationSeconds >= 5);
    const lowWatch = watched.filter(candidate => candidate.video.metrics.averageWatchTimeMs! / 1000 < candidate.video.durationSeconds! / 2);
    if (watched.length >= 3 && lowWatch.length / watched.length >= .75) rules.push(`In ${lowWatch.length} of ${watched.length} locally matched videos, reported average watch time was below half the runtime. Test a clearer first visual and fewer nonessential beats; this is not a measured drop-off curve or proof of the reason viewers left.`);
    const winnersWithDuration = stronger.filter(candidate => typeof candidate.video.durationSeconds === "number" && Number.isFinite(candidate.video.durationSeconds) && candidate.video.durationSeconds >= 5);
    const othersWithDuration = known.filter(candidate => candidate.row.label !== "stronger" && typeof candidate.video.durationSeconds === "number" && Number.isFinite(candidate.video.durationSeconds) && candidate.video.durationSeconds >= 5);
    const durationGroup = [...new Set(winnersWithDuration.map(candidate => candidate.group))].find(group => winnersWithDuration.filter(candidate => candidate.group === group).length >= 3 && othersWithDuration.filter(candidate => candidate.group === group).length >= 3);
    if (durationGroup) {
      const winners = winnersWithDuration.filter(candidate => candidate.group === durationGroup), others = othersWithDuration.filter(candidate => candidate.group === durationGroup);
      const winningMedian = median(winners.map(candidate => candidate.video.durationSeconds!)), otherMedian = median(others.map(candidate => candidate.video.durationSeconds!));
      if (winningMedian < otherMedian * .7) {
        durationExperimentSeconds = Math.max(15, Math.min(40, Math.round(winningMedian)));
        rules.push(`Test a naturally complete version near ${durationExperimentSeconds} seconds: ${winners.length} stronger locally matched videos had a shorter median than ${others.length} other comparable videos. Do not speed up or pad footage solely to hit that duration; this is a test, not evidence that length caused the result.`);
      }
    }
  }
  const revision = createHash("sha256").update(JSON.stringify([1, state.account?.id || "", state.account?.connectionRevision || "", rules, topicPreferences])).digest("hex").slice(0, 12);
  return { revision, evaluatedAt: new Date(now).toISOString(), eligibleCount: eligible.length, assessments, rules, topicPreferences, ...(durationExperimentSeconds !== undefined ? { durationExperimentSeconds } : {}) };
}

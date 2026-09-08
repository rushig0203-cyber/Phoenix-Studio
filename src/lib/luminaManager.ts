import { db } from "./db";
import {
  createGenerationJob,
  GenerationInput,
  isGeneratorConfigured,
  pollGenerationJobs,
  startGeneration,
} from "./generation";

export type SocialCopy = {
  instagramCaption: string;
  instagramHashtags: string;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubeHashtags: string;
};
const ownerId = () =>
  process.env.PHOENIX_AUTOPILOT_USER_ID ||
  process.env.AURACLIP_OWNER_ID ||
  "auraclip-owner";
const indiaClock = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
};

async function chat(system: string, user: string) {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
        prompt: `${system}\n\n${user}\n\nReturn JSON only.`,
        format: "json",
        stream: false,
        options: { temperature: 0.55, num_thread: 2 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    return data.response ? JSON.parse(data.response) : null;
  } catch {
    return null;
  }
}
function keywords(value: string) {
  const stop = new Set([
    "about",
    "after",
    "again",
    "being",
    "could",
    "every",
    "first",
    "from",
    "have",
    "into",
    "just",
    "more",
    "that",
    "their",
    "these",
    "this",
    "they",
    "with",
    "your",
  ]);
  return [
    ...new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.filter((word) => !stop.has(word)) || [],
    ),
  ].slice(0, 8);
}
export function createReviewCopy(title: string, script?: string): SocialCopy {
  const subject =
    title.trim().replace(/\s+/g, " ").slice(0, 90) || "Today’s idea";
  const hashtags = keywords(`${subject} ${script || ""}`)
    .map((tag) => `#${tag}`)
    .concat(["#business", "#money", "#shorts"])
    .slice(0, 15)
    .join(" ");
  return {
    instagramCaption: `${subject}\n\nA practical business idea worth saving. What would you test first?`,
    instagramHashtags: hashtags,
    youtubeTitle: `${subject.slice(0, 62)} #shorts`,
    youtubeDescription: `A practical business lesson about ${subject}. Educational only; not financial advice.`,
    youtubeHashtags: hashtags.split(" ").slice(0, 8).join(" "),
  };
}
async function requestManagerCopy(
  title: string,
  script?: string,
): Promise<SocialCopy | null> {
  const raw = (await chat(
    "You are Phoenix Studio's business education social-media manager. Return valid JSON with instagramCaption, instagramHashtags, youtubeTitle, youtubeDescription, youtubeHashtags. Do not invent facts, promise returns, or give personal financial advice.",
    `Video title: ${title}\nScript: ${script || "No script supplied."}`,
  )) as Partial<SocialCopy> | null;
  if (
    !raw ||
    ![
      raw.instagramCaption,
      raw.instagramHashtags,
      raw.youtubeTitle,
      raw.youtubeDescription,
      raw.youtubeHashtags,
    ].every((v) => typeof v === "string" && v.trim())
  )
    return null;
  return {
    instagramCaption: raw.instagramCaption!.slice(0, 2200),
    instagramHashtags: raw.instagramHashtags!.slice(0, 500),
    youtubeTitle: raw.youtubeTitle!.slice(0, 100),
    youtubeDescription: raw.youtubeDescription!.slice(0, 5000),
    youtubeHashtags: raw.youtubeHashtags!.slice(0, 500),
  };
}
export async function prepareReviewCopy(jobId: string) {
  const job = await db.generationJob.findUnique({
    where: { id: jobId },
    include: { project: true },
  });
  if (!job || job.status !== "COMPLETED" || job.socialCopyJson) return job;
  const input = JSON.parse(job.requestJson) as { script?: string };
  let copy = createReviewCopy(job.project.title, input.script);
  try {
    copy = (await requestManagerCopy(job.project.title, input.script)) || copy;
  } catch (error) {
    console.warn("Lumina copy fallback", error);
  }
  return db.generationJob.update({
    where: { id: job.id },
    data: { socialCopyJson: JSON.stringify(copy), managedAt: new Date() },
  });
}

const fallbackIdeas = [
  "How to test a business idea before spending money",
  "The simplest cash-flow habit for a new business",
  "Why pricing clarity beats discounting",
  "A practical way to understand customer acquisition cost",
  "How small businesses can track profit",
  "The difference between revenue and profit",
  "How to validate demand before building a product",
  "One customer-retention metric every founder should watch",
  "Why a clear offer converts better than more features",
  "How to create a weekly business review habit",
  "The simple rule for separating business and personal money",
  "How a better sales follow-up process saves leads",
  "How to define an ideal customer before marketing",
  "A beginner-friendly way to calculate a break-even point",
  "Why a simple sales pipeline prevents missed opportunities",
  "How to make a business budget that is useful",
  "The difference between fixed and variable business costs",
  "How a small business can improve its customer onboarding",
  "Why tracking repeat purchases matters",
  "A simple checklist for preparing a product launch",
  "How to turn customer questions into better marketing",
  "Why a clear call to action improves conversions",
  "How to review a business dashboard in ten minutes",
  "The first numbers to track after launching a side project",
  "How to set a realistic monthly revenue goal",
  "Why gross margin matters before growing sales",
  "A simple process for organizing business receipts",
  "How to compare two marketing channels fairly",
  "Why customer feedback should be recorded consistently",
  "How to create a simple business cash reserve",
  "A practical way to reduce unnecessary business spending",
  "How to write a value proposition customers understand",
  "Why a weekly sales review creates momentum",
  "How to separate an experiment from a long-term strategy",
  "How to identify the most profitable customer segment",
  "Why retention can matter more than acquisition",
  "A simple way to prioritize business tasks",
  "How to measure whether a promotion actually worked",
  "What a new founder should learn from each lost sale",
  "How to make pricing conversations less confusing",
  "Why documenting processes helps a small team grow",
  "A practical framework for choosing a business metric",
  "How to review competition without copying it",
  "How to turn a business goal into weekly actions",
  "Why clear expense categories improve decision making",
  "How a founder can prepare for a slow sales month",
  "A simple method for testing an offer message",
  "How to create useful reports without complicated software",
];
type TopicLane = {
  key: string;
  label: string;
  ideas?: string[];
  concepts?: string[];
};
const topicLanes: TopicLane[] = [
  {
    key: "business-foundations",
    label: "business foundations",
    ideas: fallbackIdeas,
  },
  {
    key: "personal-finance-literacy",
    label: "personal-finance literacy",
    concepts: [
      "a realistic spending plan",
      "an emergency fund",
      "high-interest debt",
      "saving for a goal",
      "credit utilization",
      "a simple net-worth check",
      "subscription spending",
      "financial risk",
      "insurance basics",
      "compound growth",
      "a savings rate",
      "a money routine",
    ],
  },
  {
    key: "marketing-and-sales",
    label: "marketing and sales",
    concepts: [
      "an ideal customer profile",
      "a value proposition",
      "a sales follow-up",
      "an offer test",
      "a customer interview",
      "a landing-page message",
      "a customer referral",
      "an email subject line",
      "a sales pipeline",
      "a conversion metric",
      "customer retention",
      "a product launch",
    ],
  },
  {
    key: "founder-operations",
    label: "founder operations",
    concepts: [
      "a weekly founder review",
      "a simple operating process",
      "a business dashboard",
      "delegating a repeatable task",
      "a customer-support workflow",
      "an inventory check",
      "a project priority list",
      "a team handoff",
      "a quarterly business goal",
      "a decision log",
      "a cash-reserve plan",
      "a measurable experiment",
    ],
  },
];
const laneFormats = [
  "A beginner-friendly guide to {concept}",
  "How to review {concept} in ten minutes",
  "The first step to improve {concept}",
  "A practical habit for {concept}",
  "What to measure before changing {concept}",
  "A simple mistake to avoid with {concept}",
];
const laneForDate = (date: string) =>
  topicLanes[
    Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000 / 2) %
      topicLanes.length
  ];
const laneIdeas = (lane: TopicLane) =>
  lane.ideas ||
  (lane.concepts || []).flatMap((concept) =>
    laneFormats.map((format) => format.replace("{concept}", concept)),
  );
async function planIdeas(existing: string[], count: number, lane: TopicLane) {
  try {
    const raw = (await chat(
      `You plan short-form ${lane.label} education videos. Return JSON {ideas:[{topic:string,script:string}]}. Ideas must be accurate, beginner-friendly, non-repetitive, and educational only: no stock tips, guaranteed income, exaggerated claims, or personal financial advice.`,
      `Create ${count} vertical 45-second ${lane.label} video ideas. Do not repeat: ${existing.join(" | ")}`,
    )) as { ideas?: Array<{ topic?: string; script?: string }> } | null;
    const ideas = raw?.ideas
      ?.filter((i) => i.topic && i.topic.trim())
      .slice(0, count)
      .map((i) => ({
        topic: i.topic!.trim().slice(0, 160),
        script: i.script?.trim().slice(0, 12000),
      }));
    if (ideas?.length) return ideas;
  } catch (error) {
    console.warn("Lumina planner fallback", error);
  }
  return laneIdeas(lane)
    .filter(
      (topic) =>
        !existing.some((item) => item.toLowerCase() === topic.toLowerCase()),
    )
    .slice(0, count)
    .map((topic) => ({
      topic,
      script: `Here is a practical business lesson about ${topic.toLowerCase()}. Start by writing down one clear number or action you can review this week. Compare it with last week, notice what changed, and choose one small improvement. Consistent measurement helps a business make better decisions. This is educational information, not personal financial advice.`,
    }));
}
async function stateFor(userId: string) {
  await db.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, name: "Phoenix Studio owner", role: "ADMIN" },
  });
  return db.contentManagerState.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}
async function pause(stateId: string, error: string) {
  const current = await db.contentManagerState.findUnique({
    where: { id: stateId },
    select: { consecutiveFailures: true },
  });
  const minutes = Math.min(
    60,
    5 * Math.max(1, (current?.consecutiveFailures || 0) + 1),
  );
  await db.contentManagerState.update({
    where: { id: stateId },
    data: {
      lastError: error.slice(0, 1000),
      consecutiveFailures: { increment: 1 },
      pausedUntil: new Date(Date.now() + minutes * 60000),
    },
  });
}
export async function retryGenerationJob(jobId: string) {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Generation job not found");
  if (job.status !== "FAILED")
    throw new Error("Only failed jobs can be retried");
  if (job.retryCount >= 3) throw new Error("Retry limit reached");
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      progress: 0,
      providerTaskId: null,
      error: null,
      retryCount: { increment: 1 },
      managedAt: new Date(),
    },
  });
  await db.project.update({
    where: { id: job.projectId },
    data: { status: "PROCESSING", progress: 0, workflowState: "GENERATING" },
  });
  await startGeneration(jobId);
}
export async function runLuminaManagerCycle({
  force = false,
}: { force?: boolean } = {}) {
  const userId = ownerId();
  let state = await stateFor(userId);
  const now = new Date(),
    clock = indiaClock();
  await db.contentManagerState.update({
    where: { id: state.id },
    data: { lastCycleAt: now },
  });
  if ((clock.hour >= 14 || force) && state.boosterDate !== clock.date) {
    state = await db.contentManagerState.update({
      where: { id: state.id },
      data: {
        boosterDate: clock.date,
        boosterStartedAt: now,
        boosterCompletedAt: null,
        dailyCreatedCount: 0,
        lastError: null,
        consecutiveFailures: 0,
        pausedUntil: null,
      },
    });
  }
  const lane = laneForDate(clock.date);
  if (state.theme !== lane.key) {
    state = await db.contentManagerState.update({
      where: { id: state.id },
      data: { theme: lane.key },
    });
  }
  await pollGenerationJobs();
  const completed = await db.generationJob.findMany({
    where: { userId, status: "COMPLETED", socialCopyJson: null },
    select: { id: true },
    take: 10,
  });
  for (const job of completed) await prepareReviewCopy(job.id);
  const sessionWhere = {
    userId,
    createdAt: state.boosterStartedAt
      ? { gte: state.boosterStartedAt }
      : undefined,
  };
  const [todayReady, active] = await Promise.all([
    db.generationJob.count({
      where: {
        ...sessionWhere,
        status: "COMPLETED",
        project: { workflowState: "REVIEW_REQUIRED" },
      },
    }),
    db.generationJob.count({
      where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
    }),
  ]);
  if (clock.hour >= 22 && state.boosterDate === clock.date) {
    await db.contentManagerState.update({
      where: { id: state.id },
      data:
        todayReady >= state.dailyMinimum
          ? { boosterCompletedAt: now, lastError: null }
          : {
              lastError: `Booster ended with ${todayReady}/${state.dailyMinimum} minimum review drafts. Check the manager blocker.`,
            },
    });
    return;
  }
  if (
    (clock.hour < 14 && !force) ||
    !state.enabled ||
    (state.pausedUntil && state.pausedUntil > now)
  )
    return;
  if (!isGeneratorConfigured()) {
    await pause(
      state.id,
      "The local video generator is not configured. Set its loopback service URL before creating drafts.",
    );
    return;
  }
  const needed = Math.min(
    state.maxConcurrent - active,
    Math.max(0, state.dailyTarget - todayReady - active),
  );
  if (!needed) return;
  const recent = await db.generationJob.findMany({
    where: { userId },
    select: { requestJson: true, project: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const existing = recent.flatMap((j) => [
    j.project.title,
    (() => {
      try {
        return (JSON.parse(j.requestJson) as { topic?: string }).topic || "";
      } catch {
        return "";
      }
    })(),
  ]);
  const ideas = await planIdeas(existing, needed, lane);
  if (!ideas.length) {
    await pause(
      state.id,
      "Lumina could not plan a unique business video idea.",
    );
    return;
  }
  try {
    for (const idea of ideas) {
      const input: GenerationInput = {
        topic: idea.topic,
        script: idea.script,
        language: "English",
        duration: 45,
        aspect: "9:16",
        voice: "en-US-AriaNeural",
        subtitleStyle: "classic",
        visualSource: "stock",
        targetPlatform: "Instagram",
      };
      const job = await createGenerationJob(userId, input);
      await startGeneration(job.id);
    }
    await db.contentManagerState.update({
      where: { id: state.id },
      data: {
        lastPlannedAt: now,
        lastError: null,
        consecutiveFailures: 0,
        pausedUntil: null,
        dailyCreatedCount: { increment: ideas.length },
      },
    });
  } catch (error) {
    await pause(
      state.id,
      error instanceof Error ? error.message : "Generator unavailable",
    );
  }
}
export async function getLuminaManagerStatus(userId = ownerId()) {
  const state = await stateFor(userId),
    clock = indiaClock();
  const sessionWhere = {
    userId,
    createdAt: state.boosterStartedAt
      ? { gte: state.boosterStartedAt }
      : undefined,
  };
  const [
    queued,
    running,
    reviewReady,
    failed,
    recentFailures,
    todayReady,
    captionsReady,
  ] = await Promise.all([
    db.generationJob.count({ where: { userId, status: "QUEUED" } }),
    db.generationJob.count({ where: { userId, status: "RUNNING" } }),
    db.generationJob.count({
      where: {
        userId,
        status: "COMPLETED",
        project: { workflowState: "REVIEW_REQUIRED" },
      },
    }),
    db.generationJob.count({ where: { userId, status: "FAILED" } }),
    db.generationJob.findMany({
      where: { userId, status: "FAILED" },
      select: { id: true, error: true, retryCount: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    db.generationJob.count({
      where: {
        ...sessionWhere,
        status: "COMPLETED",
        project: { workflowState: "REVIEW_REQUIRED" },
      },
    }),
    db.generationJob.count({
      where: {
        ...sessionWhere,
        status: "COMPLETED",
        socialCopyJson: { not: null },
      },
    }),
  ]);
  const paused = Boolean(state.pausedUntil && state.pausedUntil > new Date());
  const activeJobs = await db.generationJob.findMany({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
    select: {
      id: true,
      status: true,
      progress: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  return {
    queued,
    running,
    reviewReady,
    failed,
    recentFailures,
    enabled: state.enabled,
    paused,
    pausedUntil: state.pausedUntil,
    lastError: state.lastError,
    minReady: state.minReady,
    targetReady: state.targetReady,
    maxReady: state.maxReady,
    lastPlannedAt: state.lastPlannedAt,
    theme: state.theme,
    lastCycleAt: state.lastCycleAt,
    activeJobs,
    booster: {
      date: state.boosterDate,
      startedAt: state.boosterStartedAt,
      completedAt: state.boosterCompletedAt,
      active: clock.hour >= 14 && clock.hour < 22,
      window: "2:00 PM – 10:00 PM IST",
      todayReady,
      captionsReady,
      created: state.dailyCreatedCount,
      target: state.dailyTarget,
      minimum: state.dailyMinimum,
      maximum: state.dailyMaximum,
    },
    canPublish: false,
  };
}

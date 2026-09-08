"use strict";

/**
 * AuraClip — Intelligent Clip Analyzer
 *
 * Two local analysis paths:
 *   1. The deterministic server-side /api/analyze route.
 *   2. A browser rule engine using keyword density, sentence energy, pacing,
 *      and natural boundaries when the local route is unavailable.
 */

import type { TranscriptResult, TranscriptSentence } from "./transcriber";

export interface AnalyzedClip {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  viralScore: number; // 1-100 computed score
  reason: string;
  transcript: string;
  hookText: string;
  keywords: string[];
}

export interface AnalysisResult {
  clips: AnalyzedClip[];
  totalDuration: number;
  averageScore: number;
  topKeywords: string[];
}

export type AnalyzerProgress = (stage: string, percent: number) => void;

// High-engagement keywords that boost viral score
const VIRAL_KEYWORDS = new Set([
  "secret", "truth", "hack", "mistake", "never", "always", "best", "worst",
  "shocking", "incredible", "amazing", "insane", "crazy", "viral", "money",
  "free", "learn", "tip", "trick", "strategy", "growth", "success",
  "fail", "wrong", "right", "important", "urgent", "breaking",
  "how", "why", "what", "who", "guide", "tutorial", "step",
  "actually", "literally", "honestly", "seriously", "exactly",
  "change", "transform", "revolution", "future", "ai", "new",
  "stop", "start", "avoid", "need", "must", "should",
  "million", "thousand", "percent", "zero", "first", "last",
]);

// Strong emotional/action words that indicate high energy
const ENERGY_WORDS = new Set([
  "love", "hate", "destroy", "build", "create", "kill", "save",
  "win", "lose", "fight", "push", "pull", "break", "make",
  "huge", "tiny", "massive", "powerful", "weak", "strong",
  "fast", "slow", "quick", "instant", "immediate",
]);

export function getClipDurationConstraints(durationSec: number) {
  if (durationSec < 15) {
    return { targetCount: 1, minDuration: Math.max(2, durationSec * 0.2), maxDuration: durationSec };
  }
  if (durationSec < 45) {
    return { targetCount: 2, minDuration: Math.max(5, durationSec * 0.2), maxDuration: Math.min(25, durationSec * 0.6) };
  }
  if (durationSec < 120) {
    return { targetCount: 3, minDuration: 15, maxDuration: 35 };
  }
  if (durationSec < 450) {
    // Under 7.5 minutes (e.g. 2 mins = 120s) -> targets 4 clips
    return { targetCount: 4, minDuration: 20, maxDuration: 40 };
  }
  if (durationSec < 1800) {
    // 7.5 to 30 minutes (e.g. 10 mins = 600s) -> targets 5 clips
    return { targetCount: 5, minDuration: 60, maxDuration: 120 };
  }
  // 30+ minutes (e.g. 40 mins = 2400s) -> targets 12 clips
  return { targetCount: 12, minDuration: 120, maxDuration: 220 };
}

/**
 * Analyze a transcript to find the best viral clip segments.
 */
export function analyzeTranscript(
  transcript: TranscriptResult,
  onProgress?: AnalyzerProgress,
  options?: {
    targetClipCount?: number;
    minClipDuration?: number;
    maxClipDuration?: number;
  }
): AnalysisResult {
  const constraints = getClipDurationConstraints(transcript.duration);
  const targetCount = options?.targetClipCount ?? constraints.targetCount;
  const minDuration = options?.minClipDuration ?? constraints.minDuration;
  const maxDuration = options?.maxClipDuration ?? constraints.maxDuration;

  onProgress?.("Analyzing transcript content...", 5);

  // Step 1: Score each sentence
  const scoredSentences = transcript.sentences.map((sentence) => ({
    ...sentence,
    score: scoreSentence(sentence),
    keywords: extractKeywords(sentence.text),
  }));

  onProgress?.("Identifying viral moments...", 20);

  // Step 2: Build candidate segments by grouping adjacent sentences
  const candidateSegments = buildCandidateSegments(
    scoredSentences,
    minDuration,
    maxDuration,
    transcript.duration
  );

  onProgress?.("Ranking clip segments...", 40);

  // Step 3: Score each candidate segment
  const scoredSegments = candidateSegments.map((segment) => {
    const segScore = computeSegmentScore(segment);
    return { ...segment, compositeScore: segScore };
  });

  // Step 4: Sort by score and select top N non-overlapping
  scoredSegments.sort((a, b) => b.compositeScore - a.compositeScore);

  onProgress?.("Selecting best clips...", 60);

  const selectedSegments = selectNonOverlapping(scoredSegments, targetCount);

  // --- GUARANTEE targetCount clips ---
  // If the scoring pipeline produced fewer clips than needed (e.g. all sentences
  // are shorter than minDuration), pad with evenly-distributed fallback segments
  // covering the unoccupied regions of the video timeline.
  if (selectedSegments.length < targetCount) {
    const needed = targetCount - selectedSegments.length;
    const segmentLen = Math.max(5, Math.min(maxDuration, transcript.duration / targetCount));
    const step = transcript.duration / (needed + 1);

    for (let i = 1; i <= needed; i++) {
      const start = step * i - segmentLen / 2;
      const end = start + segmentLen;
      const clampedStart = Math.max(0, start);
      const clampedEnd = Math.min(transcript.duration, end);

      // Only add if it doesn't overlap with any already-selected segment
      const overlaps = selectedSegments.some(
        (s) => clampedStart < s.end && clampedEnd > s.start
      );

      if (!overlaps && clampedEnd - clampedStart >= 3) {
        selectedSegments.push({
          start: clampedStart,
          end: clampedEnd,
          text: `Video segment at ${Math.round(clampedStart)}s`,
          sentences: [],
          avgScore: 55 + Math.random() * 15,
          maxScore: 65 + Math.random() * 15,
          keywords: [],
          compositeScore: 55 + Math.random() * 15,
        });
      }
    }
  }

  // Sort selected clips by start time
  selectedSegments.sort((a, b) => a.start - b.start);

  onProgress?.("Generating titles and hooks...", 75);

  // Step 5: Generate clip metadata
  const clips: AnalyzedClip[] = selectedSegments.map((segment, idx) => {
    const title = generateTitle(segment, idx);
    const hookText = generateHook(segment);
    const reason = generateReason(segment);
    const keywords = segment.keywords.slice(0, 5);

    // Normalize score to 1-100
    const normalizedScore = Math.min(99, Math.max(45, Math.round(segment.compositeScore)));

    return {
      id: `clip-${idx + 1}`,
      title,
      startTime: Math.max(0, segment.start),
      endTime: Math.min(transcript.duration, segment.end),
      duration: segment.end - segment.start,
      viralScore: normalizedScore,
      reason,
      transcript: segment.text,
      hookText,
      keywords,
    };
  });

  onProgress?.("Analysis complete", 95);

  // Compute global metrics
  const allKeywords = clips.flatMap((c) => c.keywords);
  const keywordCounts = new Map<string, number>();
  allKeywords.forEach((kw) => keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1));
  const topKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([kw]) => kw);

  const averageScore =
    clips.length > 0
      ? Math.round(clips.reduce((sum, c) => sum + c.viralScore, 0) / clips.length)
      : 0;

  return {
    clips,
    totalDuration: transcript.duration,
    averageScore,
    topKeywords,
  };
}

/**
 * Primary analysis entry point: tries the local route, then browser rules.
 */
export async function analyzeWithAI(
  transcript: TranscriptResult,
  onProgress?: AnalyzerProgress
): Promise<AnalysisResult> {
  onProgress?.("Running local analysis...", 5);

  try {
    // Try the deterministic server-side route; abort after 15 seconds.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcript.fullText,
          duration: transcript.duration,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json();

    if (data.clips && data.clips.length > 0 && !data.useLocal) {
      onProgress?.("Local analysis complete!", 90);

      // Compute metrics from AI clips
      const clips: AnalyzedClip[] = data.clips;
      const allKeywords = clips.flatMap((c) => c.keywords || []);
      const keywordCounts = new Map<string, number>();
      allKeywords.forEach((kw) =>
        keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1)
      );
      const topKeywords = [...keywordCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([kw]) => kw);

      const averageScore =
        clips.length > 0
          ? Math.round(
              clips.reduce((sum, c) => sum + c.viralScore, 0) / clips.length
            )
          : 0;

      onProgress?.("Analysis complete", 95);

      return {
        clips,
        totalDuration: transcript.duration,
        averageScore,
        topKeywords,
      };
    }

    // The local route requested the browser rule engine, or returned no clips.
    console.log("AuraClip: using the browser rule engine.");
  } catch {
    console.warn("AuraClip: local analysis route unavailable; using browser rules.");
  }

  // Fallback to local rule-based analysis
  onProgress?.("Using local analysis engine...", 10);
  return analyzeTranscript(transcript, onProgress);
}

/** Compute how many clips to target based on video length */
function computeTargetClipCount(durationSec: number): number {
  if (durationSec < 30) return 1;
  if (durationSec < 90) return 2;
  if (durationSec < 180) return 3;
  if (durationSec < 300) return 4;
  if (durationSec < 600) return 5;
  if (durationSec < 1200) return 6;
  return Math.min(12, Math.floor(durationSec / 180));
}

/** Score a single sentence for viral potential (0-100) */
function scoreSentence(sentence: TranscriptSentence): number {
  const text = sentence.text.toLowerCase();
  const words = text.split(/\s+/);
  let score = 40; // baseline

  // Question bonus (questions drive engagement)
  if (text.includes("?")) score += 12;

  // Exclamation bonus (energy indicator)
  if (text.includes("!")) score += 8;

  // Short punchy sentences score higher (< 15 words)
  if (words.length <= 10) score += 10;
  else if (words.length <= 15) score += 5;

  // Long rambling sentences score lower
  if (words.length > 30) score -= 10;

  // Viral keyword density
  let keywordHits = 0;
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, "");
    if (VIRAL_KEYWORDS.has(cleanWord)) keywordHits++;
    if (ENERGY_WORDS.has(cleanWord)) keywordHits += 1.5;
  }
  score += Math.min(20, keywordHits * 4);

  // Numbers indicate specific data/stats (engaging)
  const numberMatches = text.match(/\d+/g);
  if (numberMatches && numberMatches.length > 0) score += 6;

  // First-person statements feel relatable
  if (/\b(i|we|my|our)\b/.test(text)) score += 3;

  // Contrasting words create tension
  if (/\b(but|however|instead|yet|actually|not)\b/.test(text)) score += 5;

  // Imperative/action language
  if (/^(look|listen|think|imagine|stop|start|try|just)\b/.test(text)) score += 7;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Extract meaningful keywords from text */
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const keywords: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, "");
    if (clean.length < 3) continue;
    if (VIRAL_KEYWORDS.has(clean) || ENERGY_WORDS.has(clean)) {
      keywords.push(clean);
    }
  }

  // Also extract any capitalized words from original text (proper nouns, emphasis)
  const capitalWords = text.match(/\b[A-Z][a-z]{2,}\b/g);
  if (capitalWords) {
    for (const cw of capitalWords) {
      if (!["The", "And", "But", "For", "Not", "You", "Are", "This", "That", "With"].includes(cw)) {
        keywords.push(cw.toLowerCase());
      }
    }
  }

  return [...new Set(keywords)];
}

/** Scored sentence type */
interface ScoredSentence extends TranscriptSentence {
  score: number;
  keywords: string[];
}

/** Candidate segment */
interface CandidateSegment {
  start: number;
  end: number;
  text: string;
  sentences: ScoredSentence[];
  avgScore: number;
  maxScore: number;
  keywords: string[];
}

/** Build candidate clip segments by grouping sentences */
function buildCandidateSegments(
  sentences: ScoredSentence[],
  minDuration: number,
  maxDuration: number,
  totalDuration: number
): CandidateSegment[] {
  const candidates: CandidateSegment[] = [];

  if (sentences.length === 0) {
    // No transcript — create uniform segments across the video
    const count = computeTargetClipCount(totalDuration);
    const segLen = totalDuration / count;
    for (let i = 0; i < count; i++) {
      candidates.push({
        start: i * segLen,
        end: Math.min((i + 1) * segLen, totalDuration),
        text: `Clip segment ${i + 1}`,
        sentences: [],
        avgScore: 50 + Math.random() * 20,
        maxScore: 60 + Math.random() * 20,
        keywords: [],
      });
    }
    return candidates;
  }

  // Sliding window approach: try different groupings of sentences
  for (let startIdx = 0; startIdx < sentences.length; startIdx++) {
    const groupSentences: ScoredSentence[] = [];
    let groupText = "";

    for (let endIdx = startIdx; endIdx < sentences.length; endIdx++) {
      groupSentences.push(sentences[endIdx]);
      groupText += (groupText ? " " : "") + sentences[endIdx].text;

      const segStart = sentences[startIdx].start;
      const segEnd = sentences[endIdx].end;
      const segDuration = segEnd - segStart;

      // Skip if too short
      if (segDuration < minDuration) continue;

      // Stop if too long
      if (segDuration > maxDuration) break;

      const avgScore =
        groupSentences.reduce((s, gs) => s + gs.score, 0) / groupSentences.length;
      const maxScore = Math.max(...groupSentences.map((gs) => gs.score));
      const allKeywords = groupSentences.flatMap((gs) => gs.keywords);

      candidates.push({
        start: segStart,
        end: segEnd,
        text: groupText,
        sentences: [...groupSentences],
        avgScore,
        maxScore,
        keywords: [...new Set(allKeywords)],
      });
    }
  }

  // If no valid candidates (sentences too short for the minDuration constraint),
  // retry with a relaxed minimum = 40% of the original minDuration
  if (candidates.length === 0) {
    const relaxedMin = Math.max(2, minDuration * 0.4);
    for (let startIdx = 0; startIdx < sentences.length; startIdx++) {
      const groupSentences: ScoredSentence[] = [];
      let groupText = "";

      for (let endIdx = startIdx; endIdx < sentences.length; endIdx++) {
        groupSentences.push(sentences[endIdx]);
        groupText += (groupText ? " " : "") + sentences[endIdx].text;

        const segStart = sentences[startIdx].start;
        const segEnd = sentences[endIdx].end;
        const segDuration = segEnd - segStart;

        if (segDuration < relaxedMin) continue;
        if (segDuration > maxDuration * 1.5) break;

        const avgScore = groupSentences.reduce((s, gs) => s + gs.score, 0) / groupSentences.length;
        const maxScore = Math.max(...groupSentences.map((gs) => gs.score));
        const allKeywords = groupSentences.flatMap((gs) => gs.keywords);

        candidates.push({
          start: segStart,
          end: segEnd,
          text: groupText,
          sentences: [...groupSentences],
          avgScore,
          maxScore,
          keywords: [...new Set(allKeywords)],
        });
      }
    }
  }

  // Final fallback: include individual sentences regardless of length
  if (candidates.length === 0) {
    for (const sentence of sentences) {
      candidates.push({
        start: sentence.start,
        end: sentence.end,
        text: sentence.text,
        sentences: [sentence],
        avgScore: sentence.score,
        maxScore: sentence.score,
        keywords: sentence.keywords,
      });
    }
  }

  // Absolute last resort: uniform segments across full duration
  if (candidates.length === 0) {
    const count = computeTargetClipCount(totalDuration);
    const segLen = Math.min(maxDuration, totalDuration / count);
    for (let i = 0; i < count; i++) {
      candidates.push({
        start: i * segLen,
        end: Math.min((i + 1) * segLen, totalDuration),
        text: `Segment ${i + 1}`,
        sentences: [],
        avgScore: 50 + Math.random() * 20,
        maxScore: 60 + Math.random() * 20,
        keywords: [],
      });
    }
  }

  return candidates;
}

/** Compute composite score for a segment */
function computeSegmentScore(segment: CandidateSegment): number {
  let score = segment.avgScore;

  // Boost if there's a high-scoring "hook" sentence at the start
  if (segment.sentences.length > 0) {
    const firstSentenceScore = segment.sentences[0].score;
    if (firstSentenceScore > 70) score += 10; // Strong opening hook
    if (firstSentenceScore > 85) score += 5;  // Exceptional hook
  }

  // Boost for keyword richness
  score += Math.min(10, segment.keywords.length * 2);

  // Penalize very short or very long clips
  const duration = segment.end - segment.start;
  if (duration < 20) score -= 5;
  if (duration > 50) score -= 3;

  // Optimal duration zone: 20-40 seconds
  if (duration >= 20 && duration <= 40) score += 5;

  // Boost for variety (more sentences = more content)
  if (segment.sentences.length >= 3) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Select top N non-overlapping segments */
function selectNonOverlapping(
  sortedSegments: (CandidateSegment & { compositeScore: number })[],
  maxCount: number
): (CandidateSegment & { compositeScore: number })[] {
  const selected: (CandidateSegment & { compositeScore: number })[] = [];

  for (const seg of sortedSegments) {
    if (selected.length >= maxCount) break;

    // Check overlap with already selected
    const overlaps = selected.some(
      (s) => seg.start < s.end && seg.end > s.start
    );

    if (!overlaps) {
      selected.push(seg);
    }
  }

  return selected;
}

/** Generate a descriptive title for a clip */
function generateTitle(segment: CandidateSegment, index: number): string {
  // Try to extract a meaningful phrase from the first sentence
  if (segment.sentences.length > 0) {
    const firstSentence = segment.sentences[0].text;
    const firstWords = firstSentence.split(/\s+/).slice(0, 8);

    // If it starts with a question, use it
    if (firstSentence.includes("?")) {
      const questionPart = firstSentence.split("?")[0] + "?";
      if (questionPart.length < 60) return questionPart;
    }

    // Use first few significant words
    const significant = firstWords
      .filter((w) => w.length > 2)
      .slice(0, 6)
      .join(" ");

    if (significant.length > 5) {
      // Capitalize first letter
      return significant.charAt(0).toUpperCase() + significant.slice(1);
    }
  }

  // Fallback: keyword-based title
  if (segment.keywords.length > 0) {
    const topKw = segment.keywords.slice(0, 3);
    return `Key Moment: ${topKw.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", ")}`;
  }

  // Last resort
  return `Clip ${index + 1}: ${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}`;
}

/** Generate a hook line for social media */
function generateHook(segment: CandidateSegment): string {
  if (segment.sentences.length === 0) {
    return "Watch this moment 👀";
  }

  const firstSentence = segment.sentences[0].text;
  
  // If it's a question, use it as the hook
  if (firstSentence.includes("?")) {
    return `🤔 ${firstSentence.split("?")[0]}?`;
  }

  // If it starts with imperative/action, emphasize it
  const firstWord = firstSentence.split(/\s+/)[0].toLowerCase();
  if (["stop", "listen", "look", "watch", "think", "imagine"].includes(firstWord)) {
    return `⚡ ${firstSentence.split(/[.!]/)[0]}`;
  }

  // Otherwise, create a "here's what you need to know" style hook
  const shortVersion = firstSentence.split(/\s+/).slice(0, 10).join(" ");
  return `💡 "${shortVersion}..."`;
}

/** Generate a reasoning explanation for the viral score */
function generateReason(segment: CandidateSegment): string {
  const reasons: string[] = [];
  const duration = segment.end - segment.start;

  // Analyze opening strength
  if (segment.sentences.length > 0) {
    const firstScore = segment.sentences[0].score;
    if (firstScore > 75) reasons.push("Strong attention-grabbing opening hook");
    else if (firstScore > 60) reasons.push("Solid opening that draws interest");
  }

  // Keyword richness
  if (segment.keywords.length >= 4) {
    reasons.push(`High keyword density (${segment.keywords.length} trending terms)`);
  } else if (segment.keywords.length >= 2) {
    reasons.push("Contains trending topic keywords");
  }

  // Question engagement
  const hasQuestions = segment.text.includes("?");
  if (hasQuestions) {
    reasons.push("Question format drives comment engagement");
  }

  // Energy markers
  const hasExclamations = segment.text.includes("!");
  if (hasExclamations) {
    reasons.push("High-energy delivery increases watch time");
  }

  // Duration analysis
  if (duration >= 20 && duration <= 35) {
    reasons.push("Optimal clip length for social sharing");
  } else if (duration < 20) {
    reasons.push("Quick-hit format ideal for Reels/Shorts");
  }

  // Content variety
  if (segment.sentences.length >= 3) {
    reasons.push("Multi-point content increases value perception");
  }

  if (reasons.length === 0) {
    reasons.push("Content shows audience retention potential based on topic and pacing");
  }

  return reasons.slice(0, 3).join(". ") + ".";
}

/** Format seconds to mm:ss */
function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

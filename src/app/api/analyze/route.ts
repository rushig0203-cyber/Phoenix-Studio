import { NextResponse } from "next/server";

type Constraints = { targetCount: number; minDuration: number; maxDuration: number };

const stopWords = new Set([
  "about", "after", "again", "also", "because", "could", "from", "have",
  "into", "just", "more", "that", "their", "there", "these", "they",
  "this", "what", "when", "where", "which", "with", "would", "your",
]);

function getClipDurationConstraints(duration: number): Constraints {
  if (duration < 15) return { targetCount: 1, minDuration: 2, maxDuration: duration };
  if (duration < 45) return { targetCount: 2, minDuration: 5, maxDuration: 25 };
  if (duration < 120) return { targetCount: 3, minDuration: 15, maxDuration: 35 };
  if (duration <= 600) return { targetCount: Math.max(2, Math.round(duration / 120)), minDuration: 60, maxDuration: 180 };
  return {
    targetCount: Math.max(1, Math.min(24, Math.round(duration / 150))),
    minDuration: 120,
    maxDuration: 180,
  };
}

function sentences(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function keywords(value: string) {
  const counts = new Map<string, number>();
  for (const word of value.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []) {
    if (stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word);
}

function titleFor(text: string, index: number) {
  const words = text.replace(/[^\p{L}\p{N}' -]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 9).join(" ") : `Episode highlight ${index + 1}`;
}

/**
 * Free local fallback for the legacy editor. The main source-processing queue
 * performs deeper silence + Whisper boundary analysis directly on the video.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const transcript = String(body.transcript || "").trim();
    const duration = Number(body.duration);
    if (!transcript || !Number.isFinite(duration) || duration <= 0) {
      return NextResponse.json({ error: "Missing transcript or duration" }, { status: 400 });
    }

    const constraints = getClipDurationConstraints(duration);
    const count = Math.min(constraints.targetCount, Math.max(1, Math.floor(duration / Math.max(1, constraints.minDuration))));
    const allSentences = sentences(transcript);
    const clips = Array.from({ length: count }, (_, index) => {
      const slotStart = (duration * index) / count;
      const slotEnd = (duration * (index + 1)) / count;
      const clipLength = Math.min(constraints.maxDuration, Math.max(constraints.minDuration, slotEnd - slotStart));
      const startTime = Math.min(slotStart, Math.max(0, duration - clipLength));
      const endTime = Math.min(duration, startTime + clipLength);
      const sentenceStart = Math.floor((allSentences.length * index) / count);
      const sentenceEnd = Math.max(sentenceStart + 1, Math.floor((allSentences.length * (index + 1)) / count));
      const clipTranscript = allSentences.slice(sentenceStart, sentenceEnd).join(" ") || transcript;
      const clipKeywords = keywords(clipTranscript);
      const hookBonus = /\b(how|why|secret|mistake|first|best|never|discover|important)\b/i.test(clipTranscript) ? 7 : 0;
      const clarityBonus = clipTranscript.split(/\s+/).length >= 25 ? 5 : 1;
      const viralScore = Math.min(92, 65 + hookBonus + clarityBonus + ((count - index) % 5));
      const title = titleFor(clipTranscript, index);
      return {
        id: `clip-${index + 1}`,
        title,
        startTime,
        endTime,
        duration: endTime - startTime,
        viralScore,
        reason: `Recommended for its ${hookBonus ? "clear opening hook" : "focused topic"}, understandable speech, and self-contained ${Math.round(endTime - startTime)}-second structure. This is an estimate, not a promise of views.`,
        hookText: `${title}${/[!?]$/.test(title) ? "" : " — watch the key moment."}`,
        transcript: clipTranscript,
        keywords: clipKeywords,
      };
    });

    return NextResponse.json({ clips, source: "free-local-analysis" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Local analysis failed" },
      { status: 500 }
    );
  }
}

import crypto from "node:crypto";
import { requireSongAudio } from "@/lib/songAudio";
import { stockNarrationError } from "@/lib/stockBrief";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generatorReachable,
  listGenerationJobs,
  removeGenerationJob,
  regenerateGenerationJob,
  requireStockStoryboardRenderer,
  retryGenerationJob,
  type GenerationInput,
} from "@/lib/generation";
import { JobHistoryConflictError } from "@/lib/jobHistory";
import { createCreationDrafts, DraftConflict } from "@/lib/creationDrafts";
import { localSingingStatus } from "@/lib/localSinging";
import { assertLocalRequest } from "@/lib/localRequest";
import { readWritingSettings } from "@/lib/writingSettings";
import { researchNews } from "@/lib/newsResearch";
import { buildKidsStorySeries, inventKidsIdea, kidsRendererAvailable } from "@/lib/kidsRenderer";
import {
  durationFitsPublishingFormat,
  inferPublishingFormat,
  publishingProfile,
  type PublishingFormat,
} from "@/lib/publishingFormats";

const schema = z.object({
  newsId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  planOnly: z.boolean().default(false),
  songMode: z.enum(["recording", "local-ace"]).default("recording"),
  songStyle: z.string().trim().max(500).optional(),
  songAudioId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  topic: z.string().max(500).default(""),
  autoIdea: z.boolean().default(false),
  script: z.string().max(20000).optional(),
  visualTerms: z.array(z.string().trim().min(2).max(80)).max(8).optional(),
  language: z.string().default("English"),
  duration: z.coerce.number().int().min(45).max(210).default(75),
  publishingFormat: z.enum(["youtube-full", "youtube-short", "instagram-reel"]).optional(),
  // Accepted only so older clients remain usable. The selected publishing
  // profile is authoritative and these values are never forwarded directly.
  aspect: z.enum(["9:16", "16:9"]).optional(),
  targetPlatform: z.enum(["Instagram", "YouTube"]).optional(),
  batchCount: z.union([z.literal(1), z.literal(10)]).default(1),
  voice: z.string().default("local-windows-voice"),
  subtitleStyle: z.string().default("kids-bold"),
  visualSource: z.enum(["stock", "local-ai", "both"]).optional(),
  creationType: z.enum(["children-story", "children-song", "business", "general"]).default("children-story"),
  audienceAge: z.literal("3-6").optional(),
});

export async function GET() {
  return NextResponse.json(await listGenerationJobs());
}

function selectedFormat(data: z.infer<typeof schema>): PublishingFormat {
  if (data.publishingFormat) return data.publishingFormat;
  if (data.targetPlatform || data.aspect) return inferPublishingFormat(data);
  return data.creationType === "children-song" ? "youtube-full" : "youtube-short";
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid creation request." }, { status: 400 });
    }

    const data = parsed.data;
    if (data.newsId && !["general", "business"].includes(data.creationType)) return NextResponse.json({ error: "News reports use real-footage explainers, not children's animation or songs." }, { status: 400 });
    if (data.newsId && (data.script?.trim() || data.visualTerms?.length)) return NextResponse.json({ error: "Report mode writes from its source. Remove the custom narration and shot brief, or create an ordinary video without selecting a news report." }, { status: 400 });
    if (data.creationType === "children-song") {
      if (data.songMode === "local-ace") {
        const singing = await localSingingStatus();
        if (!singing.available) return NextResponse.json({ error: singing.reason }, { status: 503 });
      } else {
      if (!data.script?.trim()) return NextResponse.json({ error: "Add the lyrics from your sung recording so the captions match." }, { status: 400 });
      await requireSongAudio(data.songAudioId, data.duration);
      }
    }
    const children = data.creationType === "children-story" || data.creationType === "children-song";
    const needsWriter = !data.script?.trim() || (!children && !data.visualTerms?.length);
    if (needsWriter) {
      const writer = readWritingSettings();
      if (writer.provider === "groq" && (!writer.apiKey || !writer.freePlanConfirmed)) return NextResponse.json({ error: "Set up your Groq Free-plan key in Studio health → Writing settings before creating a video. No local or paid fallback will be used." }, { status: 503 });
    }
    if (!children && data.script?.trim()) {
      const error = stockNarrationError(data.script, data.duration);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    const publishingFormat = selectedFormat(data);
    const profile = publishingProfile(publishingFormat);

    if (!durationFitsPublishingFormat(publishingFormat, data.duration)) {
      return NextResponse.json({
        error: `${profile.label} must be between ${profile.minDuration} and ${profile.maxDuration} seconds.`,
      }, { status: 400 });
    }
    if (publishingFormat === "youtube-full" && data.creationType !== "children-song") {
      return NextResponse.json({
        error: "YouTube full mode is currently reserved for original children's songs. Choose a Short or Reel for stories and stock videos.",
      }, { status: 400 });
    }
    if (data.batchCount === 10 && (data.creationType !== "children-story" || publishingFormat === "youtube-full")) {
      return NextResponse.json({
        error: "A 10-part batch is available for children's YouTube Shorts and Instagram Reels.",
      }, { status: 400 });
    }

    if (children && !(await kidsRendererAvailable(data.creationType !== "children-song" && !data.script?.trim()))) {
      return NextResponse.json({
        error: "The children renderer is unavailable. Check your selected writer, FFmpeg and Windows local voice in Studio health.",
      }, { status: 503 });
    }
    if (!children && !(await generatorReachable())) {
      return NextResponse.json({ error: "The optional free stock-video service is offline." }, { status: 503 });
    }
    if (!children) await requireStockStoryboardRenderer();

    const baseTopic = children && data.autoIdea
      ? await inventKidsIdea(data.creationType as "children-story" | "children-song")
      : data.topic.trim();
    if (baseTopic.length < 3) {
      return NextResponse.json({ error: "Enter an idea or turn on ‘Let Phoenix invent it’." }, { status: 400 });
    }

    const requestId = data.requestId || crypto.randomUUID();
    const research = data.newsId ? await researchNews(data.newsId) : undefined;
    const common = {
      research,
      reviewMode: "final",
      songMode: data.songMode,
      songStyle: data.songStyle,
      songAudioId: data.songAudioId,
      requestId,
      language: data.language,
      duration: data.duration,
      aspect: profile.aspect,
      voice: data.voice,
      subtitleStyle: data.subtitleStyle,
      visualSource: children ? "local-ai" : "stock",
      targetPlatform: profile.platform,
      publishingFormat,
      creationType: data.creationType,
      audienceAge: children ? "3-6" : undefined,
      script: data.script,
      scriptOrigin: data.script?.trim() ? "owner" : undefined,
      visualTerms: data.visualTerms,
      visualTermsOrigin: data.visualTerms?.length ? "owner" : undefined,
    } satisfies Omit<GenerationInput, "topic">;

    let inputs: GenerationInput[];
    if (data.batchCount === 10) {
      const seriesId = crypto.randomUUID();
      const seriesTitle = baseTopic;
      inputs = buildKidsStorySeries(baseTopic, 10).map((episode) => ({
        ...common,
        topic: episode.topic,
        seriesId,
        seriesTitle,
        episodeNumber: episode.episodeNumber,
        episodeCount: episode.episodeCount,
        episodeBeat: episode.beat,
      }));
    } else {
      inputs = [{ ...common, topic: research ? `Explain this report neutrally: ${research.title}` : baseTopic }];
    }

    // Both modes use the durable planner. Normal creation proceeds to rendering
    // automatically. Older clients' planOnly flag no longer creates an approval gate.
    const drafts = await createCreationDrafts(inputs);
    return NextResponse.json({
      draftIds: drafts.map(draft => draft.id),
      count: drafts.length,
      status: drafts[0].status,
      planOnly: false,
      title: baseTopic,
    }, { status: 201 });
  } catch (error) {
    console.error("[ai-creation] queue failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not queue local creation.",
    }, { status: error instanceof JobHistoryConflictError || error instanceof DraftConflict ? 409 : 500 });
  }
}

export async function DELETE(request: Request) {
  const parsed = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!parsed.success) return NextResponse.json({ error: "A valid job id is required." }, { status: 400 });
  try {
    const job = await removeGenerationJob(parsed.data);
    return job
      ? NextResponse.json({ deleted: true, cancelled: job.status === "CANCELLED", filesRetained: true })
      : NextResponse.json({ error: "Job not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove this job." }, {
      status: error instanceof JobHistoryConflictError ? 409 : 500,
    });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = z.object({ id: z.string().uuid(), regenerate: z.boolean().optional() }).parse(await request.json());
    const job = body.regenerate
      ? await regenerateGenerationJob(body.id)
      : await retryGenerationJob(body.id);
    return job
      ? NextResponse.json(job)
      : NextResponse.json({ error: "Job not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not retry job.",
    }, { status: 400 });
  }
}

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  FFMPEG_ENCODER_RESOURCE_ARGS,
  FFMPEG_FILTER_RESOURCE_ARGS,
  lowerChildProcessPriority,
} from "./renderResources";

export type PixabayAnimationCredit = {
  id: number;
  pageUrl: string;
  creator: string;
  tags: string;
};

export type PixabayAnimationBackground = {
  file: string;
  credits: PixabayAnimationCredit[];
};

type PixabayVideoFile = {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
};

type PixabayHit = {
  id?: number;
  duration?: number;
  tags?: string;
  pageURL?: string;
  user?: string;
  views?: number;
  likes?: number;
  videos?: Record<string, PixabayVideoFile | undefined>;
};

type Candidate = {
  id: number;
  duration: number;
  tags: string;
  pageUrl: string;
  creator: string;
  url: string;
  size: number;
  score: number;
};

const ffmpeg = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(
  process.cwd(),
  "node_modules",
  "@ffmpeg-installer",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
// A small curated set stays visually coherent and makes the local pre-render
// faster.  Original props, character poses, captions, and camera motion still
// change throughout the full video.
const MAX_BACKGROUNDS = 3;
const MAX_LOG_CHARS = 32 * 1024;
const forbiddenTags = /\b(?:naruto|pokemon|disney|marvel|demon|horror|blood|weapon|gun|war|sexy|logo|trademark|girl|boy|woman|man|person|people|human|dragon|reptile|thunder|lightning|cow|bull|horse|dog|cat|bunny|rabbit|bear|fox|bird|fish|animal|animals|character|butterfly|butterflies|insect|insects|wildlife|starfield|painting|abstract)\b/i;
const backgroundTags = /\b(?:background|landscape|garden|forest|nature|sky|cloud|meadow|loop|scenic|wallpaper)\b/i;
const childFriendlyTags = /\b(?:kids|cute|colorful|garden|flowers|park|meadow|rainbow|sun|cloud|nature)\b/i;
const illustratedStyleTags = /\b(?:kids|cartoon|anime|animated|animation|illustration|illustrated|drawing|2d|3d|fantasy|magic cartoon)\b/i;

function run(command: string, args: string[], cwd: string, timeoutMs = 180_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    lowerChildProcessPriority(child.pid);
    let log = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Animation background preparation timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    const append = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-MAX_LOG_CHARS);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(log.trim() || `FFmpeg animation preparation failed (${code}).`));
    });
  });
}

function animationQueries(topic: string) {
  if (/rain|puddle|storm|umbrella/i.test(topic)) {
    return ["cartoon rain landscape", "cartoon garden landscape", "cartoon sky landscape"];
  }
  if (/ocean|sea|fish|underwater/i.test(topic)) {
    return ["cartoon ocean landscape", "cartoon underwater background", "cartoon beach landscape"];
  }
  if (/night|moon|star|firefl|bedtime|sleep/i.test(topic)) {
    return ["cartoon night landscape", "cartoon moon landscape", "cartoon forest landscape"];
  }
  // Let the requested setting outrank character words such as bear or bunny.
  // Otherwise a sunny garden song can drift into unrelated forest/winter clips.
  if (/garden|flower|sunny|sunshine|meadow|rainbow/i.test(topic)) {
    return ["cartoon flower garden landscape", "cartoon garden landscape", "cartoon sunny meadow landscape"];
  }
  if (/forest|bear|fox|bunny|animal/i.test(topic)) {
    return ["cartoon forest landscape", "cartoon garden landscape", "cartoon meadow landscape"];
  }
  return ["cartoon garden landscape", "cartoon meadow landscape", "cartoon sky landscape"];
}

function queryMatchesTags(query: string, tags: string) {
  if (/\brain(?:bow)?\b/i.test(query)) return /\brain|rainbow|raindrop|puddle\b/i.test(tags);
  if (/\bunderwater\b/i.test(query)) return /\bunderwater|ocean|sea|coral\b/i.test(tags);
  if (/\bocean|beach\b/i.test(query)) return /\bocean|sea|beach|wave\b/i.test(tags);
  if (/\bnight|moon\b/i.test(query)) return /\bnight|moon|star|crescent\b/i.test(tags);
  if (/\bflower|garden\b/i.test(query)) return /\bflower|garden|bloom\b/i.test(tags);
  if (/\bmeadow\b/i.test(query)) return /\bmeadow|field|grass|garden\b/i.test(tags);
  if (/\bsky\b/i.test(query)) return /\bsky|cloud|sun\b/i.test(tags);
  if (/\bforest\b/i.test(query)) return /\bforest|woods|tree\b/i.test(tags);
  return true;
}

function preferredFile(hit: PixabayHit) {
  const files = [hit.videos?.medium, hit.videos?.small, hit.videos?.tiny]
    .filter((file): file is PixabayVideoFile => Boolean(file?.url && file.width && file.height))
    .filter((file) => !file.size || file.size <= MAX_DOWNLOAD_BYTES)
    .sort((left, right) => (right.width || 0) - (left.width || 0));
  return files[0];
}

async function search(query: string): Promise<Candidate[]> {
  const key = String(process.env.PIXABAY_API_KEY || "").trim();
  if (!key) return [];
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("video_type", "animation");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("order", "popular");
  url.searchParams.set("per_page", "20");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Pixabay animation search returned ${response.status}.`);
  const data = await response.json() as { hits?: PixabayHit[] };
  return (data.hits || []).flatMap((hit) => {
    const file = preferredFile(hit);
    const id = Number(hit.id);
    const duration = Number(hit.duration);
    const tags = String(hit.tags || "");
    const queryAllowsNight = /\b(?:night|moon|star|bedtime|sleep)\b/i.test(query);
    const mismatchedNightScene = !queryAllowsNight && /\b(?:night|moon|crescent|dark|storm)\b/i.test(tags);
    const queryAllowsColdSeason = /\b(?:winter|snow|autumn|fall)\b/i.test(query);
    const mismatchedSeason = !queryAllowsColdSeason && /\b(?:winter|snow|wintry|cold|autumn|fall)\b/i.test(tags);
    // Pixabay's `video_type=animation` also includes rain or effects layered on
    // realistic photographs. Those made the children's output visually dark
    // and inconsistent, so accept only clearly illustrated/stylized results.
    if (
      !file?.url ||
      !Number.isSafeInteger(id) ||
      duration < 4 ||
      duration > 90 ||
      forbiddenTags.test(tags) ||
      mismatchedNightScene ||
      mismatchedSeason ||
      !backgroundTags.test(tags) ||
      !queryMatchesTags(query, tags) ||
      !illustratedStyleTags.test(tags)
    ) return [];
    return [{
      id,
      duration,
      tags,
      pageUrl: String(hit.pageURL || `https://pixabay.com/videos/id-${id}/`),
      creator: String(hit.user || "Pixabay contributor"),
      url: file.url,
      size: Number(file.size || 0),
      score: (/\b(?:kids|cartoon|anime|illustration|drawing|magic cartoon)\b/i.test(tags) ? 2_000_000 : 0) +
        (backgroundTags.test(tags) ? 1_000_000 : 0) +
        (childFriendlyTags.test(tags) ? 500_000 : 0) +
        Number(hit.likes || 0) * 50 + Number(hit.views || 0),
    }];
  }).sort((left, right) => right.score - left.score);
}

async function download(candidate: Candidate, assetRoot: string) {
  await fs.mkdir(assetRoot, { recursive: true });
  const destination = path.join(assetRoot, `${candidate.id}.mp4`);
  try {
    const stat = await fs.stat(destination);
    if (stat.size > 50_000) return destination;
  } catch {
    // Download the missing cached asset below.
  }

  const response = await fetch(candidate.url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new Error(`Pixabay animation ${candidate.id} could not be downloaded.`);
  const declared = Number(response.headers.get("content-length") || candidate.size || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`Pixabay animation ${candidate.id} is too large for the local cache.`);
  const temporary = `${destination}.${process.pid}.tmp`;
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) callback(new Error("Pixabay animation exceeded the 60 MB safety limit."));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as never), counter, fsSync.createWriteStream(temporary));
    await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
    return destination;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function preparePixabayAnimationBackground(input: {
  topic: string;
  directory: string;
  format: "9:16" | "16:9";
  onStage?: (message: string) => Promise<unknown>;
}): Promise<PixabayAnimationBackground | null> {
  if (!String(process.env.PIXABAY_API_KEY || "").trim()) return null;
  const candidateGroups = await Promise.all(animationQueries(input.topic).map((query) => search(query)));
  const candidates = [...new Map(
    candidateGroups.flat().sort((left, right) => right.score - left.score).map((candidate) => [candidate.id, candidate])
  ).values()];
  if (!candidates.length) return null;
  const selected: Candidate[] = [];
  // Start with one result from each related search so a long video does not
  // become the same scene repeated. Fill the remaining slots by quality score.
  for (const group of candidateGroups) {
    const candidate = group.find((item) => !selected.some((selectedItem) => selectedItem.id === item.id));
    if (candidate) selected.push(candidate);
  }
  for (const candidate of candidates) {
    if (selected.length >= MAX_BACKGROUNDS) break;
    if (!selected.some((item) => item.id === candidate.id)) selected.push(candidate);
  }
  selected.splice(MAX_BACKGROUNDS);
  if (!selected.length) return null;

  await input.onStage?.(`Downloading ${selected.length} free licensed Pixabay animation background${selected.length === 1 ? "" : "s"}`);
  const assetRoot = path.join(process.cwd(), "storage", "Phoenix Studio Review Files", "assets", "pixabay-animation");
  const downloaded: Array<{ candidate: Candidate; file: string }> = [];
  for (const candidate of selected) {
    try {
      downloaded.push({ candidate, file: await download(candidate, assetRoot) });
    } catch {
      // One unavailable contributor file must not discard other valid assets.
    }
  }
  if (!downloaded.length) return null;

  await input.onStage?.(`Preparing ${downloaded.length} moving animation background${downloaded.length === 1 ? "" : "s"} locally`);
  const output = path.join(input.directory, "pixabay-animation-background.mp4");
  const width = input.format === "9:16" ? 720 : 1280;
  const height = input.format === "9:16" ? 1280 : 720;
  const args: string[] = ["-hide_banner", "-loglevel", "warning", ...FFMPEG_FILTER_RESOURCE_ARGS, "-y"];
  for (const item of downloaded) args.push("-i", item.file);
  const filters = downloaded.map((item, index) => {
    const length = Math.min(10, Math.max(4, item.candidate.duration - 0.1));
    // Pixabay loops can transition from bright daytime into a very dark frame.
    // The opening section is the portion represented by the search thumbnail
    // and is much more predictable for a child-friendly background.
    const start = Math.min(0.5, Math.max(0, item.candidate.duration - length));
    return `[${index}:v]trim=start=${start.toFixed(3)}:duration=${length.toFixed(3)},setpts=PTS-STARTPTS,` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height},` +
      `fps=15,setsar=1,format=yuv420p[v${index}]`;
  });
  filters.push(`${downloaded.map((_, index) => `[v${index}]`).join("")}concat=n=${downloaded.length}:v=1:a=0[background]`);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[background]",
    "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", ...FFMPEG_ENCODER_RESOURCE_ARGS, "-pix_fmt", "yuv420p",
    output,
  );
  await run(ffmpeg, args, input.directory);
  return {
    file: output,
    credits: downloaded.map(({ candidate }) => ({
      id: candidate.id,
      pageUrl: candidate.pageUrl,
      creator: candidate.creator,
      tags: candidate.tags,
    })),
  };
}

import { z } from "zod";
import type { ReviewFile } from "./reviewFiles";
import type { InstagramAudioTrack } from "./instagramAudio";

export const reelMusicBriefSchema = z.object({
  version: z.literal(1),
  mood: z.enum(["calm", "warm", "reflective", "uplifting", "energetic", "playful", "uncertain"]),
  energy: z.enum(["low", "medium", "high", "unknown"]),
  reason: z.string().trim().min(8).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),
  evidenceFrames: z.array(z.number().int().min(1).max(3)).min(1).max(3),
});
export type ReelMusicBrief = z.infer<typeof reelMusicBriefSchema>;
export type RecommendedInstagramAudio = InstagramAudioTrack & { recommendation?: { rank: number; kind: "english-vocal" | "instrumental"; reason: string } };
export type ReelMusicRecommendation = { preference: "english-and-instrumental"; basis: "sampled-frames" | "saved-observations"; mood: ReelMusicBrief["mood"]; energy: ReelMusicBrief["energy"]; reason: string };
type Seed = { title: string; artist: string; aliases?: string[]; kind: "english-vocal" | "instrumental"; moods: ReelMusicBrief["mood"][]; energy: "low" | "medium" | "high"; character: string; source: string };

// Verified original recordings, not a claim of Meta availability, current trends
// or measured tempo. Mood/footage fit is editorial; never download these songs.
export const REEL_MUSIC_SEEDS: readonly Seed[] = [
  { title: "Holocene", artist: "Bon Iver", kind: "english-vocal", moods: ["calm", "reflective"], energy: "low", character: "reflective acoustic vocals", source: "https://boniver.org/audio/bon-iver/" },
  { title: "Banana Pancakes", artist: "Jack Johnson", kind: "english-vocal", moods: ["warm", "calm", "playful"], energy: "low", character: "relaxed acoustic vocals", source: "https://jackjohnsonmusic.com/music/inbetweendreams/" },
  { title: "Take Me Home, Country Roads", artist: "John Denver", kind: "english-vocal", moods: ["warm", "uplifting", "reflective"], energy: "medium", character: "nostalgic folk vocals", source: "https://johndenver.com/tracks/take-me-home-country-roads/" },
  { title: "Adventure Of A Lifetime", artist: "Coldplay", kind: "english-vocal", moods: ["uplifting", "energetic"], energy: "high", character: "bright, lively English vocals", source: "https://www.coldplay.com/release/adventure-of-a-lifetime/" },
  { title: "Levitating", artist: "Dua Lipa", kind: "english-vocal", moods: ["energetic", "playful"], energy: "high", character: "bright dance-pop vocals", source: "https://www.youtube.com/watch?v=WHuBW3qKm9g" },
  { title: "Upside Down", artist: "Jack Johnson", kind: "english-vocal", moods: ["playful", "warm", "uplifting"], energy: "medium", character: "light, curious acoustic vocals", source: "https://jackjohnsonmusic.com/music/singalongsandlullabiesforthefilmcuriousgeorge/" },
  { title: "A Walk", artist: "Tycho", kind: "instrumental", moods: ["calm", "warm", "uplifting"], energy: "medium", character: "spacious ambient instrumental", source: "https://tycho.bandcamp.com/track/a-walk" },
  { title: "saman", artist: "Ólafur Arnalds", kind: "instrumental", moods: ["calm", "reflective", "warm"], energy: "low", character: "gentle piano instrumental", source: "https://olafurarnalds.com/works/" },
  { title: "Experience", artist: "Ludovico Einaudi", aliases: ["Ludovico Einaudi Daniel Hope I Virtuosi Italiani"], kind: "instrumental", moods: ["reflective", "uplifting", "energetic"], energy: "medium", character: "building cinematic instrumental", source: "https://ludovicoeinaudi.com/in-a-time-lapse/" },
  { title: "Carefree", artist: "Kevin MacLeod", kind: "instrumental", moods: ["playful", "warm", "uplifting"], energy: "medium", character: "light, bouncy ukulele instrumental", source: "https://incompetech.com/music/royalty-free/index.html?gt=&isrc=USUAN1400037" },
  { title: "Monkeys Spinning Monkeys", artist: "Kevin MacLeod", kind: "instrumental", moods: ["playful", "uplifting"], energy: "high", character: "comic flute and plucked-string instrumental", source: "https://incompetech.com/music/royalty-free/?isrc=USUAN1400011" },
];
export const REEL_MUSIC_LOOKUP_LIMIT = 3;
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function musicSeedMatches(track: InstagramAudioTrack, seed: Seed) {
  // A Latin/English-looking title does not establish vocal language. Accept
  // only the verified original title/artist, not covers, remixes or extra acts.
  return normalized(track.title) === normalized(seed.title)
    && [seed.artist, ...(seed.aliases || [])].some(artist => normalized(track.display_artist) === normalized(artist));
}
export function musicSeedsFor(brief: ReelMusicBrief) {
  if (brief.mood === "uncertain") return [];
  const energy = { low: 0, medium: 1, high: 2, unknown: 1 }[brief.energy];
  const candidates = REEL_MUSIC_SEEDS.filter(seed => seed.moods.includes(brief.mood))
    .map((seed, index) => ({ seed, index, score: Math.abs({ low: 0, medium: 1, high: 2 }[seed.energy] - energy) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  const chosen = candidates.slice(0, REEL_MUSIC_LOOKUP_LIMIT).map(item => item.seed);
  for (const kind of ["english-vocal", "instrumental"] as const) {
    if (chosen.some(seed => seed.kind === kind)) continue;
    const alternative = candidates.find(item => item.seed.kind === kind)?.seed;
    if (alternative) chosen[chosen.length - 1] = alternative;
  }
  return chosen;
}

/** Uses actual saved frame observations, never a topic/title/hashtag template. */
export function musicBriefFromReview(file: ReviewFile): { brief: ReelMusicBrief; basis: ReelMusicRecommendation["basis"] } | null {
  const analysis = file.quality.postingAnalysis;
  if (analysis?.status !== "COMPLETE" || !Array.isArray(analysis.observations) || !analysis.observations.length) return null;
  const observations = analysis.observations.slice(0, 6).filter(value => typeof value === "string").map(value => value.slice(0, 400));
  const evidenceFrames = [...new Set(observations.flatMap(value => { const frame = /^Frame ([1-3]):/.exec(value); return frame ? [Number(frame[1])] : []; }))];
  if (!evidenceFrames.length) return null;
  const profile = reelMusicBriefSchema.safeParse(analysis.musicBrief);
  if (profile.success && profile.data.evidenceFrames.every(frame => evidenceFrames.includes(frame))) return { brief: profile.data, basis: "sampled-frames" };
  const evidence = observations.filter(value => /^Frame [1-3]:/.test(value)).join(" ").toLowerCase();
  const match: [RegExp, ReelMusicBrief["mood"], ReelMusicBrief["energy"]][] = [
    [/\b(?:dogs?|pupp(?:y|ies)|kittens?|cats?|play(?:ing|ful)|butterfl(?:y|ies))\b/, "playful", "medium"],
    [/\b(?:sunset|sunrise|golden|orange light|warm light)\b/, "warm", "low"],
    [/\b(?:city|traffic|neon|skate\w*|cycl\w*|running|runner)\b/, "energetic", "medium"],
    [/\b(?:rain|raindrops|fog|mist|snow)\b/, "reflective", "low"],
    [/\b(?:mountain|mountains|train|road|roads|hiking)\b/, "uplifting", "medium"],
    [/\b(?:forest|trees|leaves|water|waves|sea|ocean|clouds|grass|horses?)\b/, "calm", "low"],
  ];
  const found = match.find(([cue]) => cue.test(evidence));
  if (!found) return null;
  return { basis: "saved-observations", brief: { version: 1, mood: found[1], energy: found[2], evidenceFrames,
    reason: `Saved sampled-frame observations suggest a ${found[1]} visual mood; this is an editorial music fit, not a full-video or audio review.` } };
}

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
  { title: "Experience", artist: "Ludovico Einaudi", aliases: ["Ludovico Einaudi Daniel Hope I Virtuosi Italiani", "Ludovico Einaudi, Daniel Hope, I Virtuosi Italiani"], kind: "instrumental", moods: ["reflective", "uplifting", "energetic"], energy: "medium", character: "building cinematic instrumental", source: "https://ludovicoeinaudi.com/in-a-time-lapse/" },
  { title: "Carefree", artist: "Kevin MacLeod", kind: "instrumental", moods: ["playful", "warm", "uplifting"], energy: "medium", character: "light, bouncy ukulele instrumental", source: "https://incompetech.com/music/royalty-free/index.html?gt=&isrc=USUAN1400037" },
  { title: "Monkeys Spinning Monkeys", artist: "Kevin MacLeod", kind: "instrumental", moods: ["playful", "uplifting"], energy: "high", character: "comic flute and plucked-string instrumental", source: "https://incompetech.com/music/royalty-free/?isrc=USUAN1400011" },
];
export const REEL_MUSIC_LOOKUP_LIMIT = 3;
const normalized = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function originalTitle(title: string) {
  // Reissues preserve the recording identity. Covers, live versions, remixes
  // and arbitrary suffixes cannot inherit its verified vocal-language label.
  return normalized(title.replace(/\s*(?:\(|\[|[-–—])\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|original (?:mix|version)|album version)\s*[)\]]?\s*$/i, ""));
}
function artistCredits(artist: string) {
  return artist.split(/\s*(?:,|&|\band\b)\s*/i).map(normalized).filter(Boolean).sort().join("|");
}
export function musicSeedMatches(track: InstagramAudioTrack, seed: Seed) {
  // A Latin/English-looking title does not establish vocal language. Accept
  // only the verified original title/artist, not covers, remixes or extra acts.
  return originalTitle(track.title) === normalized(seed.title)
    && [seed.artist, ...(seed.aliases || [])].some(artist => normalized(track.display_artist) === normalized(artist)
      || (artist.includes(",") && artistCredits(track.display_artist) === artistCredits(artist)));
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

const moodCatalog = {
  calm: { query: "ambient", cues: /\b(?:calm|ambient|peaceful|quiet|gentle|soft|relaxing|relaxed|chill|dreamy|meditation|piano)\b/ },
  warm: { query: "acoustic", cues: /\b(?:warm|acoustic|sunset|sunshine|sunny|gentle|relaxed|folk|ukulele)\b/ },
  reflective: { query: "piano", cues: /\b(?:reflective|piano|cinematic|quiet|melancholy|nostalgic|rain|dreamy|ambient)\b/ },
  uplifting: { query: "uplifting", cues: /\b(?:uplifting|hopeful|inspiring|bright|happy|adventure|cinematic|acoustic)\b/ },
  energetic: { query: "upbeat", cues: /\b(?:energetic|upbeat|lively|dance|driving|electronic|funk|bright)\b/ },
  playful: { query: "playful", cues: /\b(?:playful|fun|cheerful|happy|bouncy|comic|ukulele|funk)\b/ },
} as const;

/** One account catalog read and two relevant instrumental searches, never paging or retries. */
export function musicCatalogQueries(brief: ReelMusicBrief): string[] {
  if (brief.mood === "uncertain") return [];
  return ["", `${moodCatalog[brief.mood].query} instrumental`, "instrumental"].slice(0, REEL_MUSIC_LOOKUP_LIMIT);
}

/** Prefer known recordings or explicit catalog labels; titles in English alone prove no vocal language. */
export function rankMusicCatalog(tracks: readonly InstagramAudioTrack[], brief: ReelMusicBrief, limit = 6): RecommendedInstagramAudio[] {
  if (brief.mood === "uncertain") return [];
  const energy = { low: 0, medium: 1, high: 2, unknown: 1 }[brief.energy];
  const candidates = new Map<string, { track: InstagramAudioTrack; kind: "english-vocal" | "instrumental"; score: number; reason: string }>();
  for (const track of tracks) {
    const original = REEL_MUSIC_SEEDS.find(seed => musicSeedMatches(track, seed));
    let kind: "english-vocal" | "instrumental", score: number, reason: string;
    if (original) {
      if (!original.moods.includes(brief.mood)) continue;
      kind = original.kind;
      score = 100 - 15 * Math.abs({ low: 0, medium: 1, high: 2 }[original.energy] - energy);
      reason = `${original.character} fits the ${brief.mood} visual mood. Verified recording identity; editorial fit, not audio analysis.`;
    } else {
      const title = normalized(track.title);
      const instrumental = /\b(?:instrumental|no vocals|without vocals)\b/.test(title);
      // Explicit absence labels are allowed; any other vocal declaration,
      // including language-qualified singing, contradicts an instrumental.
      const remainingLabels = title.replace(/\b(?:no vocals|without vocals)\b/g, "");
      const conflictingVocals = /\b(?:vocal\w*|sing(?:ing|er|ers)?|sung|lyric\w*|chant\w*|choir|choral|rap(?:ping)?)\b/.test(remainingLabels);
      // Unknown vocal language, generic trends and keyword hits without a
      // matching descriptive title never become automatic recommendations.
      if (!instrumental || conflictingVocals || !moodCatalog[brief.mood].cues.test(title)
        || /\b(?:cover|remix|karaoke|tribute)\b/.test(title)
        || /\b(?:not|non)\s*(?:(?:an?|fully|purely)\s+)?instrumental\b/.test(title)) continue;
      kind = "instrumental";
      const low = /\b(?:gentle|soft|quiet|calm|relaxing|ambient|meditation)\b/.test(title);
      const high = /\b(?:energetic|upbeat|dance|driving|lively)\b/.test(title);
      if ((brief.energy === "low" && high) || (brief.energy === "high" && low)) continue;
      score = 65 + ((energy === 0 && low) || (energy === 2 && high) ? 10 : 0);
      reason = `Catalog title labels an instrumental and a style fitting the ${brief.mood} mood. Metadata fit; audio was not analyzed.`;
    }
    const previous = candidates.get(track.audio_id);
    if (!previous || previous.score < score) candidates.set(track.audio_id, { track, kind, score, reason });
  }
  return [...candidates.values()].sort((left, right) => right.score - left.score || normalized(left.track.title).localeCompare(normalized(right.track.title))
    || left.track.audio_id.localeCompare(right.track.audio_id)).slice(0, Math.min(6, Math.max(0, limit))).map((candidate, index) => ({
      ...candidate.track, recommendation: { rank: index + 1, kind: candidate.kind, reason: candidate.reason },
    }));
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

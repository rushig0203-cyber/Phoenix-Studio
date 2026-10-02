import type { KidsAnimationPerformanceFrame } from "./kidsAnimation";

export type VoiceUtterance = { text: string; speaker: -1 | 0 | 1; pauseMs: number };
export type KidsVoicePlan = { version: 1; utterances: VoiceUtterance[] };
export type SpeechWord = { text: string; seconds: number; characterPosition?: number; speaker?: number };
export type SpeechViseme = { seconds: number; duration: number; viseme: number; speaker?: number };
export type SpeechTiming = {
  version: 1; source: "windows-speech-events"; words: SpeechWord[]; visemes: SpeechViseme[];
  bookmarks: Array<{ name: string; seconds: number }>; voices?: string[];
};

type TimedCaption = { text: string; start: number; end: number; duration: number };

/** Keep brief interjections readable without changing their spoken wording. */
export function mergeBriefKidsCaptions(cues: TimedCaption[], minimum = .85): TimedCaption[] {
  const result = cues.map(cue => ({ ...cue }));
  const fits = (a: TimedCaption, b: TimedCaption) => {
    const text = `${a.text} ${b.text}`;
    return tokens(text).length <= 12 && text.length <= 82;
  };
  for (let index = 0; index < result.length; index++) {
    const cue = result[index];
    if (cue.duration >= minimum) continue;
    const next = result[index + 1], prior = result[index - 1];
    if (next && fits(cue, next)) {
      result.splice(index, 2, { text: `${cue.text} ${next.text}`, start: cue.start, end: next.end, duration: next.end - cue.start });
      index--;
    } else if (prior && fits(prior, cue)) {
      result.splice(index - 1, 2, { text: `${prior.text} ${cue.text}`, start: prior.start, end: cue.end, duration: cue.end - prior.start });
      index = Math.max(-1, index - 2);
    }
    // A group that cannot safely merge remains explicitly short for final
    // listening review; do not rewrite speech or discard an otherwise valid video.
  }
  return result;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.map(word => word.replace(/’/g, "'")) || [];

/** Unknown quoted speakers stay narration rather than animating an invented actor. */
export function kidsVoicePlan(script: string, castNames: [string, string]): KidsVoicePlan {
  const utterances: VoiceUtterance[] = [];
  let cursor = 0;
  const append = (text: string, speaker: -1 | 0 | 1) => {
    if (text.trim()) utterances.push({ text: text.trim(), speaker, pauseMs: /[.!?][”"]?$/.test(text.trim()) ? 135 : 55 });
  };
  for (const match of script.matchAll(/[“"]([^”"]+)[”"]/g)) {
    const start = match.index!;
    const before = script.slice(cursor, start);
    append(before, -1);
    const after = script.slice(start + match[0].length, start + match[0].length + 100);
    const verb = "(?:said|says|asked|asks|answered|answers|whispered|whispers|called|calls|replied|replies|laughed|laughs|cried|cries|shouted|shouts)";
    let speaker: -1 | 0 | 1 = -1;
    const identities: number[] = [];
    for (const [index, name] of castNames.entries()) {
      if (new RegExp(`\\b${escapeRegex(name)}\\s+${verb}[^.!?]*$`, "i").test(before)
        || new RegExp(`^[,\\s]*${verb}\\s+${escapeRegex(name)}\\s*(?:[.!?]|$)`, "i").test(after)
        || new RegExp(`^[,\\s]*${escapeRegex(name)}\\s+${verb}\\s*(?:[.!?]|$)`, "i").test(after)
        || new RegExp(`\\b${escapeRegex(name)}\\s*:\\s*$`, "i").test(before)) identities.push(index);
    }
    if (identities.length === 1) speaker = identities[0] as 0 | 1;
    append(match[1], speaker);
    cursor = start + match[0].length;
  }
  append(script.slice(cursor), -1);
  if (!utterances.length) throw new Error("A voice plan needs narration text.");
  return { version: 1, utterances };
}

/** Validate bounded engine data; never accept arbitrary serialized animation state. */
export function parseSpeechTiming(value: unknown): SpeechTiming | null {
  if (!value || typeof value !== "object") return null;
  const data = value as SpeechTiming;
  if (data.version !== 1 || data.source !== "windows-speech-events" || !Array.isArray(data.words)
    || !Array.isArray(data.visemes) || !Array.isArray(data.bookmarks)
    || data.words.length > 6000 || data.visemes.length > 12000 || data.bookmarks.length > 1000) return null;
  const roleValid = (role: unknown) => role === undefined || role === -1 || role === 0 || role === 1;
  if (data.words.some((word, index) => !word || typeof word !== "object" || typeof word.text !== "string" || word.text.length > 300 || !Number.isFinite(word.seconds) || word.seconds < 0 || word.seconds > 600
      || !roleValid(word.speaker) || word.characterPosition !== undefined && (!Number.isInteger(word.characterPosition) || word.characterPosition < 0 || word.characterPosition > 200000)
      || index > 0 && word.seconds < data.words[index - 1].seconds)
    || data.visemes.some(pose => !pose || typeof pose !== "object" || !roleValid(pose.speaker) || !Number.isFinite(pose.seconds) || pose.seconds < 0 || pose.seconds > 600
      || !Number.isFinite(pose.duration) || pose.duration < 0 || pose.duration > 30 || !Number.isInteger(pose.viseme) || pose.viseme < 0 || pose.viseme > 21)
    || data.bookmarks.some(mark => !mark || typeof mark !== "object" || typeof mark.name !== "string" || mark.name.length > 100 || !Number.isFinite(mark.seconds) || mark.seconds < 0 || mark.seconds > 600)
    || data.voices !== undefined && (!Array.isArray(data.voices) || data.voices.length > 30 || data.voices.some(voice => typeof voice !== "string" || voice.length > 200))) return null;
  return data;
}

/** Word STARTS are engine measurements; cue ends use the next measured start. */
export function measuredKidsCaptionCues(captions: string[], timing: SpeechTiming, sourceSeconds: number, targetSeconds: number) {
  if (!(sourceSeconds > 0 && targetSeconds > 0) || !captions.length || !timing.words.length) return null;
  const words: Array<{ text: string; seconds: number }> = [];
  let previousPosition: number | undefined;
  let previousText = "";
  for (const word of [...timing.words].sort((a, b) => a.seconds - b.seconds)) {
    // Engines may speak numeric text twice ('30%' => 'thirty percent') using the
    // same text/character position. Keep its first onset, not duplicate tokens.
    if (word.characterPosition !== undefined && word.characterPosition === previousPosition && word.text === previousText) continue;
    previousPosition = word.characterPosition; previousText = word.text;
    for (const text of tokens(word.text)) words.push({ text, seconds: word.seconds });
  }
  const requested = captions.map(tokens);
  const expected = requested.flat();
  if (!expected.length || words.length !== expected.length || words.some((word, index) => word.text !== expected[index])) return null;
  const tempo = sourceSeconds / targetSeconds;
  let cursor = 0;
  const cues = captions.map((text, index) => {
    const count = requested[index].length;
    const start = Math.min(targetSeconds, words[cursor].seconds / tempo);
    cursor += count;
    const end = index === captions.length - 1 ? targetSeconds : Math.min(targetSeconds, words[cursor].seconds / tempo);
    return { text, start, end, duration: end - start };
  });
  return cues.every(cue => cue.duration > 0) ? cues : null;
}

const openForViseme = (viseme: number) => viseme === 0 || viseme === 21 ? 0
  : [1, 2, 3, 4, 5, 9, 10, 11].includes(viseme) ? .9 : [6, 7, 8, 12, 13].includes(viseme) ? .55 : .25;

/** Uses measured mouth events, including silence. Narrators do not move cast mouths. */
export function kidsSpeechPerformance(timing: SpeechTiming, sourceSeconds: number, targetSeconds: number, fps = 12): KidsAnimationPerformanceFrame[] {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds <= 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0 || targetSeconds > 600 || !Number.isFinite(fps) || fps < 1 || fps > 30) throw new Error("Speech performance requires bounded measured timing.");
  const tempo = sourceSeconds / targetSeconds;
  const visemes = [...timing.visemes].sort((a, b) => a.seconds - b.seconds);
  const words = [...timing.words].sort((a, b) => a.seconds - b.seconds);
  let poseIndex = -1, wordIndex = -1;
  const frames: KidsAnimationPerformanceFrame[] = [];
  for (let frame = 0; frame < Math.ceil(targetSeconds * fps); frame++) {
    const sourceTime = frame / fps * tempo;
    while (poseIndex + 1 < visemes.length && visemes[poseIndex + 1].seconds <= sourceTime) poseIndex++;
    while (wordIndex + 1 < words.length && words[wordIndex + 1].seconds <= sourceTime) wordIndex++;
    const pose = visemes[poseIndex], word = words[wordIndex];
    const role = pose?.speaker ?? word?.speaker ?? -1;
    const speaker = role === 0 || role === 1 ? role : -1;
    const audible = !!pose && sourceTime < pose.seconds + pose.duration + .035;
    frames.push({ speaker, mouthOpen: audible && speaker !== -1 ? openForViseme(pose.viseme) : 0 });
  }
  return frames;
}

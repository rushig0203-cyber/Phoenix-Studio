/** Small, shared stock-reel planning helpers. No provider credentials or model calls. */
export type StockReelOptions = {
  audio: "auto" | "original" | "music" | "ambience-music";
  mood: "reflective" | "warm" | "journey";
  transition: "cut" | "soft";
  framing: "auto" | "fit";
  /** Missing on saved jobs: retain the legacy selected-interval recipe. */
  pacing?: "cinematic" | "selected";
  /** New automatic recipes only. Missing on older/manual jobs: no minimum. */
  minDuration?: number;
  /** Persisted only on new automatic recipes; missing retains saved timing. */
  shotCadence?: "brisk-v1" | "adaptive-v2";
  /** Optional visual boundary matching for new automatic reels. */
  continuity?: "visual-v1";
  /** Grounded catalogue greenery cue, never a user-entered visual claim. */
  sceneFocus?: "greenery";
  /** New automatic recipes preserve wide foregrounds over a tiny soft backdrop. */
  background?: "soft-v1";
  /** Automatic recipe marker; every new stock source-job obeys the same cap. */
  reusePolicy?: "four-in-18-months-v1";
  /** New automatic recipes only. Missing keeps the exact saved legacy music. */
  musicVersion?: 2;
};

export const DEFAULT_STOCK_REEL_OPTIONS: StockReelOptions = { audio: "auto", mood: "reflective", transition: "cut", framing: "auto" };
export const STOCK_REEL_FPS = 24;
export const MAX_STOCK_SHOTS = 12;
export const MAX_STOCK_REEL_BYTES = 500 * 1024 * 1024;
export const STOCK_REEL_EDIT_VERSION = 2;
export const AUTOMATIC_STOCK_SHOT_MAX_DURATION = 8;
export const BRISK_STOCK_SHOT_MAX_DURATION = 6;

/** Shared selection/planning targets, not motion analysis or beat matching. */
export function briskStockShotTarget(index: number, count: number) {
  return index === 0 ? 3 : index === count - 1 ? 4.5 : [4.5, 4, 5, 4.25, 4.75][(index - 1) % 5];
}

export type StockIntervalInput = {
  duration: number; start?: number; end?: number; trimMode?: "manual" | "auto";
  /** Bounded low-resolution frame-delta measurements. Windows use source seconds. */
  motionWindows?: Array<{ start: number; end: number; motion: number }>;
};
export type StockInterval = { start: number; end: number; outputStart: number; outputEnd: number; frames: number; speed?: number };

/**
 * Reorder measured cuts, not their source bounds. Planning again after appearance
 * sampling would move the boundaries that supplied the visual evidence. Rebasing
 * only output time also keeps speed and the exact total picture-frame budget.
 * Beat alignment from the previous order is not a guarantee in the new order.
 */
export function reorderStockIntervals(intervals: StockInterval[], order: readonly number[]): StockInterval[] {
  if (!intervals.length || intervals.length > MAX_STOCK_SHOTS || order.length !== intervals.length
    || new Set(order).size !== intervals.length || order.some(index => !Number.isSafeInteger(index) || index < 0 || index >= intervals.length)) {
    throw new Error("Visual shot order must be a complete bounded permutation.");
  }
  let originalFrames = 0;
  for (const interval of intervals) {
    const speed = interval.speed ?? 1;
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start < 0 || interval.end <= interval.start
      || !Number.isSafeInteger(interval.frames) || interval.frames < 1 || !Number.isFinite(speed) || speed < 1 || speed > 1.4
      || !Number.isFinite(interval.outputStart) || !Number.isFinite(interval.outputEnd)
      || Math.abs(interval.outputStart - originalFrames / STOCK_REEL_FPS) > 1e-6
      || Math.abs(interval.outputEnd - (originalFrames + interval.frames) / STOCK_REEL_FPS) > 1e-6
      || Math.abs(interval.end - interval.start - interval.frames / STOCK_REEL_FPS * speed) > 1e-6) {
      throw new Error("Visual shot ordering requires exact, contiguous measured picture intervals.");
    }
    originalFrames += interval.frames;
  }
  if (originalFrames > 105 * STOCK_REEL_FPS) throw new Error("The reordered footage exceeds the bounded reel length.");
  let cursor = 0;
  return order.map(index => {
    const interval = intervals[index], outputStart = cursor / STOCK_REEL_FPS;
    cursor += interval.frames;
    return { ...interval, outputStart, outputEnd: cursor / STOCK_REEL_FPS };
  });
}

/** A modest preview window, not a claim to have detected a source's best action. */
export function suggestStockTrim(duration: number, singleShot = false) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("A selected shot has no readable duration.");
  return { start: 0, end: Math.min(duration, singleShot ? 12 : 6), trimMode: "auto" as const };
}

/**
 * Omitted pacing retains the legacy cap recipe for saved jobs. New cinematic
 * edits shorten only explicitly automatic windows; owner trims never move.
 * All intervals play at native speed, and short sequences are never padded.
 * The opt-in automatic minimum uses whole source frames and may expand real
 * windows up to eight seconds after additional related sources are exhausted.
 * The separately saved brisk cadence keeps a three-second opening and caps
 * real windows at six seconds. Missing cadence retains every older recipe.
 */
export function planStockIntervals(shots: StockIntervalInput[], maximum: number, pacing?: StockReelOptions["pacing"], minDuration?: number, shotCadence?: StockReelOptions["shotCadence"], rhythm?: { bpm: number }): StockInterval[] {
  if (!shots.length || shots.length > MAX_STOCK_SHOTS || !Number.isFinite(maximum) || maximum <= 0 || maximum > 105) throw new Error("Choose one to twelve shots and a reel length up to 105 seconds.");
  if (pacing !== undefined && pacing !== "cinematic" && pacing !== "selected") throw new Error("Choose cinematic pacing or keep the selected moments.");
  if (shotCadence !== undefined && shotCadence !== "brisk-v1" && shotCadence !== "adaptive-v2") throw new Error("Choose the supported automatic shot cadence.");
  const selected = shots.map(shot => {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) throw new Error("A selected shot has no readable duration.");
    const start = shot.start ?? 0, end = shot.end ?? shot.duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= shot.duration || end > shot.duration + .15) throw new Error("A shot's trim lies outside the available footage. Choose its interval again.");
    if (shot.trimMode !== undefined && shot.trimMode !== "manual" && shot.trimMode !== "auto") throw new Error("A shot has an invalid trim mode.");
    return { start, end: Math.min(end, shot.duration), automatic: shot.trimMode === "auto" };
  });
  if (shotCadence === "adaptive-v2") {
    if (pacing !== "cinematic" || minDuration !== undefined || maximum < 18 || maximum > 40 || shots.length < 4 || shots.length > 10 || selected.some(shot => !shot.automatic)) {
      throw new Error("Adaptive cadence requires four to ten automatic cinematic shots, no minimum, and an 18–40-second cap.");
    }
    const windows = selected.map((shot, index) => {
      const measured = shots[index].motionWindows;
      if (measured !== undefined && !Array.isArray(measured)) throw new Error("A shot has invalid motion windows.");
      for (const window of measured ?? []) {
        if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end <= window.start || window.end > shots[index].duration + 1e-7 || !Number.isFinite(window.motion) || window.motion < 0 || window.motion > 255) {
          throw new Error("A motion window lies outside its source or has an invalid motion score.");
        }
      }
      const candidates = (measured ?? []).map(window => ({
        start: Math.max(shot.start, window.start), end: Math.min(shot.end, window.end), motion: window.motion,
      })).filter(window => window.end > window.start);
      // Frame delta is only a movement cue. A high score selects its measured
      // window; absent measurements fall back to the centre of the trim.
      const best = candidates.reduce<typeof candidates[number] | undefined>((winner, window) => !winner || window.motion > winner.motion ? window : winner, undefined);
      return best ?? { start: shot.start, end: shot.end, motion: undefined };
    });
    let speeds = windows.map(window => window.motion !== undefined && window.motion < 4 ? 1.25 : 1);
    const ceilings = selected.map((_shot, index) => Math.floor((index === 0 ? 2.25 : 3.5) * STOCK_REEL_FPS + 1e-7));
    const capacitiesAtSpeed = () => windows.map((window, index) => Math.min(ceilings[index], Math.floor(((window.end - window.start) / speeds[index]) * STOCK_REEL_FPS + 1e-7)));
    let capacities = capacitiesAtSpeed();
    if (capacities.reduce((sum, frames) => sum + frames, 0) < 12 * STOCK_REEL_FPS && speeds.some(speed => speed > 1)) {
      // Preserve the twelve-second minimum at native speed when the selected
      // low-motion windows cannot support the modest fast-forward pass.
      speeds = speeds.map(() => 1);
      capacities = capacitiesAtSpeed();
    }
    if (capacities.some(frames => frames < 1) || capacities.reduce((sum, frames) => sum + frames, 0) < 12 * STOCK_REEL_FPS) {
      throw new Error("Not enough meaningful source footage for an adaptive reel; add more related videos or use wider source windows.");
    }
    const cap = Math.floor(Math.min(maximum, 32) * STOCK_REEL_FPS + 1e-7);
    const naturalSeconds = windows.map((window, index) => {
      if (index === 0) return 2;
      if (window.motion === undefined) return [2.6, 3.1, 2.9, 3.3, 2.7][(index - 1) % 5];
      if (window.motion < 4) return 2.7 + window.motion / 4 * .7;
      if (window.motion < 20) return 2.7 - (window.motion - 4) / 16 * .3;
      return 2.7 - Math.min(1, (window.motion - 20) / 235) * .7;
    });
    let budgets = capacities.map((capacity, index) => Math.min(capacity, Math.floor(naturalSeconds[index] * STOCK_REEL_FPS + 1e-7)));
    const addFrames = (target: number) => {
      let remaining = target - budgets.reduce((sum, frames) => sum + frames, 0);
      while (remaining > 0) {
        const room = capacities.map((capacity, index) => capacity - budgets[index]);
        const totalRoom = room.reduce((sum, frames) => sum + frames, 0);
        if (!totalRoom) break;
        const allocations = room.map(frames => remaining * frames / totalRoom);
        const additions = allocations.map((amount, index) => Math.min(room[index], Math.floor(amount)));
        budgets = budgets.map((frames, index) => frames + additions[index]);
        remaining -= additions.reduce((sum, frames) => sum + frames, 0);
        if (remaining > 0) {
          const order = allocations.map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
            .filter(item => budgets[item.index] < capacities[item.index])
            .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
          if (!order.length) break;
          for (const { index } of order) if (remaining > 0 && budgets[index] < capacities[index]) { budgets[index]++; remaining--; }
        }
      }
    };
    // The minimum is a meaningful-footage floor, not a target to fill every reel.
    if (budgets.reduce((sum, frames) => sum + frames, 0) < 12 * STOCK_REEL_FPS) addFrames(12 * STOCK_REEL_FPS);
    if (budgets.reduce((sum, frames) => sum + frames, 0) > cap) {
      const excessBefore = budgets.reduce((sum, frames) => sum + frames, 0) - cap;
      let excess = excessBefore;
      const reducible = budgets.map(frames => Math.max(0, frames - 1));
      const totalReducible = reducible.reduce((sum, frames) => sum + frames, 0);
      const allocations = reducible.map(frames => excessBefore * frames / totalReducible);
      const reductions = allocations.map(Math.floor);
      budgets = budgets.map((frames, index) => frames - reductions[index]);
      excess -= reductions.reduce((sum, frames) => sum + frames, 0);
      const order = allocations.map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
        .filter(item => budgets[item.index] > 1).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
      for (const { index } of order) if (excess > 0 && budgets[index] > 1) { budgets[index]--; excess--; }
    }
    if (rhythm !== undefined) {
      if (!Number.isFinite(rhythm.bpm) || rhythm.bpm < 40 || rhythm.bpm > 180) throw new Error("Instrumental rhythm must be between 40 and 180 BPM.");
      const totalFrames = budgets.reduce((sum, frames) => sum + frames, 0);
      const beatFrames = STOCK_REEL_FPS * 60 / rhythm.bpm;
      const boundaries: number[] = [];
      let boundary = 0;
      for (let index = 0; index < budgets.length - 1; index += 1) {
        boundary += budgets[index];
        boundaries.push(boundary);
      }
      // Align cumulative edits only when a real instrumental beat is within
      // four frames. Shot lengths remain individually varied and source-bound.
      for (let index = 0; index < boundaries.length; index += 1) {
        const original = budgets.slice(0, index + 1).reduce((sum, frames) => sum + frames, 0);
        const beat = Math.round(Math.round(original / beatFrames) * beatFrames);
        if (Math.abs(beat - original) > 4) continue;
        const candidate = [...boundaries];
        candidate[index] = beat;
        const adjusted = candidate.map((point, at) => point - (at ? candidate[at - 1] : 0));
        adjusted.push(totalFrames - candidate[candidate.length - 1]);
        if (adjusted.every((frames, at) => frames >= 1 && frames <= capacities[at])) boundaries[index] = beat;
      }
      budgets = boundaries.map((point, index) => point - (index ? boundaries[index - 1] : 0));
      budgets.push(totalFrames - boundaries[boundaries.length - 1]);
    }
    let cursor = 0;
    return windows.map((window, index) => {
      const frames = budgets[index], speed = speeds[index], length = frames / STOCK_REEL_FPS * speed;
      const start = window.start + (window.end - window.start - length) / 2;
      const outputStart = cursor / STOCK_REEL_FPS;
      cursor += frames;
      return { start, end: start + length, outputStart, outputEnd: cursor / STOCK_REEL_FPS, frames, speed };
    });
  }
  if (shotCadence === "brisk-v1" && (pacing !== "cinematic" || minDuration !== 40 || maximum < 40 || maximum > 45 || shots.length < 8 || shots.length > 10 || selected.some(shot => !shot.automatic))) throw new Error("Brisk cadence requires eight to ten automatic shots and a 40-second minimum within a 40–45-second cap.");
  if (minDuration !== undefined) {
    if (!Number.isFinite(minDuration) || minDuration <= 0 || minDuration > maximum || pacing !== "cinematic" || selected.some(shot => !shot.automatic)) throw new Error("A minimum reel length requires automatic cinematic intervals within the length cap.");
    // Whole source frames only: audio packet padding and fractional catalog
    // seconds cannot supply an extra picture frame or justify frozen endings.
    const capacities = selected.map((shot, index) => Math.floor(Math.min(shotCadence ? index === 0 ? 3 : BRISK_STOCK_SHOT_MAX_DURATION : AUTOMATIC_STOCK_SHOT_MAX_DURATION, shot.end - shot.start) * STOCK_REEL_FPS + 1e-7));
    const required = Math.ceil(minDuration * STOCK_REEL_FPS - 1e-7), cap = Math.floor(maximum * STOCK_REEL_FPS + 1e-7);
    if (required > cap) throw new Error("The minimum and length cap cannot both fit whole native video frames. Increase the cap slightly.");
    if (capacities.reduce((sum, frames) => sum + frames, 0) < required || capacities.some(frames => frames < 1)) throw new Error(`Not enough related footage for a ${minDuration}-second reel at original speed. Add more related videos or try a broader topic; Phoenix will not slow, repeat or pad footage.`);
    const desired = capacities.map((capacity, index) => Math.min(capacity, Math.round((shotCadence ? briskStockShotTarget(index, shots.length) : shots.length === 1 ? 12 : index === 0 ? 5 : index === shots.length - 1 ? 7 : [5.5, 4.5, 6.25, 5, 6.5][(index - 1) % 5]) * STOCK_REEL_FPS)));
    const floors = desired.map(frames => Math.min((shotCadence ? 3 : 4) * STOCK_REEL_FPS, frames));
    const natural = desired.reduce((sum, frames) => sum + frames, 0), target = Math.min(cap, Math.max(required, natural));
    if (floors.reduce((sum, frames) => sum + frames, 0) > target) throw new Error("Too many source shots fit this length cap. Use fewer related videos rather than rushing the sequence.");
    const base = natural > target ? floors : desired, limits = natural > target ? desired : capacities;
    const remaining = target - base.reduce((sum, frames) => sum + frames, 0), room = limits.map((limit, index) => limit - base[index]), totalRoom = room.reduce((sum, frames) => sum + frames, 0);
    const extra = room.map(frames => totalRoom ? remaining * frames / totalRoom : 0), budgets = base.map((frames, index) => frames + Math.floor(extra[index]));
    let remainder = target - budgets.reduce((sum, frames) => sum + frames, 0);
    const order = extra.map((frames, index) => ({ index, fraction: frames - Math.floor(frames) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const { index } of order) if (remainder > 0 && budgets[index] < limits[index]) { budgets[index]++; remainder--; }
    let cursor = 0;
    return selected.map((shot, index) => {
      const frames = budgets[index], length = frames / STOCK_REEL_FPS, outputStart = cursor / STOCK_REEL_FPS;
      cursor += frames;
      const start = index === 0 ? shot.start : index === selected.length - 1 ? shot.end - length : shot.start + (shot.end - shot.start - length) / 2;
      return { start, end: start + length, outputStart, outputEnd: cursor / STOCK_REEL_FPS, frames };
    });
  }
  if (pacing !== undefined) {
    const automatic = selected.map(shot => pacing === "cinematic" && shot.automatic);
    const desired = selected.map((shot, index) => {
      const available = shot.end - shot.start;
      if (!automatic[index]) return available;
      const target = shots.length === 1 ? 12 : index === 0 ? 5 : index === shots.length - 1 ? 7 : [5.5, 4.5, 6.25, 5, 6.5][(index - 1) % 5];
      return Math.min(available, target);
    });
    const minimum = desired.map((seconds, index) => automatic[index] ? Math.min(4, seconds) : seconds);
    const minimumTotal = minimum.reduce((sum, seconds) => sum + seconds, 0);
    if (minimumTotal > maximum + 1e-7) throw new Error("These selected moments do not fit the length cap without cutting your manual trims or rushing the sequence. Increase the maximum length or remove a shot.");
    const desiredTotal = desired.reduce((sum, seconds) => sum + seconds, 0);
    const surplus = desiredTotal - minimumTotal;
    const proportion = desiredTotal <= maximum || surplus <= 0 ? 1 : Math.max(0, (maximum - minimumTotal) / surplus);
    let cumulative = 0, frameCursor = 0;
    return selected.map((shot, index) => {
      const length = minimum[index] + (desired[index] - minimum[index]) * proportion;
      cumulative += length;
      const nextFrame = Math.round(cumulative * STOCK_REEL_FPS), frames = nextFrame - frameCursor;
      if (frames < 1) throw new Error("A selected interval is shorter than one video frame.");
      const outputStart = frameCursor / STOCK_REEL_FPS, outputEnd = nextFrame / STOCK_REEL_FPS;
      frameCursor = nextFrame;
      // The first automatic window keeps its opening; the last keeps its ending.
      // Middle windows sample the centre. This is a pacing heuristic, not vision.
      const start = !automatic[index] || shots.length === 1 || index === 0 ? shot.start
        : index === shots.length - 1 ? shot.end - length
          : shot.start + (shot.end - shot.start - length) / 2;
      return { start, end: automatic[index] ? start + length : shot.end, outputStart, outputEnd, frames };
    });
  }
  const total = selected.reduce((sum, shot) => sum + shot.end - shot.start, 0);
  const scale = Math.min(1, maximum / total);
  let cumulative = 0, frameCursor = 0;
  return selected.map(shot => {
    cumulative += (shot.end - shot.start) * scale;
    const nextFrame = Math.round(cumulative * STOCK_REEL_FPS);
    const frames = nextFrame - frameCursor;
    if (frames < 1) throw new Error("A selected interval is shorter than one video frame.");
    const outputStart = frameCursor / STOCK_REEL_FPS, outputEnd = nextFrame / STOCK_REEL_FPS;
    frameCursor = nextFrame;
    // Keep the selected ending when the total exceeds the cap, instead of cutting
    // the last action off halfway. The UI displays the shortened source interval.
    const end = shot.end, start = Math.max(shot.start, end - frames / STOCK_REEL_FPS);
    return { start, end, outputStart, outputEnd, frames };
  });
}

/** Check picture duration, never the audio-padded MP4 container duration. */
export function assertStockReelMinimum(pictureDuration: number | undefined, minDuration?: number) {
  if (minDuration !== undefined && (!Number.isFinite(pictureDuration) || pictureDuration! + 1e-6 < minDuration)) throw new Error(`The rendered picture is shorter than the required ${minDuration} seconds. The reel was not completed; retry to rebuild from the saved sources.`);
}

export function stockPortraitScore(video: { width: number; height: number; duration: number }) {
  const ratio = video.width / video.height;
  return (ratio <= .7 ? 3 : ratio < 1 ? 2 : 0) + Math.min(1, Math.min(video.width, video.height) / 720) * .2;
}

/** Fill only when the native aspect already retains at least 92% of the picture. */
export function stockFraming(info: { width: number; height: number }, mode: StockReelOptions["framing"] = "auto", softBackground = false) {
  const aspect = info.width / info.height, target = 720 / 1280;
  const retained = Math.min(aspect / target, target / aspect);
  const fills = mode === "auto" && retained >= .92;
  return {
    name: "9:16" as const, width: 720, height: 1280,
    filter: fills
      ? "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1"
      : mode === "auto" && softBackground
        ? "split[backdrop][foreground];[backdrop]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=8:2,scale=720:1280[soft];[foreground]scale=720:1280:force_original_aspect_ratio=decrease[whole];[soft][whole]overlay=(W-w)/2:(H-h)/2,setsar=1"
      : "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#121615,setsar=1",
    description: fills ? `Native portrait frame fills 9:16; ${Math.round(retained * 100)}% of the picture retained`
      : mode === "auto" && softBackground ? "Entire source foreground retained over a low-resolution softened same-source 9:16 backdrop; no subject crop"
        : "Entire source picture retained inside a quiet dark-neutral 9:16 frame",
  };
}

/** A quiet stream can be valuable ambience. Only absent/nearly digital-silent audio is replaced automatically. */
export function stockAudioUsable(hasAudio: boolean, mean: number, peak: number) {
  return hasAudio && Number.isFinite(mean) && Number.isFinite(peak) && mean > -85 && peak > -75;
}

export function stockMusicMixGain(sourceMeans: number[]) {
  const measured = sourceMeans.filter(Number.isFinite);
  // This composition is around -24 dB RMS. Keep its bed roughly 12 dB below
  // even the quietest retained source, rather than burying a quiet stream.
  return measured.length ? Math.min(.28, 10 ** ((Math.min(...measured) + 12) / 20)) : 1;
}

export function stockShotFades(duration: number, index: number, count: number, transition: StockReelOptions["transition"]) {
  const fade = Math.min(.18, duration / 8);
  const video = transition === "soft" ? `${index > 0 ? `,fade=t=in:st=0:d=${fade.toFixed(3)}` : ""}${index < count - 1 ? `,fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}` : ""}` : "";
  // Tiny sound ramps remove clicks at edits; preserve the actual nature sound and its duration.
  const audio = `${index > 0 ? ",afade=t=in:st=0:d=0.035" : ""}${index < count - 1 ? `,afade=t=out:st=${Math.max(0, duration - .035).toFixed(3)}:d=0.035` : ""}`;
  return { video, audio };
}

/**
 * Original lightweight instrumentals. Articulated harmonic piano voices,
 * seeded melodic phrases, gentle rhythm and a tonic outro replace a continuous
 * foreground sine pad. One 24 kHz
 * stereo PCM buffer stays below 11 MB at 105 seconds: no model or copied song.
 * This music is not analysed against, or claimed to be beat-synced to, footage.
 */
export function stockMusicWav(duration: number, mood: StockReelOptions["mood"], seed: string, version?: 1 | 2) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 106) throw new Error("Local music duration exceeds the bounded reel limit.");
  if (!["reflective", "warm", "journey"].includes(mood)) throw new Error("Choose a supported instrumental mood.");
  if (version !== undefined && version !== 1 && version !== 2) throw new Error("Choose a supported saved music recipe version.");
  if (version === 2) return variedStockMusicWav(duration, mood, seed);
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const sampleRate = 24000, channels = 2, length = Math.ceil(duration * sampleRate), dataBytes = length * channels * 2;
  const pcm = Buffer.alloc(44 + dataBytes);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + dataBytes, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(channels, 22); pcm.writeUInt32LE(sampleRate, 24); pcm.writeUInt32LE(sampleRate * channels * 2, 28); pcm.writeUInt16LE(channels * 2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(dataBytes, 40);
  const progressions = mood === "journey" ? [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] : mood === "warm" ? [[0, 4, 7, 11], [5, 9, 12, 16], [9, 12, 16, 19], [7, 11, 14, 17]] : [[0, 3, 7, 10], [8, 12, 15, 19], [5, 8, 12, 15], [7, 10, 14, 17]];
  const tonic = 48 + hash % 7, beat = 60 / (mood === "journey" ? 94 + hash % 9 : mood === "warm" ? 80 + hash % 9 : 68 + hash % 7);
  const chordLength = beat * 4, phraseOffset = (hash >>> 9) % 4;
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  const phrases = [[0, 1, 2, 1, 3, 2, 1, 0], [0, 2, 1, -1, 2, 3, 1, 0], [2, 1, 0, 1, 3, 2, -1, 0], [0, -1, 1, 2, 1, 3, 2, 0]];
  // Small fixed tables: no samples, model, extra buffers or external service.
  const chords = progressions.map(chord => chord.map(note => frequency(tonic + note)));
  const basses = progressions.map(chord => frequency(tonic + chord[0] - 12));
  const outroBar = Math.max(0, Math.floor((duration - beat * 3) / chordLength));
  const piano = (pitch: number, age: number, gate: number) => {
    if (age < 0 || age >= gate) return 0;
    const attack = Math.min(1, age / .009), release = Math.min(1, (gate - age) / .075), angle = 2 * Math.PI * pitch * age;
    // Higher partials decay faster than the fundamental, giving each clean
    // note a short bright attack and a softer tail rather than a sustained beep.
    return (Math.sin(angle) * .74 + Math.sin(angle * 2.002) * .23 * Math.exp(-age * 2.4)
      + Math.sin(angle * 3.004) * .10 * Math.exp(-age * 4.8)) * attack * release * Math.exp(-age * 2.5);
  };
  let randomState = hash || 1, brush = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate, chordNumber = Math.floor(time / chordLength), closing = chordNumber >= outroBar;
    const chordIndex = closing ? 0 : chordNumber % 4, chord = chords[chordIndex];
    const local = time % chordLength, padEnvelope = Math.min(1, local / .16) * Math.min(1, (chordLength - local) / .22);
    let padLeft = 0, padRight = 0;
    for (let voice = 0; voice < chord.length; voice += 1) {
      const angle = 2 * Math.PI * chord[voice] * time;
      padLeft += Math.sin(angle + voice * .18) / chord.length;
      padRight += Math.sin(angle + voice * .18 + .23) / chord.length;
    }
    const beatNumber = Math.floor(time / beat), step = beatNumber % 8, phrase = phrases[(Math.floor(beatNumber / 8) + phraseOffset) % phrases.length];
    const pattern = closing && step >= 6 ? 0 : phrase[step], age = time % beat;
    const note = pattern < 0 || beatNumber < 2 ? 0 : chord[pattern % chord.length] * 2;
    const melody = note ? piano(note, age, beat) : 0, echo = note ? piano(note, age - .13, beat - .13) : 0;
    const eighthNumber = Math.floor(time / (beat / 2)), eighthAge = time % (beat / 2);
    const arpVoice = [0, 1, 2, 1, 0, 2, 1, 2][(eighthNumber + (hash >>> 13)) % 8] % chord.length;
    const arp = piano(chord[arpVoice], eighthAge, beat / 2);
    const pan = step % 2 ? .64 : .36, arrangement = Math.min(1, time / (beat * 3));
    const bassAge = time % (beat * 2), bass = piano(basses[chordIndex], bassAge, beat * 2);
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    const noise = (randomState >>> 0) / 2147483648 - 1;
    brush += (noise - brush) * .08;
    const rhythm = brush * Math.min(1, eighthAge / .002) * Math.exp(-eighthAge * 45) * (mood === "reflective" ? .004 : .014) * arrangement;
    const kick = mood === "reflective" ? 0 : Math.sin(2 * Math.PI * (48 * bassAge + 12 * (1 - Math.exp(-bassAge * 18)) / 18)) * Math.min(1, bassAge / .005) * Math.exp(-bassAge * 15) * .025 * arrangement;
    const endFade = Math.min(1, time / .35, Math.max(0, duration - time) / 1.1);
    const common = bass * .045 * arrangement + rhythm + kick;
    const left = (padLeft * .018 * padEnvelope + melody * .16 * (1 - pan) + echo * .032 * pan + arp * .045 * (step % 2 ? .65 : .9) + common) * endFade;
    const right = (padRight * .018 * padEnvelope + melody * .16 * pan + echo * .032 * (1 - pan) + arp * .045 * (step % 2 ? .9 : .65) + common) * endFade;
    pcm.writeInt16LE(Math.round(Math.max(-.68, Math.min(.68, left)) * 32767), 44 + index * 4);
    pcm.writeInt16LE(Math.round(Math.max(-.68, Math.min(.68, right)) * 32767), 46 + index * 4);
  }
  return pcm;
}

export type StockMusicArrangement = {
  version: 2; id: string; seedHash: number;
  style: "felt-piano" | "soft-plucks" | "bell-pad" | "airy-keys";
  tonic: number; key: string; bpm: number;
  progression: number; melody: number; rhythm: number; accompaniment: number;
};

/**
 * Independent recipe choices, not just a transposed copy of one piano pattern.
 * Stable saved-job seed makes retries reproducible; no history read or service.
 * Mood is a broad cue only, not audio/visual analysis or beat matching.
 */
export function stockMusicArrangement(mood: StockReelOptions["mood"], seed: string): StockMusicArrangement {
  if (!["reflective", "warm", "journey"].includes(mood)) throw new Error("Choose a supported instrumental mood.");
  if (typeof seed !== "string" || !seed.length || seed.length > 256) throw new Error("A bounded saved reel seed is required for varied music.");
  let hash = 2166136261;
  for (const char of `${mood}:${seed}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  let state = hash || 1;
  const pick = (count: number) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % count;
  };
  const style = (["felt-piano", "soft-plucks", "bell-pad", "airy-keys"] as const)[pick(4)];
  const tonic = 48 + pick(12), bpm = (mood === "reflective" ? 64 : mood === "warm" ? 78 : 90) + pick(mood === "journey" ? 23 : 19);
  const key = `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][tonic % 12]} ${mood === "reflective" ? "minor" : "major"}`;
  return { version: 2, id: hash.toString(36).padStart(7, "0"), seedHash: hash, style, tonic, key, bpm, progression: pick(4), melody: pick(8), rhythm: pick(4), accompaniment: pick(4) };
}

export function stockMusicArrangementDescription(mood: StockReelOptions["mood"], seed: string) {
  const recipe = stockMusicArrangement(mood, seed);
  return `Music recipe v2 ${recipe.id}: ${recipe.style.replaceAll("-", " ")}, ${recipe.key}, ${recipe.bpm} BPM; harmonic path ${recipe.progression + 1}, melody ${recipe.melody + 1}, rhythm ${recipe.rhythm + 1}, accompaniment ${recipe.accompaniment + 1}; deterministic saved-reel variation, not a trending-song or beat-sync claim`;
}

/** One output PCM buffer; compact fixed note tables, with no audio samples/models. */
function variedStockMusicWav(duration: number, mood: StockReelOptions["mood"], seed: string) {
  const recipe = stockMusicArrangement(mood, seed);
  const sampleRate = 24000, length = Math.ceil(duration * sampleRate), pcm = Buffer.alloc(44 + length * 4);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + length * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(sampleRate, 24); pcm.writeUInt32LE(sampleRate * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(length * 4, 40);
  const major = [[0, 4, 7, 11], [2, 5, 9, 12], [5, 9, 12, 16], [7, 11, 14, 17], [9, 12, 16, 19]];
  const minor = [[0, 3, 7, 10], [2, 5, 8, 12], [5, 8, 12, 15], [7, 10, 14, 17], [8, 12, 15, 19]];
  const order = [[0, 2, 4, 3], [0, 4, 2, 3], [0, 1, 2, 0], [0, 3, 2, 0]][recipe.progression];
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  const chords = order.map(chord => (mood === "reflective" ? minor : major)[chord].map(note => frequency(recipe.tonic + note)));
  const phrases = [
    [0, -1, 1, 2, -1, 1, 3, -1, 2, 1, -1, 0, 1, -1, 2, 0],
    [2, 1, -1, 0, -1, 1, 2, -1, 3, -1, 2, 1, -1, 0, -1, 0],
    [0, 2, -1, 1, 0, -1, 1, 3, -1, 2, 1, -1, 2, 0, -1, 0],
    [1, -1, 0, -1, 2, 3, -1, 2, 1, -1, 2, 0, -1, 1, -1, 0],
    [0, -1, -1, 1, 2, -1, 3, 2, -1, 1, 0, -1, 2, -1, 1, 0],
    [2, -1, 3, -1, 1, 2, -1, 0, 1, -1, 2, -1, 3, 1, -1, 0],
    [0, 1, -1, 2, 1, -1, 0, -1, 2, 3, -1, 1, -1, 2, -1, 0],
    [1, -1, 2, 1, -1, 0, 2, -1, 3, 2, -1, 1, 0, -1, -1, 0],
  ];
  const rhythms = [[1, 0, 1, 0, 1, 1, 0, 1], [1, 0, 0, 1, 1, 0, 1, 0], [1, 1, 0, 1, 0, 1, 1, 0], [1, 0, 1, 1, 0, 0, 1, 0]][recipe.rhythm];
  const arpeggios = [[0, 1, 2, 1, 3, 2, 1, 2], [0, 2, 1, 3, 2, 1, 0, 1], [2, 0, 1, 0, 2, 3, 1, 0], [0, 3, 1, 2, 0, 1, 3, 2]][recipe.accompaniment];
  const beat = 60 / recipe.bpm, stepLength = beat / 2, chordLength = beat * 4;
  const outroBar = Math.max(1, Math.floor((duration - beat * 3) / chordLength));
  const styleIndex = ["felt-piano", "soft-plucks", "bell-pad", "airy-keys"].indexOf(recipe.style);
  // Lead, accompanying pluck, pad, pulse: each arrangement has a genuinely
  // different balance, articulation and harmonic spectrum at comparable level.
  const balances = [[.18, .026, .023, .007], [.17, .042, .011, .016], [.105, .02, .034, .005], [.18, .014, .028, .012]][styleIndex];
  const voice = (pitch: number, age: number, gate: number, instrument: number) => {
    if (age < 0 || age >= gate) return 0;
    const attack = Math.min(1, age / (instrument === 3 ? .038 : instrument === 1 ? .007 : .014));
    const release = Math.min(1, (gate - age) / .09), angle = 2 * Math.PI * pitch * age;
    let signal: number;
    if (instrument === 1) signal = (Math.sin(angle) * .77 + Math.sin(angle * 2) * .20 * Math.exp(-age * 5) + Math.sin(angle * 3) * .10 * Math.exp(-age * 7)) * Math.exp(-age * 3.3);
    else if (instrument === 2) signal = (Math.sin(angle) * .74 + Math.sin(angle * 2.01) * .19 * Math.exp(-age * 3) + Math.sin(angle * 3.97) * .12 * Math.exp(-age * 6)) * Math.exp(-age * 2.7);
    else if (instrument === 3) signal = (Math.sin(angle) * .85 + Math.sin(angle * 3) * .11 + Math.sin(angle * 5) * .035) * Math.exp(-age * 1.6);
    else signal = (Math.sin(angle) * .84 + Math.sin(angle * 2.001) * .14 * Math.exp(-age * 3.8) + Math.sin(angle * 3.003) * .05 * Math.exp(-age * 5.5)) * Math.exp(-age * 2.2);
    return signal * attack * release;
  };
  const leadAt = (time: number) => {
    if (time < beat * 1.5) return 0;
    const chordNumber = Math.floor(time / chordLength), closing = chordNumber >= outroBar;
    const chord = chords[closing ? 0 : chordNumber % 4], step = Math.floor(time / stepLength), localStep = step % 16;
    const phraseIndex = (recipe.melody + Math.floor(step / 32) + ((recipe.seedHash >>> (Math.floor(step / 32) % 16)) & 1)) % phrases.length;
    const degree = closing && localStep >= 10 ? localStep === 10 ? 0 : -1 : phrases[phraseIndex][localStep];
    if (degree < 0 || (!closing && !rhythms[localStep % 8])) return 0;
    const pitch = chord[degree % chord.length] * (styleIndex === 2 ? 1 : 2), age = time % stepLength;
    return voice(pitch, age, stepLength, styleIndex);
  };
  let randomState = recipe.seedHash || 1, brush = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate, bar = Math.floor(time / chordLength), closing = bar >= outroBar;
    const chordIndex = closing ? 0 : bar % 4, chord = chords[chordIndex], local = time % chordLength;
    const chordEnvelope = Math.min(1, local / .24) * Math.min(1, (chordLength - local) / .26);
    let padLeft = 0, padRight = 0;
    for (let part = 0; part < chord.length; part += 1) {
      const angle = 2 * Math.PI * chord[part] * time;
      padLeft += Math.sin(angle + part * .21) / chord.length;
      padRight += Math.sin(angle + part * .21 + .18) / chord.length;
    }
    const step = Math.floor(time / stepLength), age = time % stepLength, accompanimentStep = step % 8;
    const arpPitch = chord[arpeggios[accompanimentStep] % chord.length];
    const arp = !closing && (styleIndex !== 3 || accompanimentStep % 2 === 0) ? voice(arpPitch, age, stepLength, styleIndex === 1 ? 0 : 1) : 0;
    const melody = leadAt(time), echo = leadAt(time - (styleIndex === 2 ? .21 : .13));
    const bassAge = time % (beat * 2), bass = voice(chord[0] / 2, bassAge, beat * 2, 3);
    const build = Math.min(1, time / (beat * 4)), pulseAge = time % beat;
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    brush += (((randomState >>> 0) / 2147483648 - 1) - brush) * .06;
    const pulse = !closing && rhythms[accompanimentStep] ? brush * Math.min(1, age / .004) * Math.exp(-age * 38) * balances[3] * build : 0;
    const kick = mood !== "reflective" && styleIndex !== 2 && !closing ? Math.sin(2 * Math.PI * (48 * pulseAge + .6 * (1 - Math.exp(-pulseAge * 18)))) * Math.min(1, pulseAge / .006) * Math.exp(-pulseAge * 16) * .014 * build : 0;
    const pan = ((step + recipe.accompaniment) % 4) / 12 + .36;
    const fade = Math.min(1, time / .5, Math.max(0, duration - time) / 1.25);
    const common = bass * .036 * build + pulse + kick;
    const left = (padLeft * balances[2] * chordEnvelope + melody * balances[0] * (1 - pan) + echo * balances[0] * .14 * pan + arp * balances[1] * .78 + common) * fade;
    const right = (padRight * balances[2] * chordEnvelope + melody * balances[0] * pan + echo * balances[0] * .14 * (1 - pan) + arp * balances[1] * .60 + common) * fade;
    pcm.writeInt16LE(Math.round(Math.max(-.68, Math.min(.68, left)) * 32767), 44 + index * 4);
    pcm.writeInt16LE(Math.round(Math.max(-.68, Math.min(.68, right)) * 32767), 46 + index * 4);
  }
  return pcm;
}

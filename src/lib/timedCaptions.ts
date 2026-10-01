export type TimedCaption = { start: number; end: number; text: string };

export function parseSrt(text: string): TimedCaption[] {
  const time = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
  return text.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(\d+):(\d+):(\d+)[,.](\d{1,3})\s*-->\s*(\d+):(\d+):(\d+)[,.](\d{1,3})\n([\s\S]*)/);
    return match ? [{ start: time(...match.slice(1, 5) as [string,string,string,string]), end: time(...match.slice(5, 9) as [string,string,string,string]), text: match[9].replace(/\n/g, " ").trim() }] : [];
  });
}

export function captionSrt(cues: TimedCaption[]) {
  const stamp = (seconds: number) => {
    const value = Math.round(seconds * 1000);
    return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")},${String(value % 1000).padStart(3, "0")}`;
  };
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n");
}

export function validateTimedCaptions(cues: TimedCaption[], duration: number) {
  let end = 0;
  if (!cues.length) throw new Error("The renderer did not produce real timed captions.");
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || !cue.text.trim() || cue.start < end - .02 || cue.end <= cue.start || cue.end > duration + .15) throw new Error("Rendered caption timings are missing, overlapping or outside the video.");
    end = cue.end;
  }
  return cues;
}

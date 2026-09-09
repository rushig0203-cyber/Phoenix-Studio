// Bounded local proof: 12 seconds, one thread, no providers, and no queue writes.
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS", moduleResolution: "node" } });
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { prepareKidsAnimation, kidsAnimationSvg } = require("../src/lib/kidsAnimation");
const { localMusicWav } = require("../src/lib/kidsRenderer");
const sharp = require("sharp");

(async () => {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  const directory = path.join(process.cwd(), "storage", "Phoenix Studio Review Files", "work", "animation-quality-proof-v3");
  await fs.mkdir(directory, { recursive: true });
  const captions = ["Clap your paws together!", "Hop across a shiny puddle.", "Wave hello to every friend.", "Tap the drum and keep the beat.", "Ride the happy garden bus.", "Close your eyes and breathe."];
  const cues = captions.map((text, index) => ({ text, start: index * 2, end: (index + 1) * 2 }));
  const options = { directory, topic: "Benny Bunny and Tika Bird lead the garden parade", cues, duration: 12, aspect: "16:9", cast: ["bunny", "bird"], song: true };
  const result = await prepareKidsAnimation(options);
  await fs.writeFile(path.join(directory, "music.wav"), localMusicWav(12, true));
  await fs.writeFile(path.join(directory, "captions.srt"), cues.map((cue, index) => `${index + 1}\n00:00:${String(cue.start).padStart(2, "0")},000 --> 00:00:${String(cue.end).padStart(2, "0")},000\n${cue.text}\n`).join("\n"));
  await fs.writeFile(path.join(directory, "captions.ass"), `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Caption,Arial,36,&H00FFFFFF,&H000000FF,&H00152A3A,&H90000000,-1,0,0,0,100,100,0,0,3,2,0,8,42,42,38,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n` + cues.map(cue => `Dialogue: 0,0:00:${String(cue.start).padStart(2, "0")}.00,0:00:${String(cue.end).padStart(2, "0")}.00,Caption,,0,0,0,,${cue.text}`).join("\n"));
  for (const aspect of ["16:9", "9:16"]) {
    await sharp(Buffer.from(kidsAnimationSvg({ ...options, caption: captions[0], index: 0, frame: 3, aspect }))).png().toFile(path.join(directory, `poster-${aspect.replace(":", "-")}.png`));
  }
  const executable = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe");
  const args = ["-hide_banner", "-loglevel", "error", "-filter_threads", "1", "-filter_complex_threads", "1", "-y", "-threads", "1", "-f", "concat", "-safe", "0", "-i", "scenes.txt", "-i", "music.wav", "-vf", "fps=12,scale=1280:720,subtitles=captions.ass", "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "preview.mp4"];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: directory, windowsHide: true, stdio: "inherit" });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
  });
  console.log(JSON.stringify({ ...result, file: path.join(directory, "preview.mp4") }));
})().catch(error => { console.error(error); process.exitCode = 1; });

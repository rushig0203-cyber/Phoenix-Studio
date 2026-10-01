import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

export type KidsAnimationCue = { text: string; start: number; end: number };
export type KidsAnimationKind = "dog" | "cat" | "bunny" | "bird" | "bear" | "fox" | "fish";
export type KidsAnimationAction = "clap" | "hop" | "wave" | "march" | "sway" | "flap" | "drum" | "reach" | "sleep" | "listen";
type Prop = "rain" | "umbrella" | "flower" | "drum" | "kite" | "ball" | "star" | "gift" | "toys" | "bridge" | "letter" | "bus" | "none";
type Scene = { action: KidsAnimationAction; prop: Prop; theme: "garden" | "night" | "ocean" | "room"; close: boolean; emotion: "happy" | "worried" | "curious"; kiteState: "tangled" | "held" | "flying"; kiteCaughtHigh: boolean };
type Stage = { width: number; height: number; ground: number; y: number; size: number };

// Draw animation on twos, as in limited 2D cartoons. Reusing a four-second pose
// cycle keeps a three-minute video small and avoids thousands of render jobs.
export const KIDS_ANIMATION_FPS = 12;
const CYCLE_FRAMES = KIDS_ANIMATION_FPS * 4;
const ink = "#485365";
const tau = Math.PI * 2;
const n = (value: number) => Number(value.toFixed(2));
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = "none", sw = 3) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (x1: number, y1: number, x2: number, y2: number, fill: string, width: number) =>
  `<path d="M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

export function planKidsAnimationScene(topic: string, text: string, index = 0, previous?: Scene): Scene {
  topic = topic.toLowerCase();
  const words = text.toLowerCase();
  const theme = /ocean|underwater|fish|shark/.test(topic) ? "ocean" : /bedtime|sleep|moon|night|star/.test(topic) ? "night" : /clean|tidy|playroom|toy/.test(topic) ? "room" : "garden";
  const action: KidsAnimationAction = /clap|pat your/.test(words) ? "clap"
    : /drum|bucket|tap.*beat/.test(words) ? "drum"
    : /fly|flies/.test(words) && /kite/.test(`${topic} ${words}`) ? "reach"
    : /flap|wing|fly|flies/.test(words) ? "flap"
    : /hop|jump|bounce|splash/.test(words) ? "hop"
    : /sleep|breathe|hush|rest|close.*eyes/.test(words) ? "sleep"
    : /wave|hello|goodbye|goodnight/.test(words) ? "wave"
    : /march|step|walk|cross|follow|hurri|tiptoe/.test(words) ? "march"
    : /reach|pick|lift|carry|carried|hold|held|share|help|give|gave|pass/.test(words) ? "reach" : "sway";
  const prop: Prop = /kite/.test(topic) && /ribbon|string|spool|tangle/.test(words) ? "kite"
    : /\b(bus|wheel|vehicle|car)\b/.test(words) ? "bus"
    : /umbrella/.test(words) ? "umbrella"
    : /bucket|drum/.test(words) ? "drum"
    : /kite|windmill/.test(words) ? "kite"
    : /ball|bounce.*round/.test(words) ? "ball"
    : /flower|bloom|seed|petal/.test(words) ? "flower"
    : /rain|puddle|drip|splash|cloud/.test(words) ? "rain"
    : /star|moon|glow|lantern|firefl/.test(words) ? "star"
    : /toy|tidy|sort|clean|block/.test(words) ? "toys"
    : /bridge|stream|river|stone/.test(words) ? "bridge"
    : /letter|invitation|map|clue|ribbon/.test(words) ? "letter"
    : /present|gift|basket|snack/.test(words) ? "gift"
    // Keep the central object visible across pronouns and reaction lines.
    : /kite/.test(topic) ? "kite" : /ball/.test(topic) ? "ball"
    : /star|moon/.test(topic) ? "star" : /flower|garden/.test(topic) ? "flower" : "none";
  const resolved = /untangled|freed|set.*free|no longer.*tangl|strings? (?:was |were )?straight/.test(words);
  const tangled = !resolved && /\b(?:tangled?|stuck|caught|snagged|knotted)\b/.test(words);
  const kiteState = tangled ? "tangled" : /\b(?:flies|flying|flew|soar\w*|rose|rises|aloft)\b/.test(words) ? "flying" : resolved || /\b(?:holds?|held|carr\w*|pick\w*|build\w*)\b/.test(words) ? "held" : previous?.kiteState || "held";
  const kiteCaughtHigh = kiteState === "tangled" && (/branch|tree|vine/.test(words) || !!previous?.kiteCaughtHigh);
  const emotion = resolved || /\b(?:smil\w*|laugh\w*|relieved|happy|solved|cheer\w*)\b/.test(words) ? "happy"
    : /lost|stuck|torn|\btangle|problem|afraid|dim|sad|wrong|wobbl/.test(words) ? "worried"
    : /look|notice|wonder|clue|find|surpris/.test(words) ? "curious" : previous?.emotion || "happy";
  return { action, prop, theme, close: index % 4 === 2 && prop === "none", emotion, kiteState, kiteCaughtHigh };
}

export function planKidsPerformance(text: string, cast: [KidsAnimationKind, KidsAnimationKind], names?: [string, string], song = false) {
  const lower = text.toLowerCase();
  const aliases = cast.map((kind, index) => [kind, names?.[index], kind === "bunny" ? "rabbit" : kind === "dog" ? "puppy" : kind === "cat" ? "kitten" : ""].filter(Boolean).map(name => name!.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const mentioned = aliases.map(values => values.some(name => new RegExp(`\\b${name}\\b`).test(lower)));
  const observing = aliases.map(values => values.some(name => new RegExp(`\\b${name}\\s+(?:(?:quietly|patiently|just)\\s+)?(?:watch(?:es|ed)?|listen(?:s|ed)?|wait(?:s|ed)?|looks? on)\\b`).test(lower)));
  const shared = song || /\b(?:together|both|they|friends)\b/.test(lower) || !mentioned.some(Boolean);
  return { active: mentioned.map((value, index) => song || !observing[index] && (shared || value)), speaker: song ? -1 : /[“"]/.test(text) ? Math.max(0, mentioned.indexOf(true)) : -1 };
}

function kitePosition(stage: Stage, scene: Scene, phase: number) {
  const flying = scene.kiteState === "flying";
  return { x: stage.width / 2 + (flying ? Math.sin(phase) * 25 : 0), y: flying || scene.kiteCaughtHigh ? (stage.height > stage.width ? stage.ground - 308 : stage.ground - 178) + (flying ? Math.cos(phase) * 9 : 0) : stage.ground - 156 };
}

function petalFlower(x: number, y: number, size: number, phase: number, color: string) {
  const lean = Math.sin(phase) * 5;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(lean)})">` +
    `<path d="M0 0 Q-3 25 0 45" fill="none" stroke="#4d9470" stroke-width="3"/><path d="M-1 31 Q-22 31 -21 16 Q-6 15 -1 31 M0 38 Q18 37 21 22 Q5 23 0 38" fill="#72ae77"/><path d="M-18 19 L-3 29 M17 26 L2 36" stroke="#a7cc88" fill="none" stroke-width="1.5"/>` +
    Array.from({ length: 8 }, (_, i) => `<g transform="rotate(${i * 45})">${ellipse(0, -size * .78, size * .42, size * .67, color)}<path d="M0 ${-size * .42} Q${-size * .12} ${-size * .8} 0 ${-size * 1.18}" fill="none" stroke="#fff" opacity=".38" stroke-width="${Math.max(1, size * .08)}" stroke-linecap="round"/></g>`).join("") +
    ellipse(0, 1, size * .45, size * .43, "#d9a258") + ellipse(0, -1, size * .4, size * .38, "#ffe393") +
    Array.from({ length: 5 }, (_, i) => ellipse(Math.cos(i * tau / 5) * size * .22, -1 + Math.sin(i * tau / 5) * size * .2, Math.max(.7, size * .045), Math.max(.7, size * .045), "#ce9647")).join("") + "</g>";
}

/** Original vector storybook details: no downloaded art, filters, or GPU passes. */
function gardenDetails(stage: Stage, phase: number) {
  const { width: w, height: h, ground } = stage;
  let art = `<g data-layer="garden-detail">`;
  // A distant cottage gives the world a recognizable home instead of an empty stage.
  const cottageScale = h > w ? .65 : .78;
  art += `<g transform="translate(${w * .5} ${ground - 103}) scale(${cottageScale})"><path d="M-50 -10 H50 V73 H-50Z" fill="#f5dfb9" stroke="#9fa787" stroke-width="2"/><path d="M-67 -9 L0 -61 L68 -9Z" fill="#cc8c7d"/><path d="M-55 -11 L0 -51 L55 -11" fill="none" stroke="#e3ac94" stroke-width="4"/><path d="M-7 -48 H7 M-24 -33 H22 M-40 -18 H40" stroke="#b97e73" stroke-width="2"/><rect x="-14" y="24" width="29" height="49" rx="14" fill="#a6bda1"/><circle cx="7" cy="52" r="2" fill="#f5d390"/><rect x="-39" y="12" width="18" height="23" rx="5" fill="#bbdfe0" stroke="#fff2d4" stroke-width="3"/><path d="M-30 13 V34 M-39 24 H-21" stroke="#fff2d4" stroke-width="2"/><rect x="25" y="12" width="18" height="23" rx="5" fill="#bbdfe0" stroke="#fff2d4" stroke-width="3"/><path d="M34 13 V34 M25 24 H43" stroke="#fff2d4" stroke-width="2"/><path d="M25 4 Q38 -10 47 9 M-46 52 Q-61 32 -57 16" fill="none" stroke="#79a887" stroke-width="4"/>${ellipse(-51, 39, 7, 4, "#8fbc8d")}${ellipse(44, 5, 7, 4, "#8fbc8d")}</g>`;
  // Broken-up fence sections sit behind the actors, leaving a path to the house.
  for (const side of [0, 1]) {
    const origin = side ? w * .64 : w * .07;
    art += `<g transform="translate(${origin} ${ground - 43})" stroke="#bcae8e" stroke-width="1.4"><path d="M0 3 H${w * .28} V11 H0Z M0 24 H${w * .28} V32 H0Z" fill="#e7ddba"/>`;
    for (let i = 0; i < 6; i++) art += `<path d="M${i * w * .052} 45 V-4 l6 -7 l6 7 V45Z" fill="#f4e8c9"/>`;
    art += `</g>`;
  }
  for (let i = 0; i < 23; i++) {
    const x = 18 + (i * 137) % (w - 36), y = ground + 13 + (i * 31) % Math.max(35, h - ground - 32);
    art += `<path d="M${x} ${y} q-3 -9 -7 -10 m7 10 q0 -13 5 -15 m-5 15 q7 -8 12 -7" fill="none" stroke="${i % 2 ? "#93b686" : "#a5c38f"}" stroke-width="2" stroke-linecap="round"/>`;
  }
  for (let i = 0; i < 8; i++) art += ellipse(w * .47 + Math.sin(i * 2) * w * .07, ground + 25 + i * (h - ground - 30) / 9, 3 + i % 3 * 2, 2 + i % 2, "#c4b89a");
  // One butterfly follows a small looping path, with articulated paired wings.
  const bx = w * .56 + Math.sin(phase) * 23, by = ground - 187 + Math.sin(phase * 2) * 8;
  art += `<g transform="translate(${n(bx)} ${n(by)}) rotate(${n(Math.sin(phase) * 12)})">`;
  for (const side of [-1, 1]) art += `<g transform="scale(${n(side * (.6 + .35 * Math.abs(Math.sin(phase * 4))))} 1)"><path d="M0 0 C-3 -27 24 -26 16 -7 C33 7 10 18 0 3Z" fill="#e2a1a5" stroke="#b67f93" stroke-width="1"/>${ellipse(11, -12, 4, 6, "#f7d7ba")}</g>`;
  art += `<path d="M0 -9 V7 M0 -8 l-4 -6 M0 -8 l4 -6" fill="none" stroke="#716472" stroke-width="2" stroke-linecap="round"/></g>`;
  return art + `</g>`;
}

function foreground(stage: Stage, scene: Scene, phase: number) {
  const { width: w, height: h } = stage;
  if (scene.theme !== "garden" && scene.theme !== "night") return "";
  let art = `<g data-layer="foreground" opacity="${scene.theme === "night" ? .55 : 1}">`;
  for (const side of [0, 1]) {
    const x = side ? w - 24 : 24;
    art += `<g transform="translate(${x} ${h + 2}) scale(${side ? -1 : 1} 1)"><path d="M-31 0 Q-22 -62 5 -81 Q12 -46 2 -6 Q19 -68 63 -71 Q47 -32 11 0Z" fill="#598e78"/><path d="M0 0 Q12 -49 55 -66 M-7 0 Q-1 -43 4 -72" fill="none" stroke="#90b38b" stroke-width="2"/><path d="M35 0 Q48 -32 83 -26 Q64 -7 50 0Z" fill="#7da37e"/></g>`;
    art += petalFlower(x + (side ? -35 : 35), h - 40, 13, phase + side, "#f0bea9");
  }
  return art + `</g>`;
}

function backdrop(stage: Stage, scene: Scene, phase: number, transparent: boolean) {
  const { width: w, height: h, ground } = stage;
  let body = transparent ? "" : `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
  if (scene.theme === "room") {
    body += `<rect width="${w}" height="${h}" fill="#fff0d9"/>`;
    for (let i = 0; i < 10; i++) body += `<path d="M${i * w / 9} 0 V${ground}" stroke="#eedbc0" stroke-width="2"/>`;
    body += `<rect x="${w * 0.12}" y="${h * 0.16}" width="${w * 0.22}" height="${h * 0.24}" rx="20" fill="#aae0eb" stroke="#fff" stroke-width="12"/>`;
    body += line(w * 0.23, h * 0.16, w * 0.23, h * 0.4, "#fff", 8);
    body += `<path d="M${w * .11} ${h * .14} q${w * .09} 30 0 ${h * .29} M${w * .35} ${h * .14} q${-w * .09} 30 0 ${h * .29}" fill="#d4b2b3" stroke="#be959f" stroke-width="2"/><g transform="translate(${w * .66} ${ground - 50})"><rect x="-58" y="-91" width="116" height="95" rx="4" fill="#c6a888"/><path d="M-56 -47 H56" stroke="#9f856f" stroke-width="5"/>`;
    for (let i = 0; i < 7; i++) body += `<rect x="${-47 + i * 13}" y="${-79 + i % 3 * 4}" width="10" height="${29 - i % 3 * 4}" rx="1" fill="${["#91b9b3", "#d3a0a2", "#e4c280"][i % 3]}"/>`;
    body += `<rect x="-44" y="-30" width="36" height="27" rx="7" fill="#a0bdae"/>${ellipse(27, -17, 15, 15, "#ddbc85")}</g>`;
  } else if (scene.theme === "night") {
    body += ellipse(w * 0.79, h * 0.22, 40, 40, "#ffefb1") + ellipse(w * 0.81, h * 0.20, 32, 32, "#344875");
    for (let i = 0; i < 13; i++) {
      const x = (i * 83 + 35) % w, y = h * 0.13 + ((i * 37) % (h * 0.3));
      body += `<path d="M0 -6 L2 -2 L6 0 L2 2 L0 6 L-2 2 L-6 0 L-2 -2Z" fill="#ffefb1" transform="translate(${x} ${y}) scale(${n(0.65 + 0.3 * Math.sin(phase + i))})"/>`;
    }
  } else if (scene.theme === "ocean") {
    for (let i = 0; i < 11; i++) body += ellipse((i * 103 + 30) % w, ground - (i * 71 + phase * 22) % (ground - 70), 5 + i % 3 * 4, 5 + i % 3 * 4, "none", "#c4f6ff", 2);
  } else {
    body += ellipse(w * .81, h * .19, 71, 71, "#ffe7ab", "none") + ellipse(w * .81, h * .19, 58, 58, "#ffe2a0") + ellipse(w * 0.81, h * 0.19, 42, 42, "#ffecc0");
    for (let i = 0; i < 3; i++) {
      const x = w * (0.16 + i * 0.32) + 15 * Math.sin(phase + i), y = h * (0.24 + i % 2 * 0.12);
      body += `<g opacity="0.83">${ellipse(x, y, 48, 15, "white")}${ellipse(x - 20, y - 10, 23, 19, "white")}${ellipse(x + 9, y - 17, 27, 23, "white")}</g>`;
    }
    body += `<path d="M0 ${ground} Q${w * 0.2} ${ground - 130} ${w * 0.5} ${ground - 44} T${w} ${ground - 66} V${h} H0Z" fill="#91caa7"/>`;
  }
  body += `<path d="M0 ${ground - 17} Q${w * 0.48} ${ground - 58} ${w} ${ground - 7} V${h} H0Z" fill="${scene.theme === "ocean" ? "#e8d7a0" : scene.theme === "room" ? "#e8c396" : scene.theme === "night" ? "#516b78" : "#c0ddb0"}"/>`;
  if (scene.theme === "garden") {
    // Painted layers add depth without GPU-heavy blur filters.
    body += `<path d="M${w * .49} ${ground - 30} Q${w * .6} ${ground + 35} ${w * .3} ${h} H${w * .74} Q${w * .58} ${ground + 10} ${w * .54} ${ground - 30}Z" fill="#ebd6ad" opacity=".65"/>`;
    body += gardenDetails(stage, phase);
    for (const side of [0, 1]) {
      const x = side ? w - 25 : 25, y = ground - 100;
      body += `<g transform="translate(${x} ${y})"><path d="M-12 104 Q-5 0 -16 -96 L12 -104 Q3 0 17 104Z" fill="#987762"/><path d="M0 12 Q-43 -25 -53 -48 M2 -12 Q48 -49 54 -80" fill="none" stroke="#987762" stroke-width="10"/>`;
      for (const [dx, dy, rx] of [[-37,-100,54],[28,-133,64],[58,-77,51],[-2,-60,68]]) body += ellipse(dx, dy, rx, rx * .85, "url(#leaves)");
      for (let leaf = 0; leaf < 16; leaf++) {
        const lx = -60 + leaf * 41 % 139, ly = -157 + leaf * 29 % 108;
        body += `<path d="M${lx} ${ly} q-9 -10 1 -19 q13 7 -1 19" fill="${leaf % 2 ? "#c5d79a" : "#79a48a"}" opacity=".6"/>`;
      }
      body += `<path d="M-31 -134 Q-20 -166 8 -168 M-4 37 Q-12 64 -3 93 M6 17 L7 39" fill="none" stroke="#d9d7a5" stroke-width="3" stroke-linecap="round" opacity=".6"/></g>`;
    }
    for (let i = 0; i < 7; i++) body += petalFlower(28 + i * (w - 56) / 6, ground + 20 + i % 2 * 14, 10, phase + i, i % 2 ? "#ef9fb3" : "#c1a5e4");
    for (let i = 0; i < 9; i++) {
      const x = 14 + i * (w - 28) / 8;
      body += `<path d="M${x} ${h} q-18 -45 -28 -40 q17 2 28 24 q-3 -38 10 -48 q-4 29 -2 40 q15 -26 27 -23 q-17 11 -24 47" fill="#789f71" opacity=".45"/>`;
    }
  }
  if (scene.theme === "night") {
    body += `<path d="M0 ${ground - 24} Q${w * .17} ${ground - 158} ${w * .37} ${ground - 39} Q${w * .77} ${ground - 154} ${w} ${ground - 29} V${h} H0Z" fill="#3a5969"/>`;
    for (let i = 0; i < 8; i++) {
      const x = (i * 113 + 20) % w, y = ground - 55 - (i % 3) * 60 + Math.sin(phase + i) * 12;
      body += ellipse(x, y, 15, 15, "#ffdd8530") + ellipse(x, y, 3, 3, "#ffe8a9");
    }
    for (const side of [0, 1]) body += `<g transform="translate(${side ? w - 28 : 24} ${ground})"><path d="M-7 35 L-3 -188 L12 -187 L18 35Z" fill="#425165"/><path d="M0 -120 L-45 -78 H-23 L-59 -31 H-20 L-72 12 H72 L27 -31 H55 L22 -78 H45Z" fill="#4a7180"/><path d="M0 -118 L0 12" fill="none" stroke="#688993" stroke-width="2"/></g>`;
  }
  if (scene.theme === "ocean") {
    for (const side of [0, 1]) {
      const x = side ? w - 30 : 30;
      body += `<g transform="translate(${x} ${ground + 25})"><path d="M0 0 Q-41 -48 -13 -94 Q17 -129 -4 -164 M5 0 Q53 -55 27 -90 M-6 -7 Q-58 -43 -42 -67" fill="none" stroke="#6caba0" stroke-width="12" stroke-linecap="round"/><path d="M39 19 V-38 M39 -17 L18 -32 M39 -5 L59 -23" fill="none" stroke="#d59eae" stroke-width="9" stroke-linecap="round"/>${ellipse(0, 15, 32, 12, "#c5bba1")}</g>`;
    }
    for (let i = 0; i < 9; i++) body += `<path d="M${30 + i * (w - 60) / 8} ${ground + 36 + i % 2 * 15} q8 -8 16 0" fill="none" stroke="#c3b897" stroke-width="2"/>`;
  }
  if (scene.theme === "room") {
    for (let i = 0; i < 5; i++) body += line(0, ground + 20 + i * 25, w, ground + 20 + i * 25, "#d1b38f", 2);
    body += ellipse(w * .5, ground + 26, w * .37, 33, "#c3cbb0") + ellipse(w * .5, ground + 26, w * .34, 26, "none", "#e8e2c7", 2);
  }
  return body;
}

/** Anticipation, flight and landing on the same bounded four-second pose cycle. */
export function kidsHopPose(phase: number) {
  const t = ((phase / Math.PI) % 1 + 1) % 1;
  const flight = t >= .18 && t < .78 ? Math.sin((t - .18) / .6 * Math.PI) : 0;
  const squash = t < .18 ? -.09 * Math.sin(t / .18 * Math.PI)
    : t >= .78 && t < .94 ? -.07 * Math.sin((t - .78) / .16 * Math.PI) : .045 * flight;
  return { lift: flight * 34, scaleY: 1 + squash, scaleX: 1 / (1 + squash) };
}

function puppet(kind: KidsAnimationKind, action: KidsAnimationAction, phase: number, singing: boolean, second = false, emotion: Scene["emotion"] = "happy", speaking = true) {
  const fur = kind === "bear" ? "#b9815c" : kind === "fox" ? "#e99555" : kind === "cat" ? "#efb370" : kind === "dog" ? "#d0a174" : kind === "bird" ? "#f4d46c" : kind === "fish" ? (second ? "#a7a1df" : "#f5b66e") : "#eee6de";
  const pale = kind === "bear" ? "#edceac" : "#fff3df";
  const shirt = second ? "#d792a3" : "#76aeb2";
  const beat = Math.sin(phase * 2);
  const step = Math.sin(phase * 2);
  const jump = kidsHopPose(phase);
  const hop = action === "hop" ? -jump.lift : action === "flap" && kind === "bird" ? -8 - Math.sin(phase * 2) * 10 : -Math.abs(beat) * 3;
  const tilt = action === "listen" ? Math.sin(phase) : action === "sleep" ? Math.sin(phase) * 3 : action === "sway" ? Math.sin(phase) * 7 : Math.sin(phase) * 2;
  const mouthOpen = action === "sleep" ? 1 : singing ? 4 + Math.max(0, Math.sin(phase * 10)) * 8 : speaking ? 2 + Math.max(0, Math.sin(phase * 9)) * 5 : 1.5;
  const eyePhase = (phase + (second ? 1.7 : 0)) % tau;
  const blink = eyePhase > 5.4 && eyePhase < 5.65 || action === "sleep";
  if (kind === "fish") {
    return `<g transform="translate(${n(Math.sin(phase) * 18)} ${n(hop)}) rotate(${n(tilt)})">` +
      `<path d="M-50 0 L${n(-93 + Math.sin(phase * 2) * 9)} -39 L${n(-93 - Math.sin(phase * 2) * 9)} 39Z" fill="${fur}" stroke="${ink}" stroke-width="3"/>` +
      `<path d="M-22 -36 Q-5 -70 26 -37" fill="${shirt}" stroke="${ink}" stroke-width="2"/>` + ellipse(0, 0, 67, 46, fur, ink) + ellipse(8, 17, 47, 23, "#fff1da") +
      Array.from({ length: 9 }, (_, i) => `<path d="M${-47 + i % 3 * 17} ${-20 + Math.floor(i / 3) * 17} q10 7 0 14" stroke="#bd947b" stroke-width="1.3" fill="none" opacity=".65"/>`).join("") +
      `<g transform="rotate(${n(Math.sin(phase * 2) * 12)} -8 8)"><path d="M-8 8 Q-43 9 -9 34 Q4 20 -8 8" fill="${shirt}" stroke="${ink}" stroke-width="2"/><path d="M-12 13 L-13 25" stroke="#f2d7c4" stroke-width="2"/></g>` +
      ellipse(30, -13, 12, 15, "#fff") + ellipse(33, -12, 6, blink ? 1 : 9, ink) + ellipse(35, -16, 2.5, 3, "#fff") + ellipse(49, 9, 8, 4, "#e49c9a") + ellipse(54, 16, 6, mouthOpen / 2, "#9a5761") + "</g>";
  }
  const footLift = action === "march" ? step * 15 : action === "sway" ? step * 4 : 0;
  let hands: [[number, number], [number, number]] = [[-73, 103], [73, 103]];
  if (action === "clap") hands = [[-25 + beat * 21, 76], [25 - beat * 21, 76]];
  if (action === "wave") hands = [[-72, 100], [76 + Math.sin(phase * 4) * 15, 5]];
  if (action === "reach") hands = [[-12, 94 + beat * 7], [16, 88 + beat * 7]];
  if (action === "sway") hands = [[-79, 74 + beat * 22], [79, 74 - beat * 22]];
  if (action === "flap") hands = [[-89, 48 + beat * 39], [89, 48 + beat * 39]];
  if (action === "drum") hands = [[-23, 77 + beat * 16], [25, 77 - beat * 16]];
  if (action === "sleep") hands = [[12, 39], [31, 34]];
  if (action === "march") hands = [[-65, 91 + step * 17], [65, 91 - step * 17]];
  if (action === "hop") hands = [[-75, 100 - jump.lift], [75, 100 - jump.lift]];
  const arm = (side: -1 | 1) => {
    const [hx, hy] = hands[side < 0 ? 0 : 1];
    return `<path d="M${side * 39} 63 Q${side * 61} ${n((63 + hy) / 2)} ${n(hx)} ${n(hy)}" fill="none" stroke="${ink}" stroke-width="20" stroke-linecap="round"/>` +
      `<path d="M${side * 39} 63 Q${side * 61} ${n((63 + hy) / 2)} ${n(hx)} ${n(hy)}" fill="none" stroke="${kind === "bird" ? shirt : fur}" stroke-width="15" stroke-linecap="round"/>` +
      `<path d="M${side * 37} 61 L${side * 48} ${n(63 + (hy - 63) * .2)}" fill="none" stroke="${shirt}" stroke-width="19" stroke-linecap="round"/>` +
      (kind === "bird" ? `<path d="M${n(hx - 10)} ${n(hy - 9)} Q${n(hx - 24)} ${n(hy + 3)} ${n(hx - 10)} ${n(hy + 9)} Q${n(hx - 4)} ${n(hy + 15)} ${n(hx + 1)} ${n(hy + 9)} Q${n(hx + 14)} ${n(hy + 14)} ${n(hx + 16)} ${n(hy)} Q${n(hx + 12)} ${n(hy - 12)} ${n(hx - 10)} ${n(hy - 9)}Z" fill="${fur}" stroke="${ink}" stroke-width="2"/>`
      : ellipse(hx, hy, 13, 11, pale, ink, 2) + ellipse(hx - side * 9, hy - 6, 6, 5, pale, ink, 1.5) + `<path d="M${n(hx + side * 4)} ${n(hy + 5)} v-3 M${n(hx + side * 8)} ${n(hy + 3)} v-3" stroke="#bcaa99" stroke-width="1.2" stroke-linecap="round"/>`);
  };
  const furId = `fur-${kind}-${second ? 1 : 0}`;
  let body = `<defs><radialGradient id="${furId}" cx=".32" cy=".22" r=".9"><stop stop-color="${pale}"/><stop offset=".35" stop-color="${fur}"/><stop offset="1" stop-color="${kind === "bunny" ? "#d4c8c8" : kind === "bird" ? "#daa557" : "#ac7e62"}"/></radialGradient><linearGradient id="shirt-${furId}" x2=".8" y2="1"><stop stop-color="${shirt}"/><stop offset="1" stop-color="${second ? "#b57491" : "#4e858f"}"/></linearGradient></defs><g data-character="${kind}" transform="translate(0 ${n(hop)}) rotate(${n(tilt)} 0 90)">`;
  if (kind === "bunny") body += ellipse(45, 110, 19, 18, pale, ink, 2) + ellipse(48, 105, 11, 10, "#fff8ec");
  if (kind === "cat" || kind === "fox" || kind === "dog") body += `<path d="M36 111 Q100 ${n(100 + beat * 12)} 77 ${n(61 + beat * 12)}" fill="none" stroke="${ink}" stroke-width="23" stroke-linecap="round"/><path d="M36 111 Q100 ${n(100 + beat * 12)} 77 ${n(61 + beat * 12)}" fill="none" stroke="${fur}" stroke-width="17" stroke-linecap="round"/>`;
  for (const side of [-1, 1]) {
    const fy = 163 + side * footLift;
    const kneeX = side * 26 + (action === "march" ? Math.max(0, -side * step) * 14 : 0);
    const leg = `M${side * 23} 114 Q${n(kneeX)} ${n(140 + side * footLift / 2)} ${side * 31} ${n(fy)}`;
    body += `<path d="${leg}" fill="none" stroke="${ink}" stroke-width="25" stroke-linecap="round"/><path d="${leg}" fill="none" stroke="${fur}" stroke-width="19" stroke-linecap="round"/>` +
      `<path d="M${side * 23} 116 L${n(side * 28)} ${n(140 + side * footLift * .45)}" fill="none" stroke="${second ? "#bd8298" : "#5f929b"}" stroke-width="24"/><path d="M${side * 28 - 10} ${n(141 + side * footLift * .45)} h20" stroke="${second ? "#e0b1be" : "#a2c8c2"}" stroke-width="4"/>` + ellipse(side * 36, fy + 4, 24, 12, pale, ink, 2);
    body += `<path d="M${side * 36 - 18} ${n(fy + 9)} q18 6 36 0 M${side * 36 - 9} ${n(fy + 1)} v-4 M${side * 36 - 3} ${n(fy + 1)} v-4" stroke="#c6b4a3" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  }
  body += `<path d="M-31 42 Q-47 52 -47 91 Q-51 128 -22 135 H22 Q51 128 47 91 Q47 52 31 42 Q0 36 -31 42Z" fill="url(#shirt-${furId})" stroke="${ink}" stroke-width="3"/><path d="M-29 47 Q0 70 29 47" fill="none" stroke="#ffedcf" stroke-width="6"/>`;
  // Tailored overalls: straps, button highlights, a stitched pocket and seams.
  body += `<path d="M-29 49 L-21 88 M29 49 L21 88" stroke="${second ? "#edbdc3" : "#b0d3cc"}" stroke-width="8"/><path d="M-23 86 H23 V110 Q0 126 -23 110Z" fill="${second ? "#cd8b9f" : "#72a5aa"}" stroke="${second ? "#e3b0ba" : "#a0c6c0"}" stroke-width="2"/><path d="M-17 92 H17 V108 Q0 118 -17 108Z M0 124 V133" fill="none" stroke="#f5e8cb" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`;
  for (const side of [-1, 1]) body += ellipse(side * 23, 80, 5, 5, "#f1d99d", ink, 1) + ellipse(side * 23 - 1, 78, 1.7, 1.4, "#fff4d1");
  body += `<path d="M0 95 l3 5 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1Z" fill="#f8dd9b"/>`;
  body += `<path d="M-35 79 Q-42 103 -25 121" stroke="white" stroke-width="6" fill="none" opacity=".22" stroke-linecap="round"/><path d="M20 124 Q36 119 40 108" stroke="${ink}" stroke-width="5" fill="none" opacity=".12"/>`;
  body += arm(-1) + arm(1);
  const earWiggle = Math.sin(phase * 2) * 5;
  if (kind === "bunny") body += `<g transform="rotate(${n(-7 + earWiggle)} -26 -26)">${ellipse(-26, -65, 16, 47, fur, ink)}${ellipse(-26, -67, 7, 30, "#dfb4be")}</g><g transform="rotate(${n(7 - earWiggle)} 26 -26)">${ellipse(26, -65, 16, 47, fur, ink)}${ellipse(26, -67, 7, 30, "#dfb4be")}</g>`;
  else if (kind === "cat" || kind === "fox") body += `<path d="M-49 -5 L-42 -61 L-12 -32 M49 -5 L42 -61 L12 -32" fill="${fur}" stroke="${ink}" stroke-width="3"/><path d="M-40 -20 L-37 -46 L-21 -29 M40 -20 L37 -46 L21 -29" fill="#e7abb0"/>`;
  else if (kind === "bear") body += ellipse(-38, -32, 23, 24, fur, ink) + ellipse(38, -32, 23, 24, fur, ink) + ellipse(-38, -32, 13, 14, pale) + ellipse(38, -32, 13, 14, pale);
  else if (kind === "bird") body += `<path d="M-15 -38 Q-30 -77 3 -44 Q10 -78 22 -42" fill="${fur}" stroke="${ink}" stroke-width="3"/>`;
  body += `<path d="M-52 -9 C-52 -62 47 -65 54 -9 Q62 25 33 40 Q0 57 -33 40 Q-62 25 -52 -9Z" fill="url(#${furId})" stroke="${ink}" stroke-width="3"/>`;
  if (kind !== "bird") body += `<path d="M-48 13 l-8 5 9 2 -5 7 10 -1 M48 13 l8 5 -9 2 5 7 -10 -1" fill="${fur}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  body += `<path d="M-37 -19 Q-25 -36 -5 -35" fill="none" stroke="${pale}" stroke-width="5" stroke-linecap="round" opacity=".55"/>`;
  if (kind === "dog") body += `<g transform="rotate(${n(earWiggle)} -47 -17)">${ellipse(-48, 0, 18, 37, "#9a7154", ink)}</g><g transform="rotate(${n(-earWiggle)} 47 -17)">${ellipse(48, 0, 18, 37, "#9a7154", ink)}</g>`;
  body += ellipse(0, 22, 32, 23, pale) + ellipse(-34, 17, 10, 5, "#e5a6a3") + ellipse(34, 17, 10, 5, "#e5a6a3");
  if (kind === "cat" || kind === "fox") body += `<path d="M-33 19 l-20 -3 M-33 24 l-18 5 M33 19 l20 -3 M33 24 l18 5 M-12 -41 l5 10 M0 -45 v13 M12 -41 l-5 10" fill="none" stroke="#a27468" stroke-width="1.7" stroke-linecap="round"/>`;
  if (kind === "bear" || kind === "dog") body += ellipse(-12, 20, 1.7, 1.7, "#ac8d77") + ellipse(-17, 24, 1.5, 1.5, "#ac8d77") + ellipse(12, 20, 1.7, 1.7, "#ac8d77") + ellipse(17, 24, 1.5, 1.5, "#ac8d77");
  if (blink) body += `<path d="M-27 -5 Q-20 2 -13 -5 M13 -5 Q20 2 27 -5" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else for (const side of [-1, 1]) {
    const gaze = (second ? -1.5 : 1.5) + Math.sin(phase) * .7;
    body += ellipse(side * 21, -5, 12, 16, "#fffaf1") + ellipse(side * 21 + gaze, -3, 7, 10, kind === "bunny" ? "#8a6e65" : "#557c7b") + ellipse(side * 21 + gaze, -3, 4.5, 8, "#394653") + ellipse(side * 21 + gaze + 2, -7, 2.8, 3.2, "#fff") + ellipse(side * 21 + gaze - 2, 2, 1.3, 1.6, "#d9e9dd");
    body += `<path d="M${side * 21 - 10} -15 q10 -8 20 0" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (emotion === "worried") body += `<path d="M-29 -22 Q-21 -30 -13 -24 M13 -24 Q21 -30 29 -22" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else if (emotion === "curious") body += `<path d="M-29 -23 Q-21 -30 -13 -25 M13 -28 Q21 -34 29 -29" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else body += `<path d="M-29 -26 q8 -4 15 -1 M14 -27 q8 -3 15 1" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
  body += kind === "bird" ? `<path d="M-9 13 L9 13 L0 ${n(22 + mouthOpen)}Z" fill="#e59d48" stroke="${ink}" stroke-width="2"/>`
    : `<path d="M-7 14 Q0 10 7 14 Q7 21 0 22 Q-7 21 -7 14Z" fill="${ink}"/>${ellipse(-2, 14, 2.5, 1.3, "#adaba8")}` + (speaking || singing ? ellipse(0, 32, 10, mouthOpen, "#7b4d5b") + ellipse(0, 34 + mouthOpen / 2, 6, mouthOpen / 3, "#e994a1") : `<path d="M-9 29 Q0 ${emotion === "worried" ? 23 : 38} 9 29" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`);
  if (action === "hop") body = body.replace(`rotate(${n(tilt)} 0 90)`, `rotate(${n(tilt)} 0 90) translate(0 179) scale(${n(jump.scaleX)} ${n(jump.scaleY)}) translate(0 -179)`);
  return body + "</g>";
}

function sceneProp(stage: Stage, scene: Scene, phase: number) {
  const prop = scene.prop;
  const { width: w, ground, height: h } = stage;
  const x = w / 2, y = h > w ? ground - 260 : ground - 130;
  if (prop === "rain") return Array.from({ length: 16 }, (_, i) => {
    const dx = 30 + (i * 61) % (w - 60), dy = h * 0.24 + ((i * 29 + phase / tau * 110) % 130);
    return line(dx, dy, dx - 5, dy + 14, "#72bdda", 3);
  }).join("") + ellipse(x, ground + 14, w * 0.16, 10, "#86cadd") + ellipse(x, ground + 12, 30 + phase * 4, 5, "none", "#d4f4f7", 2);
  if (prop === "flower") return petalFlower(x, ground - 48, 25, phase, "#e7a4ba");
  if (prop === "umbrella") return `<g transform="translate(${x} ${y - 25}) rotate(${n(Math.sin(phase) * 9)})"><path d="M-69 0 Q0 -100 69 0 Q45 -14 23 0 Q0 -14 -23 0 Q-45 -14 -69 0Z" fill="#b8a1df" stroke="${ink}" stroke-width="3"/><path d="M0 0 V88 Q0 109 19 98" fill="none" stroke="${ink}" stroke-width="5"/></g>`;
  if (prop === "ball") return `<g transform="translate(${x + Math.sin(phase) * 38} ${ground - 20 - Math.abs(Math.sin(phase)) * 52}) rotate(${n(phase * 50)})">${ellipse(0, 0, 28, 28, "#eab674", ink)}<path d="M-28 0 H28 M0 -28 V28" stroke="#fff0d4" stroke-width="5"/></g>`;
  if (prop === "kite") {
    const position = kitePosition(stage, scene, phase);
    const branch = scene.kiteCaughtHigh ? `<path d="M${w * .85} ${ground} Q${w * .89} ${position.y} ${position.x + 115} ${position.y - 54} M${position.x + 120} ${position.y - 40} L${position.x - 15} ${position.y - 27}" fill="none" stroke="#997b61" stroke-width="12" stroke-linecap="round"/>` : "";
    const knot = scene.kiteState === "tangled" ? `<path data-kite-knot="true" d="M-27 30 C-65 -22 34 -29 13 28 S-46 69 -35 11 S48 -6 26 39 S-17 70 -27 30" fill="none" stroke="#867a71" stroke-width="3"/>` : "";
    return branch + `<g data-kite-state="${scene.kiteState}" transform="translate(${n(position.x)} ${n(position.y)}) rotate(${n(scene.kiteState === "flying" ? Math.sin(phase) * 12 : scene.kiteState === "tangled" ? -18 : 0)})"><path d="M0 -51 L40 0 L0 59 L-40 0Z" fill="#e997a3" stroke="${ink}" stroke-width="3"/><path d="M0 -51 V0 H-40Z" fill="#f2cf7d"/><path d="M0 0 L40 0 L0 59Z" fill="#91bdb4"/><path d="M0 -49 V57 M-38 0 H38" fill="none" stroke="#fff1ca" stroke-width="2"/><path d="M0 59 Q-29 84 0 107 T0 150" fill="none" stroke="${ink}" stroke-width="2"/><path d="M-12 79 l-12 -8 v15 l12 -7 12 7 v-15Z M4 114 l-12 -7 v14 l12 -7 12 7 v-14Z" fill="#e2a6b0" stroke="#b68b91" stroke-width="1"/><path d="M3 -37 L27 -8" stroke="#fff9dc" stroke-width="3" stroke-linecap="round" opacity=".7"/>${knot}</g>`;
  }
  if (prop === "star") return `<g transform="translate(${x} ${y - 5}) rotate(${n(Math.sin(phase) * 9)}) scale(${n(1 + 0.05 * Math.sin(phase * 2))})"><path d="M0 -45 L14 -14 L47 -12 L23 11 L30 43 L0 27 L-30 43 L-23 11 L-47 -12 L-14 -14Z" fill="#f9dd83" stroke="${ink}" stroke-width="3"/>${ellipse(-10, -2, 3, 5, ink)}${ellipse(10, -2, 3, 5, ink)}<path d="M-9 11 Q0 19 9 11" fill="none" stroke="${ink}" stroke-width="2"/></g>`;
  if (prop === "drum") return `<g transform="translate(${x} ${ground - 36})"><path d="M-42 -34 H42 V18 Q0 37 -42 18Z" fill="#cf889f" stroke="${ink}" stroke-width="3"/>${ellipse(0, -34, 42, 15, "#ffebc9", ink)}<path d="M-36 -20 L-15 23 L7 -20 L28 23 L38 -20" fill="none" stroke="#ffdfa6" stroke-width="3"/>${line(-35, -80 + Math.sin(phase * 2) * 18, -8, -35, ink, 4)}${line(35, -80 - Math.sin(phase * 2) * 18, 8, -35, ink, 4)}</g>`;
  if (prop === "bridge") return `<path d="M0 ${ground + 4} Q${w / 2} ${ground - 34} ${w} ${ground + 4}" fill="none" stroke="#8bc6ce" stroke-width="45"/>` + Array.from({ length: 7 }, (_, i) => `<rect x="${x - 112 + i * 32}" y="${ground - 10}" width="28" height="21" rx="3" fill="#bb906b" stroke="${ink}" stroke-width="2"/>`).join("");
  if (prop === "letter") return `<g transform="translate(${x} ${y}) rotate(${n(Math.sin(phase) * 6)})"><rect x="-42" y="-28" width="84" height="56" rx="5" fill="#fff5d9" stroke="${ink}" stroke-width="3"/><path d="M-42 -28 L0 7 L42 -28" fill="none" stroke="${ink}" stroke-width="3"/>${ellipse(0, 8, 8, 8, "#de91aa")}</g>`;
  if (prop === "gift" || prop === "toys") return `<g transform="translate(${x} ${ground - 33})"><rect x="-40" y="-27" width="80" height="62" rx="5" fill="#e2b887" stroke="${ink}" stroke-width="3"/><rect x="-23" y="-54" width="35" height="35" rx="5" fill="#84b8c4" transform="rotate(${n(Math.sin(phase) * 6)})" stroke="${ink}" stroke-width="2"/>${ellipse(19, -30, 18, 18, "#d398b6", ink, 2)}</g>`;
  return "";
}

export function kidsAnimationSvg(options: { topic: string; caption: string; index: number; frame: number; aspect: "9:16" | "16:9"; cast: [KidsAnimationKind, KidsAnimationKind]; castNames?: [string, string]; scene?: Scene; song?: boolean; transparent?: boolean }) {
  const vertical = options.aspect === "9:16";
  const stage: Stage = vertical ? { width: 540, height: 960, ground: 734, y: 532, size: 1.12 } : { width: 960, height: 540, ground: 442, y: 272, size: 1.04 };
  const { width: w, height: h, ground } = stage;
  const scene = options.scene || planKidsAnimationScene(options.topic.toLowerCase(), options.caption, options.index);
  const performance = planKidsPerformance(options.caption, options.cast, options.castNames, options.song);
  const phase = options.frame % CYCLE_FRAMES / CYCLE_FRAMES * tau;
  const colors = scene.theme === "night" ? ["#344875", "#7b90ac"] : scene.theme === "ocean" ? ["#73bdce", "#b5e8e0"] : ["#a2d7e5", "#e8f5e8"];
  let body = backdrop(stage, scene, phase, !!options.transparent);
  if (scene.prop === "kite" && scene.action === "reach") {
    const handX = w * (vertical ? .26 : .29) + 16 * stage.size;
    const handY = ground - 88 * stage.size;
    const { x: kiteX, y: kiteY } = kitePosition(stage, scene, phase);
    body += `<path d="M${n(kiteX)} ${n(kiteY)} Q${n((kiteX + handX) / 2)} ${n(handY - 27)} ${n(handX)} ${n(handY)}" fill="none" stroke="#867a71" stroke-width="1.4"/>`;
  }
  // Drums are held in front of each player's hands, not floating in the gap.
  if (scene.prop !== "drum") body += sceneProp(stage, scene, phase);
  if (scene.prop === "bus") {
    const busX = w / 2 + Math.sin(phase) * 12, busY = ground - 97;
    body += `<g transform="translate(${busX} ${busY})"><rect x="-190" y="-85" width="380" height="157" rx="30" fill="#f3ce80" stroke="${ink}" stroke-width="4"/><path d="M-182 33 H180" stroke="#d78f66" stroke-width="8"/><rect x="-166" y="-65" width="96" height="67" rx="12" fill="#b7e2e7"/><rect x="-44" y="-65" width="96" height="67" rx="12" fill="#b7e2e7"/><rect x="77" y="-65" width="81" height="127" rx="10" fill="#a8d5de" stroke="${ink}" stroke-width="3"/>`;
    body += `<defs><clipPath id="passengers"><rect x="-166" y="-65" width="96" height="67" rx="12"/><rect x="-44" y="-65" width="96" height="67" rx="12"/></clipPath></defs><g clip-path="url(#passengers)">`;
    for (const [i, kind] of options.cast.entries()) body += `<g transform="translate(${-120 + i * 122} -28) scale(0.48)">${puppet(kind, "wave", phase + i, !!options.song, i === 1)}</g>`;
    body += "</g>";
    for (const wx of [-120, 123]) body += `<g transform="translate(${wx} 76) rotate(${n(phase * 360 / tau)})">${ellipse(0, 0, 35, 35, ink)}${ellipse(0, 0, 22, 22, "#dce2e7")}${line(-18, 0, 18, 0, "#8396a6", 5)}${line(0, -18, 0, 18, "#8396a6", 5)}</g>`;
    body += "</g>";
  } else {
    for (const [i, kind] of options.cast.entries()) {
      const action = performance.active[i] ? scene.action : "listen";
      const charPhase = phase + (i ? Math.PI * 0.15 : 0);
      const travel = action === "march" ? Math.sin(phase) * (vertical ? 13 : 27) : 0;
      const x = w * (i ? (vertical ? 0.74 : 0.71) : (vertical ? 0.26 : 0.29)) + travel;
      const size = stage.size * (scene.close ? 1.1 : 1);
      const y = ground - 176 * size;
      body += ellipse(x, ground + 4, 62 - (action === "hop" ? kidsHopPose(charPhase).lift * .3 : 0), 9, "#43697b22");
      body += `<g data-actor="${i}" data-action="${action}" data-speaking="${performance.speaker === i || !!options.song}" transform="translate(${n(x)} ${n(y)}) scale(${size})">${puppet(kind, action, charPhase, !!options.song, i === 1, scene.emotion, performance.speaker === i)}</g>`;
      if (scene.prop === "drum") {
        body += `<g transform="translate(${n(x)} ${n(y + 108 * size)}) scale(${size})"><path d="M-38 0 H38 V34 Q0 48 -38 34Z" fill="#d692a9" stroke="${ink}" stroke-width="3"/>${ellipse(0, 0, 38, 12, "#ffedce", ink)}<path d="M-31 12 L-13 36 L4 12 L24 36 L32 12" fill="none" stroke="#ffedce" stroke-width="3"/>${line(-23, -31 + Math.sin(charPhase * 2) * 16, -11, -8, ink, 3)}${line(25, -31 - Math.sin(charPhase * 2) * 16, 11, -8, ink, 3)}</g>`;
      }
    }
  }
  body += foreground(stage, scene, phase);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient><linearGradient id="leaves" x2=".7" y2="1"><stop stop-color="#bed795"/><stop offset=".5" stop-color="#84b48c"/><stop offset="1" stop-color="#558c7a"/></linearGradient></defs>${body}</svg>`;
}

export async function prepareKidsAnimation(options: { directory: string; topic: string; cues: KidsAnimationCue[]; duration: number; aspect: "9:16" | "16:9"; cast: [KidsAnimationKind, KidsAnimationKind]; castNames?: [string, string]; song: boolean; transparent?: boolean; onProgress?: (percent: number) => Promise<unknown> }) {
  sharp.concurrency(1);
  sharp.cache({ memory: 24, files: 0, items: 32 });
  const folder = path.join(options.directory, "animation");
  await fs.mkdir(folder, { recursive: true });
  const rendered = new Set<string>();
  const timeline: string[] = [];
  const frames = Math.ceil(options.duration * KIDS_ANIMATION_FPS);
  let cueIndex = 0;
  let lastFile = "";
  const scenes: Scene[] = [];
  for (const [index, cue] of options.cues.entries()) scenes.push(planKidsAnimationScene(options.topic, cue.text, index, scenes[index - 1]));
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / KIDS_ANIMATION_FPS;
    while (cueIndex < options.cues.length - 1 && time >= options.cues[cueIndex].end) cueIndex++;
    const cue = options.cues[cueIndex];
    const scene = scenes[cueIndex];
    const pose = frame % CYCLE_FRAMES;
    const performance = planKidsPerformance(cue.text, options.cast, options.castNames, options.song);
    const key = createHash("sha1").update(JSON.stringify([6, scene, pose, performance, options.cast, options.aspect, options.transparent, options.song])).digest("hex").slice(0, 16);
    const filename = `animation/${key}.png`;
    if (!rendered.has(key)) {
      const svg = kidsAnimationSvg({ topic: options.topic, caption: cue.text, index: cueIndex, frame: pose, aspect: options.aspect, cast: options.cast, castNames: options.castNames, scene, song: options.song, transparent: options.transparent });
      await sharp(Buffer.from(svg)).png({ compressionLevel: 1 }).toFile(path.join(options.directory, filename));
      rendered.add(key);
    }
    const frameDuration = Math.min(1 / KIDS_ANIMATION_FPS, options.duration - time);
    timeline.push(`file '${filename}'\nduration ${frameDuration.toFixed(9)}`);
    lastFile = filename;
    if (frame % KIDS_ANIMATION_FPS === 0) await options.onProgress?.(Math.round(frame / frames * 100));
  }
  timeline.push(`file '${lastFile}'`);
  await fs.writeFile(path.join(options.directory, "scenes.txt"), timeline.join("\n") + "\n", "utf8");
  await fs.writeFile(path.join(options.directory, "animation-plan.json"), JSON.stringify({ version: 6, fps: KIDS_ANIMATION_FPS, uniqueFrames: rendered.size, frames, scenes: options.cues.map((cue, index) => ({ ...cue, ...scenes[index], performance: planKidsPerformance(cue.text, options.cast, options.castNames, options.song) })) }, null, 2));
  return { uniqueFrames: rendered.size, frames };
}

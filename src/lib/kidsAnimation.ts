import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

export type KidsAnimationCue = { text: string; start: number; end: number };
export type KidsAnimationKind = "dog" | "cat" | "bunny" | "bird" | "bear" | "fox" | "fish";
export type KidsAnimationAction = "clap" | "hop" | "wave" | "march" | "sway" | "flap" | "drum" | "reach" | "sleep";
type Prop = "rain" | "umbrella" | "flower" | "drum" | "kite" | "ball" | "star" | "gift" | "toys" | "bridge" | "letter" | "bus" | "none";
type Scene = { action: KidsAnimationAction; prop: Prop; theme: "garden" | "night" | "ocean" | "room"; close: boolean };
type Stage = { width: number; height: number; ground: number; y: number; size: number };

// Draw animation on twos, as in limited 2D cartoons. Reusing a two-second pose
// cycle keeps a three-minute video small and avoids thousands of render jobs.
export const KIDS_ANIMATION_FPS = 12;
const CYCLE_FRAMES = KIDS_ANIMATION_FPS * 2;
const ink = "#30445c";
const tau = Math.PI * 2;
const n = (value: number) => Number(value.toFixed(2));
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = "none", sw = 3) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (x1: number, y1: number, x2: number, y2: number, fill: string, width: number) =>
  `<path d="M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

export function planKidsAnimationScene(topic: string, text: string, index = 0): Scene {
  topic = topic.toLowerCase();
  const words = text.toLowerCase();
  const theme = /ocean|underwater|fish|shark/.test(topic) ? "ocean" : /bedtime|sleep|moon|night|star/.test(topic) ? "night" : /clean|tidy|playroom|toy/.test(topic) ? "room" : "garden";
  const action: KidsAnimationAction = /clap|pat your/.test(words) ? "clap"
    : /drum|bucket|tap.*beat/.test(words) ? "drum"
    : /flap|wing|fly|flying/.test(words) ? "flap"
    : /hop|jump|bounce|splash/.test(words) ? "hop"
    : /sleep|breathe|hush|rest|close.*eyes/.test(words) ? "sleep"
    : /wave|hello|goodbye|goodnight/.test(words) ? "wave"
    : /march|step|walk|cross|follow|hurri|tiptoe/.test(words) ? "march"
    : /reach|pick|lift|carry|hold|share|help|give|pass/.test(words) ? "reach" : "sway";
  const prop: Prop = /\b(bus|wheel|vehicle|car)\b/.test(words) ? "bus"
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
  return { action, prop, theme, close: index % 4 === 2 && prop === "none" };
}

function petalFlower(x: number, y: number, size: number, phase: number, color: string) {
  const lean = Math.sin(phase) * 7;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(lean)})">` +
    `<path d="M0 0 Q-3 25 0 45" fill="none" stroke="#418b60" stroke-width="4"/>` +
    ellipse(-7, 24, 10, 4, "#72b86c") +
    Array.from({ length: 6 }, (_, i) => `<g transform="rotate(${i * 60})">${ellipse(0, -size * 0.73, size * 0.45, size * 0.66, color)}</g>`).join("") +
    ellipse(0, 0, size * 0.4, size * 0.4, "#ffe483") + "</g>";
}

function backdrop(stage: Stage, scene: Scene, phase: number, transparent: boolean) {
  const { width: w, height: h, ground } = stage;
  let body = transparent ? "" : `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
  if (scene.theme === "room") {
    body += `<rect width="${w}" height="${h}" fill="#fff0d9"/><rect x="${w * 0.12}" y="${h * 0.16}" width="${w * 0.22}" height="${h * 0.24}" rx="20" fill="#aae0eb" stroke="#fff" stroke-width="12"/>`;
    body += line(w * 0.23, h * 0.16, w * 0.23, h * 0.4, "#fff", 8);
  } else if (scene.theme === "night") {
    body += ellipse(w * 0.79, h * 0.22, 40, 40, "#ffefb1") + ellipse(w * 0.81, h * 0.20, 32, 32, "#344875");
    for (let i = 0; i < 13; i++) {
      const x = (i * 83 + 35) % w, y = h * 0.13 + ((i * 37) % (h * 0.3));
      body += `<path d="M0 -6 L2 -2 L6 0 L2 2 L0 6 L-2 2 L-6 0 L-2 -2Z" fill="#ffefb1" transform="translate(${x} ${y}) scale(${n(0.65 + 0.3 * Math.sin(phase + i))})"/>`;
    }
  } else if (scene.theme === "ocean") {
    for (let i = 0; i < 11; i++) body += ellipse((i * 103 + 30) % w, ground - (i * 71 + phase * 22) % (ground - 70), 5 + i % 3 * 4, 5 + i % 3 * 4, "none", "#c4f6ff", 2);
  } else {
    body += ellipse(w * 0.81, h * 0.19, 42, 42, "#ffe48d");
    for (let i = 0; i < 3; i++) {
      const x = w * (0.16 + i * 0.32) + 15 * Math.sin(phase + i), y = h * (0.24 + i % 2 * 0.12);
      body += `<g opacity="0.83">${ellipse(x, y, 48, 15, "white")}${ellipse(x - 20, y - 10, 23, 19, "white")}${ellipse(x + 9, y - 17, 27, 23, "white")}</g>`;
    }
    body += `<path d="M0 ${ground} Q${w * 0.2} ${ground - 130} ${w * 0.5} ${ground - 44} T${w} ${ground - 66} V${h} H0Z" fill="#91caa7"/>`;
  }
  body += `<path d="M0 ${ground - 17} Q${w * 0.48} ${ground - 58} ${w} ${ground - 7} V${h} H0Z" fill="${scene.theme === "ocean" ? "#e8d7a0" : scene.theme === "room" ? "#e8c396" : scene.theme === "night" ? "#516b78" : "#c0ddb0"}"/>`;
  if (scene.theme === "garden") {
    for (let i = 0; i < 7; i++) body += petalFlower(28 + i * (w - 56) / 6, ground + 20 + i % 2 * 14, 10, phase + i, i % 2 ? "#ef9fb3" : "#c1a5e4");
  }
  return body;
}

function puppet(kind: KidsAnimationKind, action: KidsAnimationAction, phase: number, singing: boolean, second = false) {
  const fur = kind === "bear" ? "#b9815c" : kind === "fox" ? "#e99555" : kind === "cat" ? "#efb370" : kind === "dog" ? "#d0a174" : kind === "bird" ? "#f4d46c" : kind === "fish" ? (second ? "#a7a1df" : "#f5b66e") : "#eee6de";
  const pale = kind === "bear" ? "#edceac" : "#fff3df";
  const shirt = second ? "#d78099" : "#6aafbb";
  const beat = Math.sin(phase * 2);
  const step = Math.sin(phase * 2);
  const hop = action === "hop" ? -Math.max(0, Math.sin(phase * 2)) * 26 : action === "flap" ? -8 - Math.sin(phase * 2) * 10 : -Math.abs(beat) * 3;
  const tilt = action === "sleep" ? Math.sin(phase) * 3 : action === "sway" ? Math.sin(phase) * 7 : Math.sin(phase) * 2;
  const mouthOpen = action === "sleep" ? 1 : singing ? 4 + Math.max(0, Math.sin(phase * 5)) * 8 : 3 + Math.max(0, Math.sin(phase * 3)) * 5;
  const blink = phase > 5.4 && phase < 5.7 || action === "sleep";
  if (kind === "fish") {
    return `<g transform="translate(${n(Math.sin(phase) * 18)} ${n(hop)}) rotate(${n(tilt)})">` +
      `<path d="M-50 0 L${n(-93 + Math.sin(phase * 2) * 9)} -39 L${n(-93 - Math.sin(phase * 2) * 9)} 39Z" fill="${fur}" stroke="${ink}" stroke-width="3"/>` +
      ellipse(0, 0, 67, 46, fur, ink) + `<path d="M-8 8 Q-36 30 -9 34" fill="${shirt}" stroke="${ink}" stroke-width="2"/>` +
      ellipse(30, -13, 11, 14, "#fff") + ellipse(33, -12, 5, blink ? 1 : 7, ink) + ellipse(54, 13, 6, mouthOpen / 2, "#9a5761") + "</g>";
  }
  const footLift = action === "march" || action === "hop" ? step * 15 : action === "sway" ? step * 4 : 0;
  let hands: [[number, number], [number, number]] = [[-73, 103], [73, 103]];
  if (action === "clap") hands = [[-25 + beat * 21, 76], [25 - beat * 21, 76]];
  if (action === "wave") hands = [[-72, 100], [76 + Math.sin(phase * 4) * 15, 5]];
  if (action === "reach") hands = [[-12, 94 + beat * 7], [16, 88 + beat * 7]];
  if (action === "sway") hands = [[-79, 74 + beat * 22], [79, 74 - beat * 22]];
  if (action === "flap") hands = [[-89, 48 + beat * 39], [89, 48 + beat * 39]];
  if (action === "drum") hands = [[-23, 77 + beat * 16], [25, 77 - beat * 16]];
  if (action === "sleep") hands = [[12, 39], [31, 34]];
  if (action === "march") hands = [[-65, 91 + step * 17], [65, 91 - step * 17]];
  const arm = (side: -1 | 1) => {
    const [hx, hy] = hands[side < 0 ? 0 : 1];
    return `<path d="M${side * 39} 63 Q${side * 61} ${n((63 + hy) / 2)} ${n(hx)} ${n(hy)}" fill="none" stroke="${ink}" stroke-width="20" stroke-linecap="round"/>` +
      `<path d="M${side * 39} 63 Q${side * 61} ${n((63 + hy) / 2)} ${n(hx)} ${n(hy)}" fill="none" stroke="${kind === "bird" ? shirt : fur}" stroke-width="15" stroke-linecap="round"/>` + ellipse(hx, hy, kind === "bird" ? 15 : 11, 10, fur, ink, 2);
  };
  let body = `<g transform="translate(0 ${n(hop)}) rotate(${n(tilt)} 0 90)">`;
  if (kind === "cat" || kind === "fox" || kind === "dog") body += `<path d="M36 111 Q100 ${n(100 + beat * 12)} 77 ${n(61 + beat * 12)}" fill="none" stroke="${ink}" stroke-width="23" stroke-linecap="round"/><path d="M36 111 Q100 ${n(100 + beat * 12)} 77 ${n(61 + beat * 12)}" fill="none" stroke="${fur}" stroke-width="17" stroke-linecap="round"/>`;
  for (const side of [-1, 1]) {
    const fy = 163 + side * footLift;
    body += line(side * 23, 114, side * 31, fy, ink, 22) + line(side * 23, 114, side * 31, fy, fur, 16) + ellipse(side * 36, fy + 4, 23, 11, pale, ink, 2);
  }
  body += ellipse(0, 85, 48, 53, shirt, ink) + `<path d="M-29 53 Q0 69 29 53" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.7"/>` + ellipse(0, 86, 10, 10, "#fff1ae");
  body += arm(-1) + arm(1);
  const earWiggle = Math.sin(phase * 2) * 5;
  if (kind === "bunny") body += `<g transform="rotate(${n(-7 + earWiggle)} -26 -26)">${ellipse(-26, -65, 16, 47, fur, ink)}${ellipse(-26, -67, 7, 30, "#dfb4be")}</g><g transform="rotate(${n(7 - earWiggle)} 26 -26)">${ellipse(26, -65, 16, 47, fur, ink)}${ellipse(26, -67, 7, 30, "#dfb4be")}</g>`;
  else if (kind === "cat" || kind === "fox") body += `<path d="M-49 -5 L-42 -61 L-12 -32 M49 -5 L42 -61 L12 -32" fill="${fur}" stroke="${ink}" stroke-width="3"/><path d="M-40 -20 L-37 -46 L-21 -29 M40 -20 L37 -46 L21 -29" fill="#e7abb0"/>`;
  else if (kind === "bear") body += ellipse(-38, -32, 23, 24, fur, ink) + ellipse(38, -32, 23, 24, fur, ink) + ellipse(-38, -32, 13, 14, pale) + ellipse(38, -32, 13, 14, pale);
  else if (kind === "bird") body += `<path d="M-15 -38 Q-30 -77 3 -44 Q10 -78 22 -42" fill="${fur}" stroke="${ink}" stroke-width="3"/>`;
  body += ellipse(0, 0, 52, 46, fur, ink);
  if (kind === "dog") body += `<g transform="rotate(${n(earWiggle)} -47 -17)">${ellipse(-48, 0, 18, 37, "#9a7154", ink)}</g><g transform="rotate(${n(-earWiggle)} 47 -17)">${ellipse(48, 0, 18, 37, "#9a7154", ink)}</g>`;
  body += ellipse(0, 20, 29, 22, pale) + ellipse(-31, 15, 10, 5, "#e5a6a3") + ellipse(31, 15, 10, 5, "#e5a6a3");
  if (blink) body += `<path d="M-27 -5 Q-20 2 -13 -5 M13 -5 Q20 2 27 -5" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  else for (const side of [-1, 1]) body += ellipse(side * 20, -7, 10, 13, "white") + ellipse(side * 20 + (second ? -1 : 1), -5, 5, 8, ink) + ellipse(side * 20 + 2, -9, 2, 3, "white");
  body += kind === "bird" ? `<path d="M-9 13 L9 13 L0 ${n(22 + mouthOpen)}Z" fill="#e59d48" stroke="${ink}" stroke-width="2"/>`
    : ellipse(0, 15, 7, 5, ink) + ellipse(0, 30, 10, mouthOpen, "#94515c") + ellipse(0, 32 + mouthOpen / 2, 6, mouthOpen / 3, "#e994a1");
  return body + "</g>";
}

function sceneProp(stage: Stage, prop: Prop, phase: number) {
  const { width: w, ground, height: h } = stage;
  const x = w / 2, y = h > w ? ground - 260 : ground - 130;
  if (prop === "rain") return Array.from({ length: 16 }, (_, i) => {
    const dx = 30 + (i * 61) % (w - 60), dy = h * 0.24 + ((i * 29 + phase / tau * 110) % 130);
    return line(dx, dy, dx - 5, dy + 14, "#72bdda", 3);
  }).join("") + ellipse(x, ground + 14, w * 0.16, 10, "#86cadd") + ellipse(x, ground + 12, 30 + phase * 4, 5, "none", "#d4f4f7", 2);
  if (prop === "flower") return petalFlower(x, y, 25, phase, "#e7a4ba");
  if (prop === "umbrella") return `<g transform="translate(${x} ${y - 25}) rotate(${n(Math.sin(phase) * 9)})"><path d="M-69 0 Q0 -100 69 0 Q45 -14 23 0 Q0 -14 -23 0 Q-45 -14 -69 0Z" fill="#b8a1df" stroke="${ink}" stroke-width="3"/><path d="M0 0 V88 Q0 109 19 98" fill="none" stroke="${ink}" stroke-width="5"/></g>`;
  if (prop === "ball") return `<g transform="translate(${x + Math.sin(phase) * 38} ${ground - 20 - Math.abs(Math.sin(phase)) * 52}) rotate(${n(phase * 50)})">${ellipse(0, 0, 28, 28, "#eab674", ink)}<path d="M-28 0 H28 M0 -28 V28" stroke="#fff0d4" stroke-width="5"/></g>`;
  if (prop === "kite") return `<g transform="translate(${x + Math.sin(phase) * 25} ${y - 48 + Math.cos(phase) * 9}) rotate(${n(Math.sin(phase) * 12)})"><path d="M0 -51 L40 0 L0 59 L-40 0Z" fill="#e997a3" stroke="${ink}" stroke-width="3"/><path d="M0 -51 V59 L-40 0Z" fill="#f2cf7d"/><path d="M0 59 Q-29 84 0 107 T0 150" fill="none" stroke="${ink}" stroke-width="2"/></g>`;
  if (prop === "star") return `<g transform="translate(${x} ${y - 5}) rotate(${n(Math.sin(phase) * 9)}) scale(${n(1 + 0.05 * Math.sin(phase * 2))})"><path d="M0 -45 L14 -14 L47 -12 L23 11 L30 43 L0 27 L-30 43 L-23 11 L-47 -12 L-14 -14Z" fill="#f9dd83" stroke="${ink}" stroke-width="3"/>${ellipse(-10, -2, 3, 5, ink)}${ellipse(10, -2, 3, 5, ink)}<path d="M-9 11 Q0 19 9 11" fill="none" stroke="${ink}" stroke-width="2"/></g>`;
  if (prop === "drum") return `<g transform="translate(${x} ${ground - 36})"><path d="M-42 -34 H42 V18 Q0 37 -42 18Z" fill="#cf889f" stroke="${ink}" stroke-width="3"/>${ellipse(0, -34, 42, 15, "#ffebc9", ink)}<path d="M-36 -20 L-15 23 L7 -20 L28 23 L38 -20" fill="none" stroke="#ffdfa6" stroke-width="3"/>${line(-35, -80 + Math.sin(phase * 2) * 18, -8, -35, ink, 4)}${line(35, -80 - Math.sin(phase * 2) * 18, 8, -35, ink, 4)}</g>`;
  if (prop === "bridge") return `<path d="M0 ${ground + 4} Q${w / 2} ${ground - 34} ${w} ${ground + 4}" fill="none" stroke="#8bc6ce" stroke-width="45"/>` + Array.from({ length: 7 }, (_, i) => `<rect x="${x - 112 + i * 32}" y="${ground - 10}" width="28" height="21" rx="3" fill="#bb906b" stroke="${ink}" stroke-width="2"/>`).join("");
  if (prop === "letter") return `<g transform="translate(${x} ${y}) rotate(${n(Math.sin(phase) * 6)})"><rect x="-42" y="-28" width="84" height="56" rx="5" fill="#fff5d9" stroke="${ink}" stroke-width="3"/><path d="M-42 -28 L0 7 L42 -28" fill="none" stroke="${ink}" stroke-width="3"/>${ellipse(0, 8, 8, 8, "#de91aa")}</g>`;
  if (prop === "gift" || prop === "toys") return `<g transform="translate(${x} ${ground - 33})"><rect x="-40" y="-27" width="80" height="62" rx="5" fill="#e2b887" stroke="${ink}" stroke-width="3"/><rect x="-23" y="-54" width="35" height="35" rx="5" fill="#84b8c4" transform="rotate(${n(Math.sin(phase) * 6)})" stroke="${ink}" stroke-width="2"/>${ellipse(19, -30, 18, 18, "#d398b6", ink, 2)}</g>`;
  return "";
}

export function kidsAnimationSvg(options: { topic: string; caption: string; index: number; frame: number; aspect: "9:16" | "16:9"; cast: [KidsAnimationKind, KidsAnimationKind]; song?: boolean; transparent?: boolean }) {
  const vertical = options.aspect === "9:16";
  const stage: Stage = vertical ? { width: 540, height: 960, ground: 734, y: 532, size: 1.12 } : { width: 960, height: 540, ground: 442, y: 272, size: 0.94 };
  const { width: w, height: h, ground } = stage;
  const scene = planKidsAnimationScene(options.topic.toLowerCase(), options.caption, options.index);
  const phase = options.frame % CYCLE_FRAMES / CYCLE_FRAMES * tau;
  const colors = scene.theme === "night" ? ["#344875", "#7b90ac"] : scene.theme === "ocean" ? ["#73bdce", "#b5e8e0"] : ["#a2d7e5", "#e8f5e8"];
  let body = backdrop(stage, scene, phase, !!options.transparent);
  // Drums are held in front of each player's hands, not floating in the gap.
  if (scene.prop !== "drum") body += sceneProp(stage, scene.prop, phase);
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
      const charPhase = phase + (i ? Math.PI * 0.15 : 0);
      const travel = scene.action === "march" ? Math.sin(phase) * (vertical ? 13 : 27) : 0;
      const x = w * (i ? (vertical ? 0.74 : 0.71) : (vertical ? 0.26 : 0.29)) + travel;
      const size = stage.size * (scene.close ? 1.1 : 1);
      const y = stage.y - (scene.close ? 14 : 0);
      body += ellipse(x, ground + 4, 62 - Math.max(0, Math.sin(charPhase * 2)) * (scene.action === "hop" ? 10 : 0), 9, "#43697b22");
      body += `<g transform="translate(${n(x)} ${n(y)}) scale(${size})">${puppet(kind, scene.action, charPhase, !!options.song, i === 1)}</g>`;
      if (scene.prop === "drum") {
        body += `<g transform="translate(${n(x)} ${n(y + 108 * size)}) scale(${size})"><path d="M-38 0 H38 V34 Q0 48 -38 34Z" fill="#d692a9" stroke="${ink}" stroke-width="3"/>${ellipse(0, 0, 38, 12, "#ffedce", ink)}<path d="M-31 12 L-13 36 L4 12 L24 36 L32 12" fill="none" stroke="#ffedce" stroke-width="3"/>${line(-23, -31 + Math.sin(charPhase * 2) * 16, -11, -8, ink, 3)}${line(25, -31 - Math.sin(charPhase * 2) * 16, 11, -8, ink, 3)}</g>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>${body}</svg>`;
}

export async function prepareKidsAnimation(options: { directory: string; topic: string; cues: KidsAnimationCue[]; duration: number; aspect: "9:16" | "16:9"; cast: [KidsAnimationKind, KidsAnimationKind]; song: boolean; transparent?: boolean; onProgress?: (percent: number) => Promise<unknown> }) {
  sharp.concurrency(1);
  const folder = path.join(options.directory, "animation");
  await fs.mkdir(folder, { recursive: true });
  const rendered = new Set<string>();
  const timeline: string[] = [];
  const frames = Math.ceil(options.duration * KIDS_ANIMATION_FPS);
  let cueIndex = 0;
  let lastFile = "";
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / KIDS_ANIMATION_FPS;
    while (cueIndex < options.cues.length - 1 && time >= options.cues[cueIndex].end) cueIndex++;
    const cue = options.cues[cueIndex];
    const scene = planKidsAnimationScene(options.topic.toLowerCase(), cue.text, cueIndex);
    const pose = frame % CYCLE_FRAMES;
    const key = createHash("sha1").update(JSON.stringify([scene, pose, options.cast, options.aspect, options.transparent, options.song])).digest("hex").slice(0, 16);
    const filename = `animation/${key}.png`;
    if (!rendered.has(key)) {
      const svg = kidsAnimationSvg({ topic: options.topic, caption: cue.text, index: cueIndex, frame: pose, aspect: options.aspect, cast: options.cast, song: options.song, transparent: options.transparent });
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
  await fs.writeFile(path.join(options.directory, "animation-plan.json"), JSON.stringify({ version: 2, fps: KIDS_ANIMATION_FPS, uniqueFrames: rendered.size, frames, scenes: options.cues.map((cue, index) => ({ ...cue, ...planKidsAnimationScene(options.topic.toLowerCase(), cue.text, index) })) }, null, 2));
  return { uniqueFrames: rendered.size, frames };
}

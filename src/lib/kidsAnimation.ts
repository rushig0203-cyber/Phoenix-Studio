import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { kidsCharacterSvg, kidsRigMotion, type KidsRigPose } from "./kidsCharacterRig";
import { kidsNarratedActions, reportsKiteFlight, reportsKiteResolution } from "./kidsObjectEvents";
import { kidsMouthState, kidsPoseBudgets, kidsShotFor, kidsStoryBeat, mix, ramp, quantizeKidsProgress, unit, KIDS_MAX_UNIQUE_FRAMES, type KidsAnimationPerformanceFrame, type KidsExpression, type KidsShot, type KidsStoryIntent } from "./kidsAnimationTimeline";
export type { KidsAnimationPerformanceFrame } from "./kidsAnimationTimeline";

export type KidsAnimationCue = { text: string; start: number; end: number };
export type KidsAnimationKind = "dog" | "cat" | "bunny" | "bird" | "bear" | "fox" | "fish";
export type KidsAnimationAction = "clap" | "hop" | "wave" | "march" | "sway" | "flap" | "drum" | "reach" | "sleep" | "listen";
type Prop = "rain" | "umbrella" | "flower" | "drum" | "kite" | "ball" | "star" | "gift" | "toys" | "bridge" | "letter" | "bus" | "none";
export type KidsAnimationScene = { action: KidsAnimationAction; prop: Prop; theme: "garden" | "night" | "ocean" | "room"; close: boolean; emotion: KidsExpression; emotionFrom?: KidsExpression; kiteState: "tangled" | "held" | "flying"; kiteCaughtHigh: boolean; kiteFrom?: "tangled" | "held" | "flying"; kiteFromHigh?: boolean; intent: KidsStoryIntent; objectState: "grounded" | "held" | "offered" | "received" | "arranged"; objectOwner: 0 | 1; objectFrom?: 0 | 1; shot: KidsShot; focus?: 0 | 1 };
type Scene = KidsAnimationScene;
type Stage = { width: number; height: number; ground: number; y: number; size: number };

// Limited animation at 12fps, with a finite action and a held reaction per cue.
// Quantized poses and audio mouth forms share a fixed raster budget.
export const KIDS_ANIMATION_FPS = 12;
const ACTION_PREVIEW_FRAMES = KIDS_ANIMATION_FPS * 4;
const ink = "#485365";
const tau = Math.PI * 2;
const n = (value: number) => Number(value.toFixed(2));
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, stroke = "none", sw = 3) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const line = (x1: number, y1: number, x2: number, y2: number, fill: string, width: number) =>
  `<path d="M${n(x1)} ${n(y1)} L${n(x2)} ${n(y2)}" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

export function planKidsAnimationScene(topic: string, text: string, index = 0, previous?: Scene): Scene {
  topic = topic.toLowerCase();
  const words = kidsNarratedActions(text).toLowerCase();
  const theme = /ocean|underwater|fish|shark/.test(topic) ? "ocean" : /bedtime|sleep|moon|night|star/.test(topic) ? "night" : /clean|tidy|playroom|toy/.test(topic) ? "room" : "garden";
  let action: KidsAnimationAction = /clap|pat your/.test(words) ? "clap"
    : /drum|bucket|tap.*beat/.test(words) ? "drum"
    : /fly|flies/.test(words) && /kite/.test(`${topic} ${words}`) ? "reach"
    : /flap|wing|fly|flies/.test(words) ? "flap"
    : /hop|jump|bounce|splash/.test(words) ? "hop"
    : /sleep|breathe|hush|rest|close.*eyes/.test(words) ? "sleep"
    : /wave|hello|goodbye|goodnight/.test(words) ? "wave"
    : /march|step|walk|cross|follow|hurri|tiptoe/.test(words) ? "march"
    : /reach|pick|lift|carry|carried|hold|held|share|help|give|gave|pass|hands?|handed/.test(words) ? "reach" : "sway";
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
    : /star|moon/.test(topic) ? "star" : /flower|garden/.test(topic) ? "flower" : previous?.prop || "none";
  const resolved = reportsKiteResolution(words);
  const tangled = !resolved && /\b(?:tangled?|stuck|caught|snagged|knotted)\b/.test(words);
  const flight = reportsKiteFlight(words);
  const heldKite = /\b(?:holds?|held|carried|carries|picked up|built|made)\s+(?:(?:the|their|our|my|a)\s+)?kite\b(?!\s+(?:string|ribbon|spool|tail|line)\b)/.test(words);
  const kiteState = tangled || previous?.kiteState === "tangled" && !resolved ? "tangled"
    : flight ? "flying" : resolved || heldKite ? "held" : previous?.kiteState || "held";
  const kiteCaughtHigh = kiteState === "tangled" && (/branch|tree|vine/.test(words) || !!previous?.kiteCaughtHigh);
  const emotion: KidsExpression = resolved || /\b(?:smil\w*|laugh\w*|happy|solved|cheer\w*)\b/.test(text.toLowerCase()) ? "happy"
    : /relieved|phew/.test(words) ? "relieved" : /determined|carefully|try again|tried again/.test(words) ? "determined"
    : /gasp|surprised|amazed/.test(words) ? "surprised" : /tired|sleepy|yawn/.test(words) ? "tired"
    : /lost|stuck|torn|\btangle|problem|afraid|dim|sad|wrong|wobbl|worried/.test(words) ? "worried"
    : /look|notice|wonder|clue|find|surpris/.test(words) ? "curious" : previous?.emotion || "happy";
  const intent: KidsStoryIntent = /give|gave|pass|offer|share|\bhands?\b|handed/.test(words) ? "offer"
    : /receive|accept|took|takes/.test(words) ? "receive" : resolved || /untangl|unty|unwind/.test(words) ? "untangle"
    : /comfort|beside|hug|reassur/.test(words) ? "comfort" : /look|notice|wonder|sad|afraid|worried/.test(words) || action === "sway" && /watch|listen/.test(words) ? "observe"
    : action === "sleep" ? "rest" : action === "wave" ? "greet" : action === "march" ? "approach"
    : /cheer|laugh|hooray|celebrat/.test(words) ? "celebrate" : action === "reach" ? "explore" : "perform";
  if (intent === "untangle") action = "reach";
  const objectState = intent === "offer" ? "offered" : intent === "receive" ? "received"
    : /tidied|sorted|cleaned|put.*away/.test(words) ? "arranged" : /hold|held|carry|carried|pick|lift/.test(words) ? "held"
    : previous?.prop === prop ? previous.objectState : "grounded";
  const previousOwner = previous?.prop === prop ? previous.objectOwner : 0;
  const objectOwner: 0 | 1 = intent === "offer" ? (previousOwner ? 0 : 1) : previousOwner;
  const objectFrom = intent === "offer" ? previousOwner : undefined;
  const shot = kidsShotFor(intent, index, -1, prop !== "none");
  const kiteFrom = prop === "kite" && previous?.kiteState !== kiteState ? previous?.kiteState : undefined;
  return { action, prop, theme, close: shot === "reaction", emotion, emotionFrom: previous?.emotion !== emotion ? previous?.emotion : undefined, kiteState, kiteCaughtHigh, kiteFrom, kiteFromHigh: kiteFrom ? previous?.kiteCaughtHigh : undefined, intent, objectState, objectOwner, objectFrom, shot };
}

export function planKidsPerformance(text: string, cast: [KidsAnimationKind, KidsAnimationKind], names?: [string, string], song = false) {
  const lower = text.toLowerCase();
  const aliases = cast.map((kind, index) => [kind, names?.[index], kind === "bunny" ? "rabbit" : kind === "dog" ? "puppy" : kind === "cat" ? "kitten" : ""].filter(Boolean).map(name => name!.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const mentioned = aliases.map(values => values.some(name => new RegExp(`\\b${name}\\b`).test(lower)));
  const subject = aliases.findIndex(values => values.some(name => new RegExp(`\\b${name}\\s+(?:(?:quietly|carefully|gently|slowly|kindly)\\s+)?(?:give[sn]?|gave|hands?|handed|passes?|passed|offers?|offered|holds?|held|carries|carried|picks?|picked|lifts?|lifted)\\b`).test(lower)));
  const observing = aliases.map(values => values.some(name => new RegExp(`\\b${name}\\s+(?:(?:quietly|patiently|just)\\s+)?(?:watch(?:es|ed)?|listen(?:s|ed)?|wait(?:s|ed)?|looks? on)\\b`).test(lower)));
  const shared = song || /\b(?:together|both|they|friends)\b/.test(lower) || !mentioned.some(Boolean);
  return { active: mentioned.map((value, index) => song || !observing[index] && (shared || value)), subject, speaker: song ? -1 : /[“"]/.test(text) ? Math.max(0, mentioned.indexOf(true)) : -1 };
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

/** Legacy phase helper for saved pose callers. Production uses the finite rig. */
export function kidsHopPose(phase: number) {
  const t = ((phase / Math.PI) % 1 + 1) % 1;
  const flight = t >= .18 && t < .78 ? Math.sin((t - .18) / .6 * Math.PI) : 0;
  const squash = t < .18 ? -.09 * Math.sin(t / .18 * Math.PI)
    : t >= .78 && t < .94 ? -.07 * Math.sin((t - .78) / .16 * Math.PI) : .045 * flight;
  return { lift: flight * 34, scaleY: 1 + squash, scaleX: 1 / (1 + squash) };
}


function sceneProp(stage: Stage, scene: Scene, phase: number, contact?: { x: number; y: number; transfer: number }) {
  const prop = scene.prop;
  const { width: w, ground, height: h } = stage;
  const x = contact?.x ?? w / 2, y = contact?.y ?? (h > w ? ground - 260 : ground - 130);
  if (prop === "rain") return Array.from({ length: 16 }, (_, i) => {
    const dx = 30 + (i * 61) % (w - 60), dy = h * 0.24 + ((i * 29 + phase / tau * 110) % 130);
    return line(dx, dy, dx - 5, dy + 14, "#72bdda", 3);
  }).join("") + ellipse(x, ground + 14, w * 0.16, 10, "#86cadd") + ellipse(x, ground + 12, 30 + phase * 4, 5, "none", "#d4f4f7", 2);
  if (prop === "flower") return petalFlower(x, contact ? y - 28 : ground - 48, 25, phase * .15, "#e7a4ba");
  if (prop === "umbrella") return `<g transform="translate(${n(contact ? x - 19 : x)} ${n(contact ? y - 98 : y - 25)}) rotate(${n(contact ? 0 : Math.sin(phase) * 9)})"><path d="M-69 0 Q0 -100 69 0 Q45 -14 23 0 Q0 -14 -23 0 Q-45 -14 -69 0Z" fill="#b8a1df" stroke="${ink}" stroke-width="3"/><path d="M0 0 V88 Q0 109 19 98" fill="none" stroke="${ink}" stroke-width="5"/></g>`;
  if (prop === "ball") return `<g data-object-state="${scene.objectState}" transform="translate(${n(x)} ${n(contact ? y : ground - 28)}) rotate(${n((contact?.transfer || 0) * 90)})">${ellipse(0, 0, 28, 28, "#eab674", ink)}<path d="M-28 0 H28 M0 -28 V28" stroke="#fff0d4" stroke-width="5"/></g>`;
  if (prop === "kite") {
    const position = kitePosition(stage, scene, phase);
    const branch = scene.kiteCaughtHigh ? `<path d="M${w * .85} ${ground} Q${w * .89} ${position.y} ${position.x + 115} ${position.y - 54} M${position.x + 120} ${position.y - 40} L${position.x - 15} ${position.y - 27}" fill="none" stroke="#997b61" stroke-width="12" stroke-linecap="round"/>` : "";
    const knot = scene.kiteState === "tangled" ? `<path data-kite-knot="true" d="M-27 30 C-65 -22 34 -29 13 28 S-46 69 -35 11 S48 -6 26 39 S-17 70 -27 30" fill="none" stroke="#867a71" stroke-width="3"/>` : "";
    return branch + `<g data-kite-state="${scene.kiteState}" transform="translate(${n(position.x)} ${n(position.y)}) rotate(${n(scene.kiteState === "flying" ? Math.sin(phase) * 12 : scene.kiteState === "tangled" ? -18 : 0)})"><path d="M0 -51 L40 0 L0 59 L-40 0Z" fill="#e997a3" stroke="${ink}" stroke-width="3"/><path d="M0 -51 V0 H-40Z" fill="#f2cf7d"/><path d="M0 0 L40 0 L0 59Z" fill="#91bdb4"/><path d="M0 -49 V57 M-38 0 H38" fill="none" stroke="#fff1ca" stroke-width="2"/><path d="M0 59 Q-29 84 0 107 T0 150" fill="none" stroke="${ink}" stroke-width="2"/><path d="M-12 79 l-12 -8 v15 l12 -7 12 7 v-15Z M4 114 l-12 -7 v14 l12 -7 12 7 v-14Z" fill="#e2a6b0" stroke="#b68b91" stroke-width="1"/><path d="M3 -37 L27 -8" stroke="#fff9dc" stroke-width="3" stroke-linecap="round" opacity=".7"/>${knot}</g>`;
  }
  if (prop === "star") return `<g transform="translate(${x} ${y - 5}) rotate(${n(Math.sin(phase) * 9)}) scale(${n(1 + 0.05 * Math.sin(phase * 2))})"><path d="M0 -45 L14 -14 L47 -12 L23 11 L30 43 L0 27 L-30 43 L-23 11 L-47 -12 L-14 -14Z" fill="#f9dd83" stroke="${ink}" stroke-width="3"/>${ellipse(-10, -2, 3, 5, ink)}${ellipse(10, -2, 3, 5, ink)}<path d="M-9 11 Q0 19 9 11" fill="none" stroke="${ink}" stroke-width="2"/></g>`;
  if (prop === "drum") return `<g transform="translate(${x} ${ground - 36})"><path d="M-42 -34 H42 V18 Q0 37 -42 18Z" fill="#cf889f" stroke="${ink}" stroke-width="3"/>${ellipse(0, -34, 42, 15, "#ffebc9", ink)}<path d="M-36 -20 L-15 23 L7 -20 L28 23 L38 -20" fill="none" stroke="#ffdfa6" stroke-width="3"/>${line(-35, -80 + Math.sin(phase * 2) * 18, -8, -35, ink, 4)}${line(35, -80 - Math.sin(phase * 2) * 18, 8, -35, ink, 4)}</g>`;
  if (prop === "bridge") return `<path d="M0 ${ground + 4} Q${w / 2} ${ground - 34} ${w} ${ground + 4}" fill="none" stroke="#8bc6ce" stroke-width="45"/>` + Array.from({ length: 7 }, (_, i) => `<rect x="${x - 112 + i * 32}" y="${ground - 10}" width="28" height="21" rx="3" fill="#bb906b" stroke="${ink}" stroke-width="2"/>`).join("");
  if (prop === "letter") return `<g data-object-state="${scene.objectState}" transform="translate(${n(x)} ${n(y)})"><rect x="-42" y="-28" width="84" height="56" rx="5" fill="#fff5d9" stroke="${ink}" stroke-width="3"/><path d="M-42 -28 L0 7 L42 -28" fill="none" stroke="${ink}" stroke-width="3"/>${ellipse(0, 8, 8, 8, "#de91aa")}</g>`;
  if (prop === "gift" || prop === "toys") return `<g data-object-state="${scene.objectState}" transform="translate(${n(x)} ${n(contact ? y : ground - 33)})"><rect x="-40" y="-27" width="80" height="62" rx="5" fill="#e2b887" stroke="${ink}" stroke-width="3"/><rect x="-23" y="-54" width="35" height="35" rx="5" fill="#84b8c4" stroke="${ink}" stroke-width="2"/>${ellipse(19, -30, 18, 18, "#d398b6", ink, 2)}</g>`;
  return "";
}

export type KidsAnimationSvgOptions = {
  topic: string; caption: string; index: number; frame: number; aspect: "9:16" | "16:9";
  cast: [KidsAnimationKind, KidsAnimationKind]; castNames?: [string, string]; scene?: Scene;
  song?: boolean; transparent?: boolean; sceneProgress?: number;
  performance?: KidsAnimationPerformanceFrame; speaker?: -1 | 0 | 1; mouthOpen?: number;
};

/** The same coordinate contacts drive the rig, strings and held objects. */
export function kidsAnimationContact(aspect: "9:16" | "16:9", progress: number, owner: 0 | 1 = 0, transfer = false) {
  const vertical = aspect === "9:16", width = vertical ? 540 : 960, ground = vertical ? 734 : 442, size = vertical ? 1.12 : 1.04;
  const positions = [width * (vertical ? .26 : transfer ? .36 : .29), width * (vertical ? .74 : transfer ? .64 : .71)];
  const fromX = positions[owner] + (owner ? -1 : 1) * 86 * size;
  const toX = positions[1 - owner] + (owner ? 1 : -1) * 86 * size;
  const amount = transfer ? ramp(progress, .35, .78) : 0;
  return { x: mix(fromX, toX, amount), y: ground - 91 * size, transfer: amount };
}

function actorPose(action: KidsAnimationAction, progress: number, scene: Scene, actor: number, mouth: ReturnType<typeof kidsMouthState>, contact: ReturnType<typeof kidsAnimationContact> | undefined, x: number, y: number, size: number): KidsRigPose {
  const facing = actor ? -1 : 1;
  const emotion = scene.emotionFrom && progress < .58 ? scene.emotionFrom : action === "listen" && scene.emotion === "happy" && progress < .58 ? "curious" : scene.emotion;
  return { action, progress, emotion, facing, second: actor === 1,
    speaking: mouth.speaker === actor, mouthOpen: mouth.mouthOpen,
    handTarget: contact ? [(contact.x - x) / size, (contact.y - y) / size] : undefined,
    blink: progress > (actor ? .81 : .76) && progress < (actor ? .85 : .80),
  };
}

export function kidsAnimationSvg(options: KidsAnimationSvgOptions) {
  const vertical = options.aspect === "9:16";
  const stage: Stage = vertical ? { width: 540, height: 960, ground: 734, y: 532, size: 1.12 } : { width: 960, height: 540, ground: 442, y: 272, size: 1.04 };
  const { width: w, height: h, ground, size } = stage;
  const scene = options.scene || planKidsAnimationScene(options.topic, options.caption, options.index);
  const planned = planKidsPerformance(options.caption, options.cast, options.castNames, options.song);
  const performance = options.performance || { speaker: options.speaker, mouthOpen: options.mouthOpen };
  const mouth = kidsMouthState(performance, planned.speaker, !!options.song);
  const active = performance.active || planned.active;
  const p = unit(options.sceneProgress ?? options.frame / (ACTION_PREVIEW_FRAMES - 1));
  const phase = p * tau; // A single passage of ambient wind, never a modulo loop.
  const beat = kidsStoryBeat(p);
  const visibleScene = scene.prop === "kite" && scene.kiteFrom && p < .58 ? { ...scene, kiteState: scene.kiteFrom, kiteCaughtHigh: !!scene.kiteFromHigh } : scene;
  const colors = scene.theme === "night" ? ["#344875", "#7b90ac"] : scene.theme === "ocean" ? ["#73bdce", "#b5e8e0"] : ["#b4d9da", "#f7ebce"];
  const portable = ["letter", "gift", "ball", "flower", "toys", "umbrella", "star"].includes(scene.prop);
  const interacting = portable && (scene.action === "reach" || ["held", "offered", "received"].includes(scene.objectState));
  const directSubject = planned.subject === 0 || planned.subject === 1 ? planned.subject : undefined;
  const owner = !options.scene && scene.intent === "offer" && directSubject !== undefined ? directSubject : scene.objectFrom ?? (scene.objectState === "grounded" && active[0] !== active[1] ? (active[1] ? 1 : 0) : scene.objectOwner);
  const transfer = scene.intent === "offer";
  const contact = interacting ? kidsAnimationContact(options.aspect, p, owner, transfer) : undefined;
  const shot = options.scene?.shot || kidsShotFor(scene.intent, options.index, mouth.speaker, scene.prop !== "none");
  const focus = shot === "speaker" ? (scene.focus ?? Math.max(0, planned.speaker, mouth.speaker)) : shot === "reaction" ? (active[0] !== active[1] ? (active[0] ? 1 : 0) : options.index % 2) : -1;
  const focusX = focus >= 0 ? w * (focus ? (vertical ? .74 : .71) : (vertical ? .26 : .29)) : w / 2;
  const zoom = shot === "wide" ? 1 : shot === "reaction" || shot === "speaker" ? (vertical ? 1.16 : 1.24) : shot === "detail" ? (vertical ? 1.07 : 1.18) : (vertical ? 1.02 : 1.06);
  const camera = { zoom: zoom + (shot === "detail" ? .035 * beat.action : 0), x: mix(w / 2, focusX, .42), y: vertical ? ground - 163 : ground - 132 };
  let world = backdrop(stage, scene, phase * .13, !!options.transparent);
  if (!interacting && scene.prop !== "drum" && scene.prop !== "bus") world += sceneProp(stage, visibleScene, phase * .2);
  if (scene.prop === "bus") {
    const drive = ramp(p, .16, .72), busX = mix(w * .43, w * .57, drive), busY = ground - 97;
    world += `<g data-object-state="travelling" transform="translate(${n(busX)} ${busY})"><rect x="-190" y="-85" width="380" height="157" rx="30" fill="#f3ce80" stroke="${ink}" stroke-width="4"/><path d="M-182 33 H180" stroke="#d78f66" stroke-width="8"/><rect x="-166" y="-65" width="96" height="67" rx="12" fill="#b7e2e7"/><rect x="-44" y="-65" width="96" height="67" rx="12" fill="#b7e2e7"/><rect x="77" y="-65" width="81" height="127" rx="10" fill="#a8d5de" stroke="${ink}" stroke-width="3"/><defs><clipPath id="passengers"><rect x="-166" y="-65" width="96" height="67" rx="12"/><rect x="-44" y="-65" width="96" height="67" rx="12"/></clipPath></defs><g clip-path="url(#passengers)">`;
    for (const [i, kind] of options.cast.entries()) {
      const pose = actorPose("wave", p, scene, i, mouth, undefined, 0, 0, .48);
      if (options.song && mouth.mouthOpen > 0) pose.speaking = true;
      world += `<g transform="translate(${-120 + i * 122} -28) scale(.48)">${kidsCharacterSvg(kind, pose)}</g>`;
    }
    world += "</g>";
    for (const wx of [-120, 123]) world += `<g transform="translate(${wx} 76) rotate(${n(drive * 240)})">${ellipse(0, 0, 35, 35, ink)}${ellipse(0, 0, 22, 22, "#dce2e7")}${line(-18, 0, 18, 0, "#8396a6", 5)}${line(0, -18, 0, 18, "#8396a6", 5)}</g>`;
    world += "</g>";
  } else {
    for (const [i, kind] of options.cast.entries()) {
      const receiving = transfer && i !== owner && p >= .4;
      let action = receiving || interacting && i === owner ? "reach" : active[i] ? scene.action : "listen";
      if (scene.prop === "kite" && i === owner && scene.objectState === "held") action = "reach";
      if (scene.prop === "kite" && i !== owner && scene.intent !== "untangle" && action === "reach") action = "listen";
      const travel = action === "march" ? (i ? -1 : 1) * ramp(p, .14, .70) * (vertical ? 18 : 39) : 0;
      const x = w * (i ? (vertical ? .74 : transfer ? .64 : .71) : (vertical ? .26 : transfer ? .36 : .29)) + travel, y = ground - 176 * size;
      const rigContact = scene.prop === "kite" && action === "reach" ? kidsAnimationContact(options.aspect, p, scene.intent === "untangle" ? i as 0 | 1 : owner) : contact;
      const pose = actorPose(action, p, scene, i, mouth, rigContact, x, y, size);
      if (transfer && i === owner && pose.handTarget) {
        const release = ramp(p, .62, .87), direction = i ? -1 : 1;
        pose.handTarget = [mix(pose.handTarget[0], direction * 66, release), mix(pose.handTarget[1], 105, release)];
      }
      if (options.song && mouth.mouthOpen > 0) pose.speaking = true;
      const motion = kidsRigMotion(pose);
      world += ellipse(x, ground + 3, 53 - motion.lift * .28, 8, "#3f5b6226");
      world += `<g data-actor="${i}" data-action="${action}" data-speaking="${pose.speaking}" data-beat="${beat.stage}"${pose.handTarget ? ` data-hand-target="${n(pose.handTarget[0])},${n(pose.handTarget[1])}"` : ""} transform="translate(${n(x)} ${n(y)}) scale(${size})">${kidsCharacterSvg(kind, pose)}</g>`;
      if (scene.prop === "drum") world += `<g transform="translate(${n(x)} ${n(y + 108 * size)}) scale(${size})"><path d="M-38 0 H38 V34 Q0 48 -38 34Z" fill="#d692a9" stroke="${ink}" stroke-width="3"/>${ellipse(0, 0, 38, 12, "#ffedce", ink)}<path d="M-31 12 L-13 36 L4 12 L24 36 L32 12" fill="none" stroke="#ffedce" stroke-width="3"/>${line(motion.hands[0][0], motion.hands[0][1] - 108, -11, -8, ink, 3)}${line(motion.hands[1][0], motion.hands[1][1] - 108, 11, -8, ink, 3)}</g>`;
    }
    if (scene.prop === "kite" && (scene.action === "reach" || scene.objectState === "held")) {
      const holder = kidsAnimationContact(options.aspect, p, owner);
      const position = kitePosition(stage, visibleScene, phase * .2);
      world += `<path data-contact="kite-string" d="M${n(position.x)} ${n(position.y)} Q${n((position.x + holder.x) / 2)} ${n(holder.y - 27)} ${n(holder.x)} ${n(holder.y)}" fill="none" stroke="#867a71" stroke-width="1.5"/>`;
    }
    if (contact) world += `<g data-contact="hands" data-transfer="${n(contact.transfer)}">${sceneProp(stage, scene, phase * .2, contact)}</g>`;
  }
  world += foreground(stage, scene, phase * .13);
  // Preserve a caption-safe top region; crop the story world around the actors.
  const cameraTransform = `translate(${n(w / 2)} ${n(camera.y)}) scale(${n(camera.zoom)}) translate(${n(-camera.x)} ${n(-camera.y)})`;
  const body = (options.transparent ? "" : `<rect width="${w}" height="${h}" fill="url(#sky)"/>`) + `<g data-shot="${shot}" data-scene-progress="${n(p)}" data-timeline="finite" transform="${cameraTransform}">${world}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient><linearGradient id="leaves" x2=".7" y2="1"><stop stop-color="#bed795"/><stop offset=".5" stop-color="#84b48c"/><stop offset="1" stop-color="#558c7a"/></linearGradient></defs>${body}</svg>`;
}

export type PrepareKidsAnimationOptions = {
  directory: string; topic: string; cues: KidsAnimationCue[]; duration: number; aspect: "9:16" | "16:9";
  cast: [KidsAnimationKind, KidsAnimationKind]; castNames?: [string, string]; song: boolean;
  transparent?: boolean; performanceFrames?: KidsAnimationPerformanceFrame[]; onProgress?: (percent: number) => Promise<unknown>;
};

export async function prepareKidsAnimation(options: PrepareKidsAnimationOptions) {
  if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration > 210) throw new Error("Animation duration must be positive and at most 210 seconds.");
  if (!options.cues.length || options.cues.some(cue => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start)) throw new Error("Animation needs valid timed narration scenes.");
  // Stock/source jobs and pure scene planning do not need the native rasterizer.
  const { default: sharp } = await import("sharp");
  sharp.concurrency(1);
  sharp.cache({ memory: 24, files: 0, items: 32 });
  try {
  const folder = path.join(options.directory, "animation");
  await fs.mkdir(folder, { recursive: true });
  const rendered = new Set<string>(), timeline: string[] = [], frames = Math.ceil(options.duration * KIDS_ANIMATION_FPS);
  const scenes: Scene[] = [], performances = options.cues.map(cue => planKidsPerformance(cue.text, options.cast, options.castNames, options.song));
  const signatures = options.cues.map(() => new Set<string>());
  let cueIndex = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (cueIndex < options.cues.length - 1 && frame / KIDS_ANIMATION_FPS >= options.cues[cueIndex].end) cueIndex++;
    const mouth = kidsMouthState(options.performanceFrames?.[frame], performances[cueIndex].speaker, options.song);
    signatures[cueIndex].add(JSON.stringify([mouth, options.performanceFrames?.[frame]?.active || performances[cueIndex].active]));
  }
  const poseBudgets = kidsPoseBudgets(signatures.map(values => values.size || 1));
  for (const [index, cue] of options.cues.entries()) {
    const scene = planKidsAnimationScene(options.topic, cue.text, index, scenes[index - 1]);
    const active = performances[index].active;
    const subject = performances[index].subject;
    const actor = subject === 0 || subject === 1 ? subject : active[0] !== active[1] ? (active[1] ? 1 : 0) : undefined;
    if (scene.objectState === "held" && /hold|held|carry|carried|pick|lift/i.test(cue.text) && actor !== undefined && (subject >= 0 || !/[“"]/.test(cue.text))) scene.objectOwner = actor;
    if (scene.intent === "offer" && actor !== undefined) { scene.objectFrom = actor; scene.objectOwner = actor ? 0 : 1; }
    const speaking = options.performanceFrames?.slice(Math.floor(cue.start * KIDS_ANIMATION_FPS), Math.ceil(cue.end * KIDS_ANIMATION_FPS)).find(value => (value.speaker ?? -1) >= 0)?.speaker ?? performances[index].speaker;
    scene.shot = kidsShotFor(scene.intent, index, speaking, scene.prop !== "none");
    if (speaking === 0 || speaking === 1) scene.focus = speaking;
    scenes.push(scene);
  }
  cueIndex = 0;
  let lastFile = "";
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / KIDS_ANIMATION_FPS;
    while (cueIndex < options.cues.length - 1 && time >= options.cues[cueIndex].end) cueIndex++;
    const cue = options.cues[cueIndex], scene = scenes[cueIndex], planned = performances[cueIndex];
    const performance = options.performanceFrames?.[frame];
    const mouth = kidsMouthState(performance, planned.speaker, options.song);
    const active = performance?.active || planned.active;
    const actionSeconds = Math.min(cue.end - cue.start, 4.5);
    const progress = quantizeKidsProgress((time - cue.start) / actionSeconds, poseBudgets[cueIndex]);
    const key = createHash("sha1").update(JSON.stringify([8, scene, progress, mouth, active, options.cast, options.aspect, options.transparent, options.song])).digest("hex").slice(0, 16);
    const filename = `animation/${key}.png`;
    if (!rendered.has(key)) {
      if (rendered.size >= KIDS_MAX_UNIQUE_FRAMES) throw new Error("Animation exceeded the bounded drawing budget; split the narration into fewer visual scenes.");
      const svg = kidsAnimationSvg({ topic: options.topic, caption: cue.text, index: cueIndex, frame, sceneProgress: progress, performance: { ...mouth, active: active as [boolean, boolean] }, aspect: options.aspect, cast: options.cast, castNames: options.castNames, scene, song: options.song, transparent: options.transparent });
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
  await fs.writeFile(path.join(options.directory, "animation-plan.json"), JSON.stringify({
    version: 8, timeline: "finite-action-reaction-hold", fps: KIDS_ANIMATION_FPS, rasterBudget: KIDS_MAX_UNIQUE_FRAMES, uniqueFrames: rendered.size, frames,
    speechAnimation: options.performanceFrames ? "measured-performance" : "text-speaker-estimate",
    scenes: options.cues.map((cue, index) => ({ ...cue, ...scenes[index], poseSamples: poseBudgets[index], actionSeconds: Math.min(cue.end - cue.start, 4.5), performance: performances[index] })),
  }, null, 2));
  await options.onProgress?.(100);
  return { uniqueFrames: rendered.size, frames };
  } finally {
    // The frame files are on disk now. Do not retain a native image cache while
    // speech/encoding or another queued job needs the same laptop memory.
    sharp.cache(false);
  }
}

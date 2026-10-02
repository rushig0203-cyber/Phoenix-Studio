import type { KidsAnimationAction, KidsAnimationKind } from "./kidsAnimation";
import { kidsStoryBeat, mix, ramp, type KidsExpression } from "./kidsAnimationTimeline";

type Point = [number, number];
export type KidsRigPose = {
  action: KidsAnimationAction; progress: number; emotion: KidsExpression; facing: -1 | 0 | 1;
  mouthOpen: number; speaking: boolean; second: boolean; handTarget?: Point; blink?: boolean;
};
const ink = "#423e50";
const n = (value: number) => Number(value.toFixed(2));
const oval = (x: number, y: number, rx: number, ry: number, color: string, stroke = "none", sw = 2.5) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>`;
const path = (d: string, fill: string, stroke = ink, width = 2.5) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const palette = {
  bunny: ["#f4e8d5", "#ead6bb", "#79afa4", "#547e78"], bird: ["#f5cb63", "#e9aa50", "#df8c76", "#bb6d64"],
  bear: ["#b88163", "#93634f", "#92a875", "#6c825d"], fox: ["#e79461", "#c57250", "#a6a5d0", "#75769e"],
  dog: ["#d7b180", "#987552", "#d7a36c", "#a77d5f"], cat: ["#e4b48d", "#bf896a", "#7fa6c0", "#5e7e9c"],
  fish: ["#f0ac85", "#cf8879", "#96bba7", "#729b8c"],
} as const;

export function kidsRigMotion(pose: KidsRigPose) {
  const { action, progress: p, facing } = pose;
  const beat = kidsStoryBeat(p);
  const anticipation = Math.sin(ramp(p, 0, .16) * Math.PI) * (p < .16 ? 1 : 0);
  const pulse = p >= .18 && p < .72 ? Math.sin((p - .18) / .54 * Math.PI * 2) : 0;
  const jump = action === "hop" && p >= .2 && p <= .7 ? Math.sin((p - .2) / .5 * Math.PI) : 0;
  const landing = action === "hop" && p > .7 && p < .84 ? Math.sin((p - .7) / .14 * Math.PI) : 0;
  const squash = action === "hop" ? -.11 * anticipation + .07 * jump - .08 * landing : 0;
  const lean = action === "reach" ? facing * mix(-3 * anticipation, 7, beat.action) : action === "sleep" ? facing * 9 * beat.action : action === "march" ? facing * 4 * (1 - beat.settle) : pose.emotion === "worried" ? -facing * 3 : facing * 2 * beat.reaction;
  const footLift = action === "march" ? pulse * 17 * (1 - beat.settle) : 0;
  const hands: [Point, Point] = [[-66, 105], [66, 105]];
  const front = facing < 0 ? 0 : 1, direction = facing || 1;
  if (action === "reach") {
    const target = pose.handTarget || [direction * 91, 77];
    hands[front] = [mix(direction * 65, target[0], beat.action), mix(105, target[1], beat.action)];
    hands[1 - front] = [-direction * 37, mix(105, 88, beat.action)];
  } else if (action === "wave") hands[front] = [direction * mix(66, 79 + pulse * 9, beat.action), mix(105, -15, beat.action)];
  else if (action === "clap") { const together = (1 - Math.cos((p - .16) / .54 * Math.PI * 4)) / 2; const a = p > .16 && p < .7 ? together : 0; hands[0] = [-mix(55, 4, a), 75]; hands[1] = [mix(55, 4, a), 75]; }
  else if (action === "drum") { hands[0] = [-27, 82 + pulse * 14]; hands[1] = [27, 82 - pulse * 14]; }
  else if (action === "flap") { hands[0] = [-87, 62 - pulse * 27]; hands[1] = [87, 62 - pulse * 27]; }
  else if (action === "sleep") { hands[0] = [direction * mix(-30, 19, beat.action), mix(100, 40, beat.action)]; hands[1] = [direction * mix(65, 33, beat.action), mix(105, 37, beat.action)]; }
  else if (action === "march") { hands[0] = [-63, 92 + pulse * 21]; hands[1] = [63, 92 - pulse * 21]; }
  else if (action === "hop") { hands[0] = [-66 - jump * 15, 105 - jump * 32]; hands[1] = [66 + jump * 15, 105 - jump * 32]; }
  else if (action === "sway") { hands[front] = [direction * mix(66, 57, beat.action), mix(105, 81, beat.action)]; }
  return { hands, lean, lift: jump * 44, scaleY: 1 + squash, scaleX: 1 / (1 + squash), footLift, ear: mix(-3 * anticipation, pose.emotion === "worried" ? -14 : 4, beat.reaction), beat };
}

function hand(x: number, y: number, color: string, bird: boolean, open: boolean, direction: number) {
  if (bird) return path(`M${n(x - 12)} ${n(y - 9)} Q${n(x - 26)} ${n(y + 5)} ${n(x - 12)} ${n(y + 12)} l8 -3 q7 9 10 0 q15 1 13 -10 q-6 -15 -19 -8Z`, color, ink, 2);
  return `<g data-hand="${open ? "open" : "grip"}" transform="translate(${n(x)} ${n(y)}) rotate(${direction * -15})">` + (open
    ? path("M-12 4 L-14 -6 Q-14 -12 -10 -9 L-5 -3 L-7 -15 Q-6 -20 -2 -15 L2 -5 L3 -18 Q6 -21 8 -17 L9 -5 L13 -12 Q18 -14 17 -8 L14 7 Q8 17 -4 12Z", color, ink, 2)
    : path("M-12 -2 Q-13 -13 -4 -10 Q2 -17 8 -9 Q17 -11 17 -1 Q19 12 8 14 Q-5 17 -12 7 Q-20 2 -17 -4 Q-14 -8 -9 -2", color, ink, 2)) + path("M-3 6 q8 5 15 -2", "none", "#a88c83", 1.1) + "</g>";
}

/** Original flat-ink characters with a three-quarter silhouette and separate hands. */
export function kidsCharacterSvg(kind: KidsAnimationKind, pose: KidsRigPose) {
  const [fur, shade, cloth, seam] = palette[kind];
  const shirt = pose.second ? ({ bunny: "#b695ba", bird: "#88a9bc", bear: "#b690a1", fox: "#89a991", dog: "#87abb6", cat: "#cba57f", fish: "#a5a0c2" }[kind]) : cloth;
  const pale = kind === "bear" ? "#e6c7a2" : "#fff0d7";
  const motion = kidsRigMotion(pose), face = pose.facing, look = face * 8;
  const blink = pose.blink || (pose.action === "sleep" && pose.progress > .35);
  const open = pose.speaking ? pose.mouthOpen : 0;
  if (kind === "fish") {
    const flip = face < 0 ? -1 : 1;
    return `<g data-character="fish" data-facing="${face}" transform="scale(${flip} 1) translate(0 60) rotate(${n(motion.lean)})">` + path("M-47 0 L-96 -35 Q-80 0 -96 35Z", shirt) + path("M-23 -34 Q0 -65 26 -34 M-18 35 Q0 54 18 37", shirt) + oval(0, 0, 63, 43, fur, ink) + path("M-45 14 Q2 2 58 20 Q26 52 -25 34Z", pale, "none") + path("M-24 -15 q12 8 0 16 M-6 -23 q12 8 0 16 M-8 0 q12 8 0 16", "none", shade, 1.4) + path(`M-8 4 Q-36 ${n(18 - motion.beat.action * 12)} -6 28 L11 9Z`, shirt) + oval(29, -13, 14, 17, "#fff9ed", ink, 1.8) + (blink ? path("M21 -12 q9 8 17 0", "none", ink, 2.5) : oval(34, -12, 6, 10, ink) + oval(36, -17, 2.8, 3.2, "#fff")) + oval(48, 8, 10, 4, "#d99798") + (open > 0 ? oval(53, 18, 7, 2 + open * 6, "#784959", ink, 1.4) : path("M47 17 q9 8 14 -1", "none", ink, 2.4)) + "</g>";
  }
  const nearSide = face < 0 ? -1 : 1;
  const arm = (side: number) => {
    const [hx, hy] = motion.hands[side < 0 ? 0 : 1];
    const elbowX = mix(side * 55, hx * .67, .65), elbowY = Math.max(63, (hy + 63) * .5 + 9);
    return `<g data-limb="${side === nearSide ? "near-arm" : "far-arm"}">` + path(`M${side * 35} 63 Q${n(elbowX)} ${n(elbowY)} ${n(hx)} ${n(hy)}`, "none", ink, 19) + path(`M${side * 35} 63 Q${n(elbowX)} ${n(elbowY)} ${n(hx)} ${n(hy)}`, "none", fur, 14) + path(`M${side * 34} 63 L${side * 46} ${n(68 + (hy - 63) * .2)}`, "none", shirt, 18) + hand(hx, hy, pale, kind === "bird", pose.action === "wave" || pose.action === "sway" || pose.action === "listen", side) + "</g>";
  };
  let art = `<g data-character="${kind}" data-facing="${face}" data-expression="${pose.emotion}" transform="translate(0 ${n(-motion.lift)}) rotate(${n(motion.lean)} 0 170) translate(0 176) scale(${n(motion.scaleX)} ${n(motion.scaleY)}) translate(0 -176)">`;
  // Species silhouettes remain distinct, even with the same pose and wardrobe.
  if (kind === "bunny") art += oval(-face * 43 || 43, 113, 19, 18, pale, ink, 2);
  if (kind === "fox") art += path(`M${-nearSide * 34} 111 Q${-nearSide * 111} 145 ${-nearSide * 89} 63 Q${-nearSide * 52} 59 ${-nearSide * 54} 95Z`, fur) + path(`M${-nearSide * 89} 63 Q${-nearSide * 95} 90 ${-nearSide * 82} 110 L${-nearSide * 65} 92Z`, pale, "none");
  if (kind === "cat" || kind === "dog") art += path(`M${-nearSide * 31} 116 Q${-nearSide * 90} 133 ${-nearSide * 82} 73`, "none", ink, kind === "dog" ? 19 : 15) + path(`M${-nearSide * 31} 116 Q${-nearSide * 90} 133 ${-nearSide * 82} 73`, "none", fur, kind === "dog" ? 14 : 10);
  art += arm(-nearSide);
  for (const side of [-1, 1]) {
    const fy = 165 + side * motion.footLift, fx = side * 29 + face * 5;
    art += `<g data-limb="leg">` + path(`M${side * 22} 113 Q${side * 27} ${n(144 + side * motion.footLift * .6)} ${fx} ${n(fy)}`, "none", ink, 22) + path(`M${side * 22} 113 Q${side * 27} ${n(144 + side * motion.footLift * .6)} ${fx} ${n(fy)}`, "none", fur, 16) + path(`M${side * 22} 118 L${side * 26} ${n(144 + side * motion.footLift * .45)}`, "none", seam, 22) + oval(fx + face * 5, fy + 3, 24, 12, pale, ink, 2.5) + path(`M${fx - 15} ${n(fy + 8)} q18 6 34 -1`, "none", "#c5ae9d", 1.4) + "</g>";
  }
  art += path("M-29 44 Q-46 52 -44 95 L-39 123 Q0 142 39 123 L44 95 Q46 52 29 44 Q0 38 -29 44Z", shirt) + path("M-28 49 Q0 67 28 49", "none", pale, 5) + path("M-37 96 Q0 108 37 96 M-36 114 Q0 126 36 114", "none", seam, 2.2);
  if (kind === "bear") art += path("M-5 58 V127 M-5 89 H26 V108 Q10 114 -5 108", "none", pale, 2) + oval(3, 71, 2.5, 2.5, pale) + oval(3, 92, 2.5, 2.5, pale);
  else if (kind === "dog") art += path("M-39 82 Q0 93 39 82 M-41 94 Q0 105 41 94", "none", "#f1d8ad", 5);
  else if (kind === "cat") art += path("M-26 53 L-22 89 H22 L26 53 M-21 94 H21 V112 Q0 122 -21 112Z", "none", pale, 3) + oval(-23, 88, 4, 4, "#efd89f") + oval(23, 88, 4, 4, "#efd89f");
  else art += path("M-12 91 H12 V107 Q0 113 -12 107Z", "none", pale, 1.4) + path("M-6 98 l5 -5 5 5 -5 5Z", "#f4d99a", "none");
  if (kind === "bunny") {
    for (const side of [-1, 1]) art += `<g transform="rotate(${n(side * (9 + motion.ear))} ${side * 25} -28)">` + path(`M${side * 24 - 13} -27 Q${side * 24 - 22} -109 ${side * 24} -112 Q${side * 24 + 21} -110 ${side * 24 + 12} -27Z`, fur) + path(`M${side * 24 - 5} -39 Q${side * 24 - 12} -96 ${side * 24} -99 Q${side * 24 + 9} -94 ${side * 24 + 5} -39Z`, "#d9a7aa", "none") + "</g>";
  } else if (kind === "bear") art += oval(-37, -34, 22, 22, fur, ink) + oval(38, -34, 22, 22, fur, ink) + oval(-37, -34, 12, 12, pale) + oval(38, -34, 12, 12, pale);
  else if (kind === "cat" || kind === "fox") art += path("M-49 -8 L-45 -64 L-14 -36 M49 -8 L43 -64 L14 -36", fur) + path("M-40 -24 L-38 -47 L-23 -32 M39 -23 L36 -47 L22 -32", "#dba09f", "none");
  else if (kind === "bird") art += path("M-10 -41 Q-20 -68 4 -48 Q12 -68 21 -39", fur);
  art += `<g data-head="three-quarter" transform="rotate(${n(pose.emotion === "curious" ? face * -7 : pose.emotion === "worried" ? face * 4 : face * -2)} 0 23)">`;
  art += path(`M-48 -14 C-50 -63 42 -68 53 -20 Q${58 + face * 5} 2 ${49 + face * 6} 19 Q${45 + face * 7} 39 ${look + 14} 46 Q${look - 22} 50 -42 30 Q-57 14 -48 -14Z`, fur);
  if (kind === "dog") art += `<g transform="rotate(${n(-10 - motion.ear)} -43 -25)">` + path("M-43 -31 Q-76 -30 -65 15 Q-58 41 -43 24 Q-29 5 -34 -20Z", shade) + "</g>" + path("M42 -31 Q64 -22 56 15 Q45 32 37 18", shade);
  if (kind === "fox") art += path(`M-45 5 Q-21 15 ${look} 21 Q28 8 49 1 L40 32 Q${look} 59 -37 31Z`, pale, "none");
  else if (kind !== "bird") art += oval(look, 25, kind === "bear" ? 30 : 33, 21, pale);
  if (kind === "cat") art += path("M-11 -43 l5 12 M1 -47 v13 M14 -42 l-6 12", "none", shade, 2.4);
  art += oval(-33 + look * .4, 18, 10, 5, "#d99294") + oval(33 + look * .5, 18, 10, 5, "#d99294");
  for (const side of [-1, 1]) {
    const far = face !== 0 && side !== face, ex = side * (far ? 17 : 23) + look, rx = far ? 8 : 12;
    if (blink) art += path(`M${ex - rx} -4 Q${ex} 3 ${ex + rx} -4`, "none", ink, 3);
    else art += oval(ex, -5, rx, pose.emotion === "surprised" ? 19 : 16, "#fff9ee", ink, 1.4) + oval(ex + face * 3, -3, far ? 4 : 6, 10, "#5b6979") + oval(ex + face * 3, -3, far ? 2.6 : 4, 8, ink) + oval(ex + face * 3 + 2, -8, 2.3, 3, "#fff");
    const browY = pose.emotion === "worried" ? (side === -1 ? -26 : -30) : pose.emotion === "determined" ? -21 : pose.emotion === "curious" && side === face ? -34 : -27;
    art += path(`M${ex - 9} ${browY + (pose.emotion === "worried" ? 4 : 0)} Q${ex} ${browY - 4} ${ex + 9} ${browY + (pose.emotion === "determined" ? 4 : 0)}`, "none", ink, 2.5);
  }
  if (kind === "bird") art += path(`M${look - 10} 11 Q${look + 8} 7 ${look + 21} 19 L${look + 1} ${n(27 + open * 8)}Z`, "#d8914e", ink, 2);
  else {
    art += path(`M${look - 7} 14 Q${look} 9 ${look + 8} 14 Q${look + 8} 22 ${look} 22 Q${look - 7} 21 ${look - 7} 14Z`, ink, ink, 1);
    if (open > 0) art += `<g data-mouth="${open}">` + path(`M${look - 11} 29 Q${look} 25 ${look + 12} 30 Q${look + 11} ${n(32 + open * 14)} ${look} ${n(34 + open * 15)} Q${look - 10} ${n(34 + open * 14)} ${look - 11} 29Z`, "#744557", ink, 1.3) + path(`M${look - 7} ${n(34 + open * 8)} Q${look} ${n(31 + open * 9)} ${look + 8} ${n(35 + open * 8)}`, "none", "#e79ca8", 3) + "</g>";
    else art += `<g data-mouth="closed">` + path(`M${look - 10} 30 Q${look} ${pose.emotion === "worried" ? 24 : pose.emotion === "curious" ? 32 : 40} ${look + 11} 29`, "none", ink, 2.5) + "</g>";
    if (kind === "cat" || kind === "fox") art += path(`M${look - 24} 20 l-23 -4 M${look - 23} 25 l-23 3 M${look + 26} 20 l20 -6 M${look + 27} 26 l19 3`, "none", shade, 1.4);
  }
  art += "</g>" + arm(nearSide);
  if (kind === "bird") art += path("M-18 47 L7 60 L25 45 L13 69 L20 92 L3 80 L-8 93 L-6 66Z", shirt, ink, 1.6);
  if (kind === "bunny") art += path("M-29 44 Q0 58 30 42 L25 55 Q0 72 -30 55Z M17 55 L35 86 L15 87 L9 62Z", "#e3ba76", ink, 1.5);
  return art + "</g>";
}

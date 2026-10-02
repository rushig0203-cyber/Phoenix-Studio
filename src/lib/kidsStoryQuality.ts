import { kidsVoicePlan } from "./kidsSpeechTiming";
import { kidsNarratedActions, reportsKiteFlight, reportsKiteResolution } from "./kidsObjectEvents";
import { z } from "zod";

export type KidsStoryIssue = { code: string; instruction: string; excerpt: string };
export type KidsStoryCheck = { ok: boolean; issues: KidsStoryIssue[]; limitation: string };

export function kidsStorySchema(names: [string, string]) {
  return z.object({ lines: z.array(z.object({ speaker: z.enum(["narrator", ...names]), text: z.string().trim().min(1).max(450) })).min(5).max(48) });
}
/** Automatic dialogue carries identities as data, rather than inferred stage verbs. */
export function structuredKidsStory(value: unknown, names: [string, string]) {
  const parsed = kidsStorySchema(names).parse(value);
  return parsed.lines.map(line => {
    if (/[“”"]/.test(line.text)) throw new Error("Dialogue text must not contain nested quotations.");
    const text = /[.!?]$/.test(line.text) ? line.text : `${line.text}.`;
    return line.speaker === "narrator" ? text : `${line.speaker} said, “${text}”`;
  }).join(" ");
}

// These checks are a small, conservative production contract, not an LLM judge
// or a claim to understand every possible story. Never apply them to owner text.
const unsupported = [
  { pattern: /\b(?:scissors?|paper\s*clips?|screwdrivers?|hammers?|ladders?|knives|knife|glue|tape|lassos?|sewing|needles?)\b/i, instruction: "Replace the tool-dependent solution with a supported action on the same object. This renderer cannot depict cutting, fastening or repairs with tools." },
  { pattern: /\b(?:snip(?:ped|ping|s)?|cut(?:ting)?\s+(?:the\s+)?(?:twine|string|ribbon)|repair(?:ed|ing|s)?|sew(?:ed|ing|s)?|stitch(?:ed|ing|es)?)\b/i, instruction: "Use a visible supported solution such as gently untangling a loop or taking turns holding. Do not invent a cutting or repair action that is not drawn." },
  { pattern: /\b(?:rainbow\s+trail|sparkles?\s+with|transforms?\s+into|teleports?|explodes?|shape[- ]shifts?)\b/i, instruction: "Keep the payoff physically visible with existing art, not a magical transformation or invented effect." },
] as const;

function sentences(value: string) { return value.match(/[^.!?]+(?:[.!?][”"]?|$)/g)?.map(part => part.trim()).filter(Boolean) || [value]; }
function visibleIssues(value: string): KidsStoryIssue[] {
  const issues: KidsStoryIssue[] = [];
  for (const rule of unsupported) {
    const clause = sentences(value).find(part => rule.pattern.test(part) && !/^(?:do not|never|avoid|no\b)/i.test(part));
    if (clause) issues.push({ code: "unsupported-action", instruction: rule.instruction, excerpt: clause.slice(0, 350) });
  }
  const clauses = sentences(kidsNarratedActions(value));
  let damagedKite = false, tangledKite = false;
  for (const clause of clauses) {
    const lower = kidsNarratedActions(clause).toLowerCase();
    if (/\b(?:kite|twine|string|ribbon)\b/.test(lower) && /\b(?:snaps?|snapped|broken|broke|cut|torn|ripped)\b/.test(lower)
      && !/\b(?:not|never|without)\b/.test(lower)) damagedKite = true;
    if (/\b(?:kite|twine|string|ribbon)\b/.test(lower) && /\b(?:tangled|snagged|knotted|caught|stuck)\b/.test(lower)) tangledKite = true;
    if (reportsKiteResolution(lower)) tangledKite = false;
    const flight = reportsKiteFlight(lower) || /\b(?:flying|soaring)\s+kite\b/.test(lower) && !/\b(?:want|wish|will|would|could|can|if|hope|not|never)\b/.test(lower);
    if (flight && (damagedKite || tangledKite)) issues.push({ code: "object-continuity", instruction: damagedKite
      ? "The kite or string was broken before flight. Avoid damaging it in this limited renderer; show a failed tug, then a visible untangling action before flight."
      : "The kite is still tangled. Show the friends actually untangling the same string before it flies; a proposal or attempt does not resolve the knot.", excerpt: clause.slice(0, 350) });
  }
  return issues;
}

export function checkKidsStory(script: string, castNames: [string, string]): KidsStoryCheck {
  const issues = visibleIssues(script);
  const plan = kidsVoicePlan(script, castNames);
  const quotes = [...script.matchAll(/[“"]([^”"]+)[”"]/g)];
  let quoteCursor = 0;
  for (const quote of quotes) {
    const index = plan.utterances.findIndex((part, index) => index >= quoteCursor && part.text === quote[1]);
    const utterance = plan.utterances[index];
    quoteCursor = index + 1;
    if (!utterance || utterance.speaker < 0) issues.push({ code: "dialogue-identity", instruction: `Put one exact speaker directly before this quote: ${castNames[0]} said, or ${castNames[1]} asked, etc. Use a speech verb, not smiles, nods, sighs or chirps. Do not add a third speaker.`, excerpt: quote[0].slice(0, 350) });
  }
  for (const [index, name] of castNames.entries()) {
    if (!plan.utterances.some(part => part.speaker === index)) issues.push({ code: "dialogue-balance", instruction: `Give ${name} at least one short, explicitly attributed line responding to the same problem.`, excerpt: "" });
  }
  return { ok: issues.length === 0, issues: issues.slice(0, 8), limitation: "Bounded renderer/dialogue continuity checks, not independent artistic or causal understanding. Final video review is still required." };
}

export function checkKidsOutline(plan: { audience: string; structure: string; opening: string; beats: Array<{ point: string; visual: string }>; payoff: string }): KidsStoryCheck {
  const issues = visibleIssues([plan.opening, ...plan.beats.flatMap(beat => [beat.point, beat.visual]), plan.payoff].join(". "));
  if (plan.structure !== "story") issues.push({ code: "story-structure", instruction: "Use story structure for this original children's animal story.", excerpt: plan.structure });
  if (!/\b3\s*(?:[-–—]|to)\s*6\b/i.test(plan.audience)) issues.push({ code: "story-audience", instruction: "Target children ages 3–6, the selected audience. Do not silently change the age range.", excerpt: plan.audience });
  return { ok: !issues.length, issues: issues.slice(0, 8), limitation: "Limited production-feasibility checks, not full artistic verification." };
}

export class KidsStoryQualityError extends Error {
  constructor(public issues: KidsStoryIssue[]) {
    super(issues.map(issue => issue.instruction).filter((item, index, all) => all.indexOf(item) === index).join(" "));
    this.name = "KidsStoryQualityError";
  }
}

export type KidsStoryAttempt = { version: 1; fingerprint: string; candidate: string; issues: KidsStoryIssue[]; repairAttempted: boolean };

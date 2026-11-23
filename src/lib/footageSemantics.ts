import { visualWords } from "./stockBrief";

const framingWords = new Set(["video", "stock", "clip", "footage", "view", "close", "closeup", "shot", "wide", "macro"]);
const natureActions = [
  { name: "pulsing", pattern: /^(?:puls(?:e|es|ed|ing)|contract(?:s|ed|ing|ion|ions)?)$/ },
  { name: "preening", pattern: /^(?:preen\w*|groom\w*)$/ },
  { name: "hovering", pattern: /^hover\w*$/ },
  { name: "feeding", pattern: /^(?:feed\w*|eat\w*|graz(?:e|es|ing|ed))$/ },
  { name: "climbing", pattern: /^climb\w*$/ },
  { name: "surfacing", pattern: /^surfac(?:e|es|ing|ed)$/ },
];

function evidenceWords(text: string) {
  return visualWords(text.replace(/\bjelly[ -]fish\b/gi, "jellyfish")).filter(word => !framingWords.has(word));
}

function wordForms(word: string) {
  const forms = [word];
  const action = natureActions.find(item => item.pattern.test(word));
  if (action) forms.push(action.name);
  if (word.length > 4 && word.endsWith("ies")) forms.push(word.slice(0, -3) + "y");
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) forms.push(word.slice(0, -1));
  if (word.length > 4 && /(?:ing|ed|es)$/.test(word)) {
    const stem = word.replace(/(?:ing|ed|es)$/, "");
    if (stem.length >= 3) forms.push(stem, stem + "e", stem.replace(/([a-z])\1$/, "$1"));
  }
  return forms;
}

/** Require positive subject/action vocabulary in descriptive metadata for new planned shots. */
export function hasFootageEvidence(description: string, requirement: string) {
  const required = evidenceWords(requirement);
  const supplied = new Set(evidenceWords(description).flatMap(wordForms));
  return required.length > 0 && required.every(word => wordForms(word).some(form => supplied.has(form)));
}

export function natureShotActionMismatch(narration: string, query: string) {
  const spoken = evidenceWords(narration);
  const requested = evidenceWords(query);
  const visibleActions = natureActions.filter(action => spoken.some(word => action.pattern.test(word)));
  if (visibleActions.length && !visibleActions.some(action => requested.some(word => action.pattern.test(word)))) return visibleActions[0].name;
}

/** Explicit action vocabulary only. These checks do not inspect video frames. */
const actions: Array<{ name: string; query: RegExp; evidence: RegExp }> = [
  { name: "writing", query: /writ|taking notes/i, evidence: /writ|not(?:e|ing)|jot|pen|paper|record|checklist/i },
  { name: "returning an object", query: /put\w*.*back|return\w*.*(?:container|shelf|place)/i, evidence: /put\w*.*back|replac|return|plac\w*.*(?:shelf|container)|stor(?:e|ing)/i },
  { name: "measuring ingredients", query: /measur\w*.*(?:ingredient|flour|sugar|water)/i, evidence: /measur|weigh|scale|measuring cup/i },
  { name: "mixing", query: /\b(?:mix|mixing|stir|stirring|whisk\w*)\b/i, evidence: /mix|stir|whisk|beat.*(?:bowl|ingredient)/i },
  { name: "kneading", query: /knead/i, evidence: /knead/i },
  { name: "dough rising", query: /(?:dough|bread).*ris(?:e|ing)|proofing/i, evidence: /ris(?:e|ing)|proof|ferment/i },
  { name: "oven heating", query: /preheat|oven.*heat/i, evidence: /preheat|heat.*oven|oven.*heat|temperature/i },
  { name: "oven baking", query: /oven|\bbaking\b(?!\s+(?:ingredient|sheet|flour|bowl))/i, evidence: /oven|bak(?:e|ed|ing)|heat|temperature/i },
  { name: "finished bread", query: /freshly baked|holding.*(?:bread|loaf)|(?:bread|loaf).*in.*hand/i, evidence: /fresh|baked|holding|hold.*(?:bread|loaf)|cool|finished|done/i },
  { name: "reading a recipe", query: /read\w*.*recipe|recipe.*(?:book|screen)/i, evidence: /recipe|cookbook|read/i },
];

const coffeeSteps = [
  { name: "measuring coffee", pattern: /\b(?:measur(?:e|es|ed|ing)|weigh(?:s|ed|ing)?|scales?)\b/i },
  { name: "grinding coffee", pattern: /\b(?:grind(?:s|ing|ers?)?|ground)\b/i },
  { name: "heating water", pattern: /\b(?:heat(?:s|ed|ing)?|boil(?:s|ed|ing)?|kettles?|temperatures?|thermometers?)\b/i },
];

export function actionMismatch(evidence: string, query: string) {
  // Shared topic words cannot excuse moving a named preparation step ahead.
  // Generic catalogue titles remain unknown rather than evidence of a wrong step.
  if (/\b(?:coffee|espresso|cappuccino|beans?|grinders?)\b/i.test(`${evidence} ${query}`) && coffeeSteps.some(step => step.pattern.test(evidence))) {
    const wrongStep = coffeeSteps.find(step => step.pattern.test(query) && !step.pattern.test(evidence));
    if (wrongStep) return wrongStep.name;
  }
  return actions.find(action => action.query.test(query) && !action.evidence.test(evidence))?.name;
}

export function footageMetadataMismatch(description: string, query: string) {
  // "Log repair steps" means keeping a record. Stock search can confuse the
  // verb with timber; a shared word must not admit chainsaw footage.
  const documentation = /\b(?:log(?:s|ged|ging)?|record(?:s|ed|ing)?|document(?:s|ed|ing)?|not(?:e|es|ing))\b[\s\S]*\b(?:repair|steps?|details?|progress|work|service|information)\b|\b(?:repair|service|work)\b[\s\S]*\b(?:log|record|documentation|notes?)\b/i.test(query);
  const timberCutting = /\b(?:chainsaws?|sawmills?|lumberjacks?|timber|firewood)\b|\b(?:cut(?:s|ting)?|chop(?:s|ping)?|saw(?:s|ing)?)\b[\s\S]*\b(?:wood|logs?|trees?|lumber)\b/i.test(description);
  if (documentation && timberCutting) return "timber cutting is not documenting work";
  // Reject explicit unrelated trades, while leaving vague catalog metadata
  // unknown. This does not claim a title proves the requested action happened.
  const repair = /\b(?:repair(?:s|ed|ing)?|fix(?:es|ed|ing)?|diagnos(?:e|es|ed|ing)|troubleshoot(?:s|ing)?)\b/i.test(query);
  const unrelatedTrade = /\b(?:haircuts?|hairdress(?:er|ing)|barbers?|manicures?|pedicures?|baking|kneading|chef|cooking)\b/i.test(description);
  const repairEvidence = /\b(?:repair(?:s|ed|ing)?|fix(?:es|ed|ing)?|mechanics?|technicians?|maintenance|service|diagnos(?:e|es|ed|ing)|troubleshoot(?:s|ing)?)\b/i.test(description);
  if (repair && unrelatedTrade && !repairEvidence) return "different trade from the requested repair";
  const missingPart = /\bmissing\b[\s\S]*\b(?:parts?|components?)\b/i.test(query);
  const shippingLabel = /\b(?:shipping|mailing|postage)\s+labels?\b/i.test(description);
  const partEvidence = /\b(?:missing|spare|replacement)\b[\s\S]*\b(?:parts?|components?)\b/i.test(description);
  if (missingPart && shippingLabel && !partEvidence) return "shipping labels do not show missing repair parts";
  const action = actionMismatch(description, query);
  if (action) return action;
  if (/\bsalt\b/i.test(query) && !/\bsalt\b/i.test(description)) return "salt missing";
  if (/\bsalt\b/i.test(query) && !/bath|spa|scrub|soap/i.test(query) && /bath|spa|scrub|soap/i.test(description)) return "bath products are not cooking salt";
  if (/\b(?:woman|women)\b/i.test(query) && /\b(?:man|men)\b/i.test(description) && !/\b(?:woman|women)\b/i.test(description)) return "different subject";
  if (/\b(?:man|men)\b/i.test(query) && /\b(?:woman|women)\b/i.test(description) && !/\b(?:man|men)\b/i.test(description)) return "different subject";
}

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

export function actionMismatch(evidence: string, query: string) {
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

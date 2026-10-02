/** Shared finite-event vocabulary for the story checker and lightweight renderer. */
export function kidsNarratedActions(words: string) { return words.replace(/[“"]([^”"]*)[”"]/g, ""); }
function reportedClauses(words: string) {
  return kidsNarratedActions(words).toLowerCase().split(/[.!?;]|,\s*(?:but|then)\s+|\bbut\b|\bthen\b/).filter(clause =>
    !/\b(?:want\w*|wish\w*|hope\w*|dream\w*|would|could|can|should|might|may|will|if|plan\w*|try|tries|tried|trying)\b|\bgoing to\b/.test(clause));
}
export function reportsKiteFlight(words: string) {
  return reportedClauses(words).some(clause => !/\b(?:not|never|didn't|doesn't|wasn't|isn't)\b/.test(clause) && (
    /\b(?:kite|it)\s+(?:(?:gently|smoothly|slowly|finally|now|suddenly|high)\s+)*(?:(?:is|was|began|started)\s+(?:to\s+)?)?(?:flies|flying|flew|soars?|soared|soaring|rose|rises|rising|glides?|glided|gliding|floats?|floated|floating|aloft)\b/.test(clause)
    || /\b(?:kite|it)\s+(?:(?:gently|smoothly|slowly|finally|now)\s+)*(?:lifted|lifts|lifting)\s+(?:up|above|into (?:the )?(?:air|sky)|off (?:the )?ground)\b/.test(clause)
    || /\b(?:watch(?:ed|es|ing)?|saw|see|sees|seeing)\s+(?:(?:the|their|our|my|a)\s+)?kite\s+(?:fly|soar|rise|float|glide)\b/.test(clause)
    || /\b(?:flies|flew)\s+(?:(?:the|their|our|my|a)\s+)?kite\b/.test(clause)));
}
export function reportsKiteResolution(words: string) {
  return reportedClauses(words).some(clause => !/\b(?:not|never|hadn't|hasn't|haven't|didn't|wasn't|weren't)\b/.test(clause) && (
    /no longer.*tangl|strings? (?:was |were |is |are )?straight/.test(clause)
    || /\b(?:untangles?|untangled|freed|unwinds?|unwound)\b|set.*free/.test(clause)
    || /\b(?:each|every|all)(?:\s+the)?\s+loops?\s+(?:came|come|comes|coming)\s+free\b/.test(clause)
    || /\bkite\s+(?:finally\s+)?(?:straightened|straightens|comes free|came free)\b/.test(clause)));
}

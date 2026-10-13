import type { DraftScene, FootageChoice } from "./creationDraftTypes";
import { searchFootage } from "./stockCatalog";
import { visualWords } from "./stockBrief";
import { footageMetadataMismatch } from "./footageSemantics";
import type { NewsResearch } from "./newsResearch";
import { newsFootageMetadataIssue, newsStockQueryIssue, newsVisualTerms } from "./newsVisualPolicy";

const generic = new Set(["person", "people", "woman", "women", "man", "men", "video", "young", "adult", "close", "shot"]);
const tokens = (value: string) => visualWords(value).filter(word => !generic.has(word)).map(word => word.replace(/(?:ing|es|s)$/, ""));
const footageTitle = (choice: FootageChoice) => new URL(choice.sourcePage).pathname.replace(/[-_/\d]+/g, " ").trim();

/** Metadata heuristics, not visual recognition. Never silently use an unrelated search. */
export function rankFootage(choices: FootageChoice[], query: string, minimumSeconds: number, aspect: "9:16" | "16:9", used: Set<number>, previous?: FootageChoice, research?: NewsResearch) {
  const wanted = research ? newsVisualTerms(query) : tokens(query);
  const target = aspect === "9:16" ? 9 / 16 : 16 / 9;
  return choices.flatMap((choice, index) => {
    if (used.has(choice.id) || choice.duration < minimumSeconds || Math.min(choice.width, choice.height) < 480) return [];
    const title = footageTitle(choice);
    const description = research ? newsVisualTerms(title) : tokens(title);
    if (research && newsFootageMetadataIssue(title, query, research)) return [];
    // A shared noun is insufficient: "bread" cannot justify footage of a
    // finished loaf while the requested shot is dough rising in a bowl.
    if (description.length && footageMetadataMismatch(title, query)) return [];
    const hits = wanted.filter(word => description.some(other => other === word || (word.length > 3 && other.startsWith(word))));
    // Some catalog pages have only an ID. Their search relevance is unknown,
    // not a pretend visual match; descriptive but off-topic results are rejected.
    if (description.length && wanted.length && !hits.length) return [];
    const composition = Math.min(target, choice.width / choice.height) / Math.max(target, choice.width / choice.height);
    const sameCreator = !!previous && previous.creator === choice.creator;
    const score = hits.length * 20 + composition * 10 + (sameCreator ? 8 : 0) - index * .5;
    return [{ choice, score, reason: `${hits.length ? `Catalog words match: ${hits.join(", ")}` : "Catalog has no descriptive title; selected from the requested search"}. Long enough for narration; ${sameCreator ? "same contributor preferred for continuity; " : ""}aspect fit ${Math.round(composition * 100)}%. Metadata checks only: watch the final video to judge the actual visuals.` }];
  }).sort((a, b) => b.score - a.score);
}

export async function selectAutomaticFootage(scenes: DraftScene[], duration: number, aspect: "9:16" | "16:9", onScene: (scenes: DraftScene[], stage: string) => Promise<unknown>, research?: NewsResearch,
  repairQueries?: (scenes: DraftScene[], failedIndex: number, catalogTitles: string[]) => Promise<string[]>) {
  const selected = scenes.map(scene => ({ ...scene }));
  let repairAttempted = false;
  const words = selected.reduce((sum, scene) => sum + scene.narration.split(/\s+/).length, 0);
  // Retain all saved choices on restart, including choices later in the plan.
  const used = new Set(selected.flatMap(scene => scene.footage ? [scene.footage.id] : []));
  for (let index = 0; index < selected.length; index++) {
    const scene = selected[index];
    const minimum = duration * scene.narration.split(/\s+/).length / words * 1.2 + 1;
    if (research && newsStockQueryIssue(scene.query, research)) throw new Error(`News section ${index + 1}: ${newsStockQueryIssue(scene.query, research)}. Saved work is retained; create a new visual plan.`);
    if (scene.footage) {
      if (research && !rankFootage([scene.footage], scene.query, minimum, aspect, new Set(), undefined, research).length) throw new Error(`News section ${index + 1}: saved footage does not support this neutral contextual shot. No approved asset was silently replaced; create a new visual plan.`);
      continue;
    }
    await onScene(selected, `Selecting footage ${index + 1}/${selected.length}: ${scene.query}`);
    const catalogTitles = new Set<string>();
    const search = async () => {
      const rank = (choices: FootageChoice[]) => {
        for (const choice of choices) if (!used.has(choice.id) && choice.duration >= minimum && Math.min(choice.width, choice.height) >= 480 && catalogTitles.size < 18) {
          const title = footageTitle(choice).slice(0, 160);
          if (title) catalogTitles.add(title);
        }
        return rankFootage(choices, scene.query, minimum, aspect, used, selected[index - 1]?.footage, research)[0];
      };
      let best = rank(await searchFootage(scene.query, aspect));
      // Keep subject and quality checks, but consider more than eight portraits.
      for (let page = 1; !best && page <= 2; page++) {
        await onScene(selected, `Searching more footage ${index + 1}/${selected.length} · catalogue page ${page}`);
        best = rank(await searchFootage(scene.query, aspect, true, page, 30));
      }
      return best;
    };
    let best = await search();
    if (!best && repairQueries && !repairAttempted) {
      repairAttempted = true;
      await onScene(selected, `Correcting unavailable visual searches ${index + 1}/${selected.length} — narration and selected clips retained`);
      const queries = await repairQueries(selected, index, [...catalogTitles]);
      if (!Array.isArray(queries) || queries.length !== selected.length || queries.some((query, at) => typeof query !== "string" || query.trim().length < 3 || query.length > 80 || (selected[at].footage && query !== selected[at].query)) || queries[index].replace(/\s+/g, " ").trim().toLowerCase() === scene.query.replace(/\s+/g, " ").trim().toLowerCase()) {
        throw new Error(`Section ${index + 1}: visual search correction was invalid. Narration and selected footage were retained.`);
      }
      for (const [at, current] of selected.entries()) if (!current.footage) current.query = queries[at].trim();
      // Save the replacement searches before using them, so explicit retry
      // does not endlessly replay the rejected generated plan.
      await onScene(selected, "Corrected visual searches saved — checking exact footage");
      best = await search();
    }
    if (!best) throw new Error(`Section ${index + 1}: no distinct, suitable footage of at least ${Math.ceil(minimum)} seconds for “${scene.query}” after an expanded search. Retry later. No unrelated filler or paid fallback was used.`);
    scene.footage = best.choice;
    scene.footageReason = best.reason;
    used.add(best.choice.id);
    await onScene(selected, `Selected footage ${index + 1}/${selected.length}`);
  }
  return selected;
}

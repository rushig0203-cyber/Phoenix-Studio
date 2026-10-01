import type { DraftScene, FootageChoice } from "./creationDraftTypes";
import { searchFootage } from "./stockCatalog";
import { visualWords } from "./stockBrief";
import { footageMetadataMismatch } from "./footageSemantics";

const generic = new Set(["person", "people", "woman", "women", "man", "men", "video", "young", "adult", "close", "shot"]);
const tokens = (value: string) => visualWords(value).filter(word => !generic.has(word)).map(word => word.replace(/(?:ing|es|s)$/, ""));

/** Metadata heuristics, not visual recognition. Never silently use an unrelated search. */
export function rankFootage(choices: FootageChoice[], query: string, minimumSeconds: number, aspect: "9:16" | "16:9", used: Set<number>, previous?: FootageChoice) {
  const wanted = tokens(query);
  const target = aspect === "9:16" ? 9 / 16 : 16 / 9;
  return choices.flatMap((choice, index) => {
    if (used.has(choice.id) || choice.duration < minimumSeconds || Math.min(choice.width, choice.height) < 480) return [];
    const title = new URL(choice.sourcePage).pathname.replace(/[-_/\d]+/g, " ");
    const description = tokens(title);
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

export async function selectAutomaticFootage(scenes: DraftScene[], duration: number, aspect: "9:16" | "16:9", onScene: (scenes: DraftScene[], stage: string) => Promise<unknown>) {
  const selected = scenes.map(scene => ({ ...scene }));
  const words = selected.reduce((sum, scene) => sum + scene.narration.split(/\s+/).length, 0);
  // Retain all saved choices on restart, including choices later in the plan.
  const used = new Set(selected.flatMap(scene => scene.footage ? [scene.footage.id] : []));
  for (let index = 0; index < selected.length; index++) {
    const scene = selected[index];
    if (scene.footage) continue;
    await onScene(selected, `Selecting footage ${index + 1}/${selected.length}: ${scene.query}`);
    const minimum = duration * scene.narration.split(/\s+/).length / words * 1.2 + 1;
    const choices = await searchFootage(scene.query, aspect);
    let best = rankFootage(choices, scene.query, minimum, aspect, used, selected[index - 1]?.footage)[0];
    // Keep the same subject/query and quality checks, but don't fail after only
    // eight portrait results. Landscape clips can still be used by the renderer.
    for (let page = 1; !best && page <= 2; page++) {
      await onScene(selected, `Searching more footage ${index + 1}/${selected.length} · catalogue page ${page}`);
      const expanded = await searchFootage(scene.query, aspect, true, page, 30);
      best = rankFootage(expanded, scene.query, minimum, aspect, used, selected[index - 1]?.footage)[0];
    }
    if (!best) throw new Error(`Section ${index + 1}: no distinct, suitable footage of at least ${Math.ceil(minimum)} seconds for “${scene.query}” after an expanded search. Retry later. No unrelated filler or paid fallback was used.`);
    scene.footage = best.choice;
    scene.footageReason = best.reason;
    used.add(best.choice.id);
    await onScene(selected, `Selected footage ${index + 1}/${selected.length}`);
  }
  return selected;
}

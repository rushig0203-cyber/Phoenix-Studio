import { createStockScript, type GenerationInput } from "./generation";
import { createStockStoryboard } from "./stockStoryboard";
import { selectAutomaticFootage } from "./automaticFootage";
import type { DraftScene } from "./creationDraftTypes";
import { selectedFootage } from "./stockCatalog";
import { withWritingSession } from "./writingModel";

export type StockPreparation = { version: 1; scenes: DraftScene[] };
type Checkpoint = (input: GenerationInput, scenes: DraftScene[], stage: string) => Promise<unknown>;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Shared by normal creation and the generation/retry/regeneration entry point.
 * Persist each completed step before moving on; renderer never fills missing IDs.
 */
export async function prepareStockCreation(original: GenerationInput, savedScenes: DraftScene[] = [], checkpoint: Checkpoint = async () => {}, selectFootage = true) {
  let input = { ...original };
  let scenes = savedScenes.map(scene => ({ ...scene }));
  const save = async (current: DraftScene[], stage: string) => {
    scenes = current.map(scene => ({ ...scene }));
    input = { ...input, stockPreparation: { version: 1, scenes } };
    await checkpoint(input, scenes, stage);
  };
  // Keep writing stages together, then release any local runner before footage
  // download or renderer allocation. A fully cached plan never loads a model.
  await withWritingSession(async () => {
    const scriptOrigin = input.scriptOrigin || (input.script?.trim() ? "owner" : "local-model");
    const script = await createStockScript(input, stage => checkpoint(input, scenes, stage));
    if (normalize(scenes.map(scene => scene.narration).join(" ")) !== normalize(script)) scenes = [];
    input = { ...input, script, scriptOrigin };
    // The saved script/editorial verdict survives an interrupted shot-list call.
    await checkpoint(input, scenes, "Narration saved — planning the matching visual sequence");
    if (!scenes.length) scenes = await createStockStoryboard(input as GenerationInput & { script: string });
    await save(scenes, "Shot plan saved — checking exact footage");
  });
  // Older approved jobs contain exact asset IDs but not the newer scene cache.
  // Resolve those IDs, never treat an approved shot as permission to search again.
  if (selectFootage) for (let index = 0; index < scenes.length; index++) {
    const beat = input.storyboard?.[index];
    if (!beat?.assetId || beat.narration !== scenes[index].narration || beat.query !== scenes[index].query || scenes[index].footage?.id === beat.assetId) continue;
    scenes[index].footage = await selectedFootage(beat.assetId);
    scenes[index].footageReason = "Exact previously selected asset retained; no replacement search.";
    await save(scenes, `Restored selected footage ${index + 1}/${scenes.length}`);
  }
  if (selectFootage) await selectAutomaticFootage(scenes, input.duration, input.aspect, save);
  if (selectFootage && scenes.some(scene => !scene.footage)) throw new Error("The footage plan is incomplete. No backend search fallback was allowed.");
  input = { ...input, storyboard: scenes.map(scene => ({ narration: scene.narration, query: scene.query, assetId: scene.footage?.id })), stockPreparation: { version: 1, scenes } };
  await checkpoint(input, scenes, selectFootage ? "Exact footage saved — ready for rendering" : "Visual sequence saved");
  return { input, scenes };
}

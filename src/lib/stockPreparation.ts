import { createStockScript, type GenerationInput } from "./generation";
import { createStockStoryboard, repairUnavailableStockQueries, stockQueryMismatch } from "./stockStoryboard";
import { selectAutomaticFootage } from "./automaticFootage";
import type { DraftScene } from "./creationDraftTypes";
import { selectedFootage } from "./stockCatalog";
import { withWritingSession } from "./writingModel";
import { hasFootageEvidence, stockNatureSubject } from "./footageSemantics";
import { NEWS_MIXED_VISUAL_POLICY, newsIllustrationQuery, newsStockQueryIssue, readNewsIllustration } from "./newsVisualPolicy";

export type StockPreparation = { version: 1; scenes: DraftScene[]; repairUsed?: true };
type Checkpoint = (input: GenerationInput, scenes: DraftScene[], stage: string) => Promise<unknown>;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Shared by normal creation and the generation/retry/regeneration entry point.
 * Persist each completed step before moving on; renderer never fills missing IDs.
 */
export async function prepareStockCreation(original: GenerationInput, savedScenes: DraftScene[] = [], checkpoint: Checkpoint = async () => {}, selectFootage = true) {
  let input = { ...original };
  let scenes = savedScenes.map(scene => ({ ...scene }));
  const subject = stockNatureSubject(input);
  const evidence = !input.research && (input.narrationPresentation === "measured-speech-v1" || subject)
    ? { subject } : undefined;
  let repairUsed = input.stockPreparation?.repairUsed;
  const save = async (current: DraftScene[], stage: string) => {
    scenes = current.map(scene => ({ ...scene }));
    input = { ...input, stockPreparation: { version: 1, scenes, ...(repairUsed ? { repairUsed } : {}) } };
    await checkpoint(input, scenes, stage);
  };
  // Keep writing stages together, then release any local runner before footage
  // download or renderer allocation. A fully cached plan never loads a model.
  await withWritingSession(async () => {
    const scriptOrigin = input.scriptOrigin || (input.script?.trim() ? "owner" : "local-model");
    const script = await createStockScript(input, stage => checkpoint(input, scenes, stage));
    if (normalize(scenes.map(scene => scene.narration).join(" ")) !== normalize(script)) {
      scenes = [];
      repairUsed = undefined;
    }
    input = { ...input, script, scriptOrigin };
    // The saved script/editorial verdict survives an interrupted shot-list call.
    await checkpoint(input, scenes, "Narration saved — planning the matching visual sequence");
    if (subject && scriptOrigin === "local-model" && !hasFootageEvidence(script, subject)) {
      throw new Error(`The generated narration does not name its ${subject} subject. Saved narration is retained for correction; no unrelated footage was selected.`);
    }
    if (!scenes.length) scenes = await createStockStoryboard(input as GenerationInput & { script: string });
    if (input.research) {
      const unsafe = scenes.findIndex(scene => scene.illustration
        ? input.newsVisualPolicy !== NEWS_MIXED_VISUAL_POLICY || scene.footage || !readNewsIllustration(scene.illustration) || scene.query !== newsIllustrationQuery(scene.illustration)
        : newsStockQueryIssue(scene.query, input.research));
      if (unsafe >= 0) throw new Error(`News section ${unsafe + 1}: ${newsStockQueryIssue(scenes[unsafe].query, input.research)}. The saved narration is retained; create a new visual plan instead of rendering this legacy shot.`);
    } else if (input.visualTermsOrigin === "local-model" || evidence && input.visualTermsOrigin !== "owner") {
      const unsafe = scenes.findIndex(scene => stockQueryMismatch(scene.narration, scene.query, evidence?.subject));
      if (unsafe >= 0) throw new Error(`Saved section ${unsafe + 1} has footage for a different narrated action. Create a fresh visual plan; selected assets and saved narration were not replaced.`);
    }
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
  if (selectFootage) {
    const canRepairQueries = input.scriptOrigin === "local-model" && !input.scriptApproved && !repairUsed
      && !input.visualTerms?.length && !input.storyboard?.some(beat => beat.assetId);
    await selectAutomaticFootage(scenes, input.duration, input.aspect, save, input.research,
      canRepairQueries && input.newsVisualPolicy !== NEWS_MIXED_VISUAL_POLICY ? async (current, failedIndex, titles) => {
        const queries = await repairUnavailableStockQueries(input, current, failedIndex, titles);
        if (evidence) repairUsed = true;
        return queries;
      } : undefined, input.newsVisualPolicy, evidence);
  }
  if (selectFootage && scenes.some(scene => !scene.footage && !scene.illustration)) throw new Error("The footage plan is incomplete. No backend search fallback was allowed.");
  input = { ...input, storyboard: scenes.map(scene => ({ narration: scene.narration, query: scene.query, ...(scene.illustration ? { illustration: { ...scene.illustration } } : { assetId: scene.footage?.id }) })), stockPreparation: { version: 1, scenes, ...(repairUsed ? { repairUsed } : {}) } };
  await checkpoint(input, scenes, selectFootage ? "Exact footage saved — ready for rendering" : "Visual sequence saved");
  return { input, scenes };
}

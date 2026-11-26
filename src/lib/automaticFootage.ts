import type { DraftScene, FootageChoice } from "./creationDraftTypes";
import { searchFootage } from "./stockCatalog";
import { visualWords } from "./stockBrief";
import { footageMetadataMismatch, hasFootageEvidence, natureDepictionMismatch, natureNarratedQuery, natureShotActionMismatch, natureVisibleAction } from "./footageSemantics";
import { readNarratedStill, searchNarratedStills, type NarratedStill } from "./openStockCatalog";
import type { NewsResearch } from "./newsResearch";
import { NEWS_MIXED_VISUAL_POLICY, newsContextSearches, newsEditorialIllustration, newsIllustrationQuery, newsFootageMetadataIssue, newsStockQueryIssue, newsVisualTerms, readNewsIllustration, type NewsVisualPolicy } from "./newsVisualPolicy";

const generic = new Set(["person", "people", "woman", "women", "man", "men", "video", "young", "adult", "close", "shot"]);
const tokens = (value: string) => visualWords(value).filter(word => !generic.has(word)).map(word => word.replace(/(?:ing|es|s)$/, ""));
const footageTitle = (choice: FootageChoice) => new URL(choice.sourcePage).pathname.replace(/[-_/\d]+/g, " ").trim();

/** Metadata heuristics, not visual recognition. Never silently use an unrelated search. */
type ShotEvidence = { subject?: string; allowAdjacentMerge?: boolean; allowStill?: boolean };

function photoSearchTerm(query: string, subject?: string) {
  // Preening already names a feather action; catalogue photo titles often omit "feathers".
  return subject === "duck" && /^duck preening feathers$/i.test(query) ? "duck preening" : query;
}

function stillMatches(still: NarratedStill, query: string, subject?: string) {
  const name = decodeURIComponent(new URL(still.sourcePage).pathname.slice("/wiki/File:".length)).replace(/_/g, " ");
  const metadata = `${still.title} ${name}`;
  const title = subject === "duck" ? metadata.replace(/\bmallards?\b/i, "$& duck") : metadata;
  return hasFootageEvidence(title, photoSearchTerm(query, subject)) && !footageMetadataMismatch(title, query)
    && !/\b(?:illustration|diagram|drawing|painting|rendering|animation|artwork|poster|model|AI-generated)\b/i.test(still.title)
    && (!subject || hasFootageEvidence(title, subject) && !natureDepictionMismatch(title, subject));
}

export function rankFootage(choices: FootageChoice[], query: string, minimumSeconds: number, aspect: "9:16" | "16:9", used: Set<number>, previous?: FootageChoice, research?: NewsResearch, evidence?: ShotEvidence) {
  const wanted = research ? newsVisualTerms(query) : tokens(query);
  const target = aspect === "9:16" ? 9 / 16 : 16 / 9;
  return choices.flatMap((choice, index) => {
    if (used.has(choice.id) || choice.duration < minimumSeconds || Math.min(choice.width, choice.height) < 480) return [];
    const title = footageTitle(choice);
    const description = research ? newsVisualTerms(title) : tokens(title);
    if (research && newsFootageMetadataIssue(title, query, research)) return [];
    if (evidence && (!hasFootageEvidence(title, query) || evidence.subject && !hasFootageEvidence(title, evidence.subject))) return [];
    if (evidence?.subject && natureDepictionMismatch(title, evidence.subject)) return [];
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
  repairQueries?: (scenes: DraftScene[], failedIndex: number, catalogTitles: string[]) => Promise<string[]>, newsPolicy?: NewsVisualPolicy, evidence?: ShotEvidence) {
  const selected = scenes.map(scene => ({ ...scene }));
  let repairAttempted = false;
  const words = selected.reduce((sum, scene) => sum + scene.narration.split(/\s+/).length, 0);
  const speechBudget = evidence?.allowStill ? Math.max(duration, Math.ceil(words / 2.2)) : duration;
  // Retain all saved choices on restart, including choices later in the plan.
  const used = new Set(selected.flatMap(scene => scene.footage ? [scene.footage.id] : []));
  const photosUsed = new Set(selected.flatMap(scene => scene.still ? [scene.still.id] : []));
  let footageUnavailable: Error | undefined;
  const readFootage = async (...args: Parameters<typeof searchFootage>) => {
    if (footageUnavailable) return [];
    try { return await searchFootage(...args); }
    catch (error) {
      footageUnavailable = error instanceof Error ? error : new Error("Pexels footage could not be checked.");
      return [];
    }
  };
  for (let index = 0; index < selected.length; index++) {
    const scene = selected[index];
    if (scene.still) {
      const still = readNarratedStill(scene.still);
      if (research || scene.footage || scene.illustration || !still || !stillMatches(still, scene.query, evidence?.subject)) {
        throw new Error(`Scene ${index + 1}: the saved reference photo could not be verified. Your draft is retained.`);
      }
      continue;
    }
    if (scene.illustration) {
      if (!research || newsPolicy !== NEWS_MIXED_VISUAL_POLICY || scene.footage || !readNewsIllustration(scene.illustration) || scene.query !== newsIllustrationQuery(scene.illustration)) throw new Error(`Section ${index + 1}: invalid saved editorial illustration. The saved plan was retained.`);
      continue;
    }
    const minimum = speechBudget * scene.narration.split(/\s+/).length / words * 1.2 + 1;
    if (research && newsStockQueryIssue(scene.query, research)) throw new Error(`News section ${index + 1}: ${newsStockQueryIssue(scene.query, research)}. Saved work is retained; create a new visual plan.`);
    if (scene.footage) {
      if (research && !rankFootage([scene.footage], scene.query, minimum, aspect, new Set(), undefined, research).length) throw new Error(`News section ${index + 1}: saved footage does not support this neutral contextual shot. No approved asset was silently replaced; create a new visual plan.`);
      if (evidence && !rankFootage([scene.footage], scene.query, minimum, aspect, new Set(), undefined, undefined, evidence).length) {
        throw new Error(`Scene ${index + 1} · ${scene.query}: saved footage does not support this shot. The narration and selected clip were retained.`);
      }
      continue;
    }
    const previous = selected[index - 1];
    const subject = evidence?.subject;
    const action = subject && natureVisibleAction(scene.query, subject);
    if (!research && evidence?.allowAdjacentMerge && subject && action && previous?.footage
      && natureVisibleAction(previous.query, subject) === action
      && !natureShotActionMismatch(scene.narration, previous.query, subject)) {
      const combined = `${previous.narration} ${scene.narration}`;
      const combinedMinimum = speechBudget * combined.split(/\s+/).length / words * 1.2 + 1;
      // One continuous approved source, never a replay; actual measured speech
      // is still checked against downloaded native-speed frames by the renderer.
      if (rankFootage([previous.footage], scene.query, combinedMinimum, aspect, new Set(), undefined, undefined, evidence).length
        && rankFootage([previous.footage], previous.query, combinedMinimum, aspect, new Set(), undefined, undefined, evidence).length) {
        previous.narration = combined;
        previous.footageReason = `Continuous ${subject} ${action} shot for adjacent explanations; catalogue duration covers ${combinedMinimum.toFixed(1)}s including the speech-timing margin. No replay or slowdown. Metadata checks only; review the visible action.`;
        selected.splice(index, 1);
        await onScene(selected, `Joined continuing ${subject} ${action} explanation — selected footage retained`);
        index--;
        continue;
      }
    }
    await onScene(selected, `Selecting footage ${index + 1}/${selected.length}: ${scene.query}`);
    const catalogTitles = new Set<string>();
    const search = async () => {
      const rank = (choices: FootageChoice[]) => {
        for (const choice of choices) if (!used.has(choice.id) && choice.duration >= minimum && Math.min(choice.width, choice.height) >= 480 && catalogTitles.size < 18) {
          const title = footageTitle(choice).slice(0, 160);
          if (title) catalogTitles.add(title);
        }
        return rankFootage(choices, scene.query, minimum, aspect, used, selected[index - 1]?.footage, research, evidence)[0];
      };
      let best = rank(await readFootage(scene.query, aspect));
      // Keep subject and quality checks, but consider more than eight portraits.
      for (let page = 1; !best && !footageUnavailable && page <= 2; page++) {
        await onScene(selected, `Searching more footage ${index + 1}/${selected.length} · catalogue page ${page}`);
        best = rank(await readFootage(scene.query, aspect, true, page, 30));
      }
      return best;
    };
    let best = await search();
    if (!best && research && !footageUnavailable && (repairQueries || newsPolicy === NEWS_MIXED_VISUAL_POLICY)) {
      const alternatives = newsContextSearches(research, scene.narration).filter(query => query !== scene.query.toLowerCase()).slice(0, 2);
      for (const query of alternatives) {
        await onScene(selected, `Checking report context ${index + 1}/${selected.length}: ${query}`);
        best = rankFootage(await readFootage(query, aspect, true, 1, 30), query, minimum, aspect, used, selected[index - 1]?.footage, research)[0];
        if (best) {
          scene.query = query;
          break;
        }
      }
    }
    if (!best && research && newsPolicy === NEWS_MIXED_VISUAL_POLICY) {
      scene.illustration = newsEditorialIllustration(research, scene.narration);
      scene.query = newsIllustrationQuery(scene.illustration);
      scene.footageReason = "No eligible licensed stock matched after bounded contextual searches. Original neutral 2D objects will be rendered with an Illustration label.";
      await onScene(selected, `Editorial illustration saved ${index + 1}/${selected.length}`);
      continue;
    }
    const alternate = !research && evidence?.allowStill && subject ? natureNarratedQuery(scene.narration, subject) : undefined;
    if (!best && !footageUnavailable && alternate && alternate.toLowerCase() !== scene.query.toLowerCase()) {
      await onScene(selected, `Checking another matching shot ${index + 1}/${selected.length}: ${alternate}`);
      best = rankFootage(await readFootage(alternate, aspect, true, 1, 30), alternate, minimum, aspect, used, previous?.footage, undefined, evidence)[0];
      if (best) scene.query = alternate;
    }
    let repairFailure: unknown;
    if (!best && !footageUnavailable && repairQueries && !repairAttempted) {
      repairAttempted = true;
      await onScene(selected, `Correcting unavailable visual searches ${index + 1}/${selected.length} — narration and selected clips retained`);
      let queries: string[] | undefined;
      try {
        queries = await repairQueries(selected, index, [...catalogTitles]);
        if (!Array.isArray(queries) || queries.length !== selected.length || queries.some((query, at) => typeof query !== "string" || query.trim().length < 3 || query.length > 80 || ((selected[at].footage || selected[at].still || selected[at].illustration) && query !== selected[at].query)) || queries[index].replace(/\s+/g, " ").trim().toLowerCase() === scene.query.replace(/\s+/g, " ").trim().toLowerCase()) {
          throw new Error(`Section ${index + 1}: visual search correction was invalid. Narration and selected footage were retained.`);
        }
      } catch (error) { repairFailure = error; queries = undefined; }
      if (queries) {
        for (const [at, current] of selected.entries()) if (!current.footage && !current.still && !current.illustration) current.query = queries[at].trim();
        // Save the replacement searches before retrying them.
        await onScene(selected, "Corrected visual searches saved — checking exact footage");
        best = await search();
      }
    }
    let photoUnavailable = false;
    if (!best && !research && evidence?.allowStill) {
      const queries = [...new Set([scene.query, ...(alternate ? [alternate] : [])].map(query => photoSearchTerm(query, subject)))];
      for (const query of queries) {
        await onScene(selected, `Checking licensed reference photos ${index + 1}/${selected.length}: ${query}`);
        let choices: NarratedStill[];
        try { choices = await searchNarratedStills(query); } catch { photoUnavailable = true; break; }
        const still = choices.map(readNarratedStill).find(photo => photo && !photosUsed.has(photo.id) && stillMatches(photo, query, subject));
        if (!still) continue;
        scene.query = query;
        scene.still = still;
        scene.footageReason = "Matching Wikimedia Commons reference photo selected after video search. Labelled on screen as a photo.";
        photosUsed.add(still.id);
        await onScene(selected, `Selected reference photo ${index + 1}/${selected.length}`);
        break;
      }
      if (scene.still) continue;
    }
    if (!best && repairFailure) throw repairFailure;
    if (!best && footageUnavailable) throw new Error(`Scene ${index + 1} · ${scene.query}: ${footageUnavailable.message}${evidence?.allowStill ? photoUnavailable ? " The reference-photo catalogue could not be reached either." : " No licensed matching reference photo was found." : ""} Your draft is saved.`);
    if (!best && evidence?.allowStill) throw new Error(`Scene ${index + 1} · ${scene.query}: no matching clip covers the narration${photoUnavailable ? "; the reference-photo catalogue could not be checked" : ", and no matching licensed reference photo was found"}. Your draft and selected visuals are saved.`);
    if (!best && evidence) throw new Error(`Scene ${index + 1} · ${scene.query}: no distinct clip supported the planned subject and action for ${Math.ceil(minimum)} seconds. Your draft and any selected clips are saved.`);
    if (!best) throw new Error(`Section ${index + 1}: no distinct, suitable footage of at least ${Math.ceil(minimum)} seconds for “${scene.query}” after an expanded search. Retry later. No unrelated filler or paid fallback was used.`);
    scene.footage = best.choice;
    scene.footageReason = best.reason;
    used.add(best.choice.id);
    await onScene(selected, `Selected footage ${index + 1}/${selected.length}`);
  }
  return selected;
}

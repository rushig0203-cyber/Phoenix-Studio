import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { reviewRoot } from "./reviewFiles";
import { writeAtomicJson } from "./atomicJson";
import { withFileLock } from "./fileLock";
import { HeavyWorkWaitError, heavyWorkStatus, tryWithLocalRenderSlot } from "./renderResources";
import { createGenerationJobs, type GenerationInput } from "./generation";
import { createContent, type KidsRenderInput } from "./kidsRenderer";
import { getCreativeGuidance } from "./qualityManager";
import { narrationBeats } from "./stockStoryboard";
import { stockNarrationError } from "./stockBrief";
import { requireSongAudio } from "./songAudio";
import { selectedFootage } from "./stockCatalog";
import { prepareLocalSong } from "./localSinging";
import { prepareStockCreation } from "./stockPreparation";
import type { CreationDraft, DraftScene } from "./creationDraftTypes";
import { isWritingWaitError, withWritingSession, writingModelIdentity } from "./writingModel";

const storeFile = () => path.join(reviewRoot(), "creation-drafts.json");
const leaseOwner = `${process.pid}-${crypto.randomUUID()}`;
const leaseMs = 180_000;
export class DraftConflict extends Error {}
export const isStockDraft = (draft: CreationDraft) => !["children-story", "children-song"].includes(draft.input.creationType || "");

export async function listCreationDrafts(): Promise<CreationDraft[]> {
  try {
    const drafts = JSON.parse(await fs.readFile(storeFile(), "utf8"));
    if (!Array.isArray(drafts)) throw new Error("The draft store is invalid. Restore it from backup; it was not overwritten.");
    return drafts;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function mutate<T>(fn: (drafts: CreationDraft[]) => T | Promise<T>) {
  await fs.mkdir(reviewRoot(), { recursive: true });
  return withFileLock(`${storeFile()}.lock`, async () => {
    const drafts = await listCreationDrafts();
    const result = await fn(drafts);
    await writeAtomicJson(storeFile(), drafts);
    return result;
  });
}

export async function createCreationDrafts(inputs: GenerationInput[]) {
  return mutate(drafts => inputs.map((input, index) => {
    input = { ...input, reviewMode: input.reviewMode || "final" };
    const requestKey = `${input.requestId || crypto.randomUUID()}:${index}`;
    const existing = drafts.find(d => d.requestKey === requestKey);
    if (existing) {
      if (existing.status === "ARCHIVED") throw new DraftConflict("This draft was removed. Start a new creation.");
      return existing;
    }
    const now = new Date().toISOString();
    const draft: CreationDraft = { id: crypto.randomUUID(), requestKey, version: 1, status: "QUEUED", stage: input.reviewMode === "final" ? "Queued — automatic planning, then rendering; review only the finished video" : "Queued for story planning only — no video render", input, scenes: [], createdAt: now, updatedAt: now };
    drafts.push(draft);
    return draft;
  }));
}

/** Resume legacy approval gates once at startup; do not endlessly restart failed final-mode jobs. */
export async function enableAutomaticCreation() {
  return mutate(drafts => {
    let resumed = 0;
    for (const draft of drafts) {
      if (!["READY", "QUEUED", "FAILED"].includes(draft.status)) continue;
      if (draft.input.reviewMode === "final" && draft.status !== "READY") continue;
      draft.input.reviewMode = "final";
      draft.status = "QUEUED";
      draft.stage = "Queued — continuing automatically; review the finished video";
      draft.error = undefined;
      draft.version++; draft.updatedAt = new Date().toISOString(); resumed++;
    }
    return resumed;
  });
}

function requireEditable(draft: CreationDraft | undefined, version: number) {
  if (!draft) throw new DraftConflict("Draft not found.");
  if (draft.version !== version) throw new DraftConflict("This draft changed. Reload it before saving or approving.");
  if (!["READY", "FAILED"].includes(draft.status)) throw new DraftConflict("Wait for planning to finish. Approved drafts cannot be changed.");
  return draft;
}

export function validateDraftScenes(draft: CreationDraft, scenes: DraftScene[], approval = false) {
  if (!scenes.length || scenes.length > 18 || scenes.some(s => !s.narration.trim() || s.narration.length > 4000)) throw new Error("Keep 1–18 sections with non-empty narration.");
  const script = scenes.map(s => s.narration.trim()).join(" ");
  if (script.length > 20000) throw new Error("The draft is too long.");
  if (isStockDraft(draft)) {
    const error = stockNarrationError(script, draft.input.duration);
    if (error) throw new Error(error);
    if (scenes.some(s => s.query.trim().length < 2 || s.query.length > 80)) throw new Error("Each stock section needs a short visual search.");
    if (approval) {
      if (scenes.some(s => !s.footage)) throw new Error("Choose and preview footage for every section before approving.");
      if (new Set(scenes.map(s => s.footage!.id)).size !== scenes.length) throw new Error("Choose a different footage asset for each section to avoid repeating the same shot.");
      const words = script.split(/\s+/).length;
      for (const [index, scene] of scenes.entries()) {
        const estimated = draft.input.duration * scene.narration.trim().split(/\s+/).length / words;
        if (scene.footage!.duration < estimated * 1.2 + 1) throw new Error(`Section ${index + 1} needs footage at least ${Math.ceil(estimated * 1.2 + 1)} seconds long, including a speech-timing margin. Choose a longer clip or shorten that section.`);
      }
    }
  } else if (draft.input.creationType !== "children-song") {
    const words = script.split(/\s+/).length;
    if (words < draft.input.duration * 0.8 || words > draft.input.duration * 2.8) throw new Error("Use roughly 1–2.5 words per second for a clear children's story.");
    if (!/[.!?]["'”’)]*$/.test(script)) throw new Error("Finish the story with a complete sentence.");
  }
  if (draft.input.creationType === "children-song" && draft.input.songAudioId && script !== draft.input.script?.trim().replace(/\s+/g, " ")) throw new Error("Lyrics must still match the saved song. Start a new song draft to change the recording or lyrics.");
  return script;
}

export async function saveCreationDraft(id: string, version: number, scenes: DraftScene[]) {
  return mutate(drafts => {
    const draft = requireEditable(drafts.find(d => d.id === id), version);
    validateDraftScenes(draft, scenes);
    // Asset metadata comes only from a server-resolved selection, never from this edit payload.
    draft.scenes = scenes.map((scene, index) => ({ narration: scene.narration.replace(/\s+/g, " ").trim(), query: scene.query.trim(), footage: draft.scenes[index]?.query === scene.query.trim() ? draft.scenes[index]?.footage : undefined }));
    draft.version++;
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

export async function chooseDraftFootage(id: string, version: number, index: number, assetId: number) {
  const choice = await selectedFootage(assetId);
  return mutate(drafts => {
    const draft = requireEditable(drafts.find(d => d.id === id), version);
    if (!isStockDraft(draft) || !draft.scenes[index]) throw new Error("This section does not accept stock footage.");
    draft.scenes[index].footage = choice;
    draft.version++;
    draft.updatedAt = new Date().toISOString();
    return draft;
  });
}

async function dispatchApproved(draft: CreationDraft) {
  const script = draft.input.creationType === "children-song" ? draft.input.script! : draft.scenes.map(s => s.narration.trim()).join(" ");
  const automatic = draft.input.reviewMode === "final";
  const input: GenerationInput = { ...draft.input, script, scriptLocked: true, scriptApproved: !automatic, scriptOrigin: automatic ? draft.input.scriptOrigin : "owner", requestId: draft.id,
    ...(isStockDraft(draft) ? { storyboard: draft.scenes.map(s => ({ narration: s.narration, query: s.query, assetId: s.footage!.id })) } : { sceneNarration: draft.scenes.map(s => s.narration) }),
  };
  const [job] = await createGenerationJobs("local-owner", [input]);
  return mutate(drafts => {
    const stored = drafts.find(d => d.id === draft.id)!;
    if (stored.status === "APPROVED") return stored;
    stored.status = "APPROVED"; stored.approvedJobId = job.id; stored.stage = automatic ? "Automatically queued for rendering — final video awaits your review" : "Approved and queued for rendering"; stored.error = undefined;
    stored.leaseOwner = undefined; stored.leaseUntil = undefined;
    stored.version++; stored.updatedAt = new Date().toISOString();
    return stored;
  });
}

export async function approveCreationDraft(id: string, version: number) {
  const found = (await listCreationDrafts()).find(d => d.id === id);
  if (found?.status === "APPROVED") return found;
  if (found?.status === "APPROVING") return dispatchApproved(found);
  if (found?.input.creationType === "children-song") await requireSongAudio(found.input.songAudioId, found.input.duration);
  const draft = await mutate(drafts => {
    const stored = drafts.find(d => d.id === id);
    if (stored && ["APPROVING", "APPROVED"].includes(stored.status)) return stored;
    const current = requireEditable(stored, version);
    if (current.status !== "READY") throw new Error("Retry the failed plan before approving it.");
    validateDraftScenes(current, current.scenes, true);
    current.status = "APPROVING"; current.stage = "Saving approval and queuing the exact approved draft";
    current.version++; current.updatedAt = new Date().toISOString();
    return current;
  });
  return dispatchApproved(draft);
}

export async function changeDraftStatus(id: string, version: number, action: "retry" | "archive" | "finish") {
  return mutate(drafts => {
    const draft = drafts.find(d => d.id === id);
    if (!draft || draft.version !== version) throw new DraftConflict("Draft changed or no longer exists. Reload it.");
    if (["PLANNING", "APPROVING"].includes(draft.status)) throw new DraftConflict("Wait for the current planning step to finish.");
    if (action === "retry" && draft.status !== "FAILED") throw new DraftConflict("Only failed plans can be retried.");
    if (action === "finish" && !["READY", "FAILED"].includes(draft.status)) throw new DraftConflict("Only waiting or failed plans can be finished automatically.");
    if (action === "finish" || action === "retry") draft.input.reviewMode = "final";
    if (action === "retry" && draft.input.kidsStoryAttempt?.repairAttempted) draft.input.kidsStoryAttempt.repairAttempted = false;
    if (action === "retry" && draft.input.creativeBriefAttempt?.repairAttempted) draft.input.creativeBriefAttempt.repairAttempted = false;
    draft.status = action === "archive" ? "ARCHIVED" : "QUEUED";
    draft.stage = action === "archive" ? "Draft archived; saved media retained" : "Queued to resume planning";
    draft.version++; draft.updatedAt = new Date().toISOString(); draft.error = undefined;
    draft.nextAttemptAt = undefined;
    return draft;
  });
}

let planning = false;
const readyToPlan = (draft: CreationDraft) => (draft.status === "QUEUED" && (!draft.nextAttemptAt || Date.parse(draft.nextAttemptAt) <= Date.now())) || (draft.status === "PLANNING" && (draft.leaseUntil || 0) < Date.now());
const readyForPlanningResources = (draft: CreationDraft, resources: { waitingForMemory: boolean }) => readyToPlan(draft)
  && (!resources.waitingForMemory || (writingModelIdentity().startsWith("groq:") && draft.input.creationType !== "children-song"));

/** Bounded cloud text planning may run while local media work awaits RAM. */
export async function creationDraftWorkflowReady(resources: { waitingForMemory: boolean }) {
  const drafts = await listCreationDrafts();
  if (drafts.some(draft => draft.status === "APPROVING")) return true;
  if (drafts.some(draft => draft.status === "PLANNING" && (draft.leaseUntil || 0) > Date.now())) return false;
  return drafts.some(draft => readyForPlanningResources(draft, resources));
}

async function attemptPlanningSlot(work: () => Promise<unknown>, kind: string) {
  const admitted = await tryWithLocalRenderSlot(work, kind);
  if (!admitted.acquired) throw new HeavyWorkWaitError(`${(await heavyWorkStatus()).reason}; saved planning will continue automatically.`);
}

export async function processNextCreationDraft() {
  if (planning) return;
  planning = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const all = await listCreationDrafts();
    const approving = all.find(d => d.status === "APPROVING");
    if (approving) {
      try { await dispatchApproved(approving); }
      catch (error) { await mutate(drafts => {
        const current = drafts.find(d => d.id === approving.id);
        if (!current || current.status !== "APPROVING") return;
        current.status = "FAILED"; current.stage = "Could not queue render; retry safely";
        current.error = error instanceof Error ? error.message : "Render dispatch failed.";
        current.version++; current.updatedAt = new Date().toISOString();
      }); }
      return;
    }
    const resources = await heavyWorkStatus();
    if (!all.some(draft => readyForPlanningResources(draft, resources))) return;
    const draft = await mutate(drafts => {
      if (drafts.some(d => d.status === "PLANNING" && (d.leaseUntil || 0) > Date.now())) return null;
      const selected = drafts.find(draft => readyForPlanningResources(draft, resources));
      if (!selected) return null;
      selected.status = "PLANNING"; selected.stage = selected.input.reviewMode === "final" ? "Planning — rendering will start automatically" : "Planning — video will wait for your approval";
      selected.leaseOwner = leaseOwner; selected.leaseUntil = Date.now() + leaseMs; selected.version++;
      selected.nextAttemptAt = undefined;
      return selected;
    });
    if (!draft) return;
    const update = async (change: Partial<CreationDraft>) => mutate(drafts => {
      const current = drafts.find(d => d.id === draft.id);
      if (!current || current.leaseOwner !== leaseOwner || current.status !== "PLANNING") throw new DraftConflict("Draft planning lease was lost.");
      Object.assign(current, change, { updatedAt: new Date().toISOString() });
    });
    heartbeat = setInterval(() => void update({ leaseUntil: Date.now() + leaseMs }).catch(() => undefined), 30_000);
    heartbeat.unref();
    try {
      let script = "";
      // This phase is bounded text and catalogue metadata only: it must never
      // download/decode media, submit singing, or invoke the video renderer.
      const preparePlan = async () => {
        if (isStockDraft(draft)) {
          const prepared = await prepareStockCreation(draft.input, draft.scenes, async (input, scenes, stage) => {
            draft.input = input; draft.scenes = scenes;
            await update({ input, scenes, stage });
          }, draft.input.reviewMode === "final");
          draft.input = prepared.input; draft.scenes = prepared.scenes; script = prepared.input.script!;
        } else {
          script = draft.input.script?.trim() || await createContent(draft.input as KidsRenderInput, await getCreativeGuidance(draft.input.creationType), async planned => {
            draft.input = { ...draft.input, creativeBrief: planned.creativeBrief, creativeBriefAttempt: planned.creativeBriefAttempt, kidsStoryAttempt: planned.kidsStoryAttempt };
            await update({ input: draft.input, stage: planned.creativeBriefAttempt ? "Story plan correction saved · checking supported visuals" : planned.kidsStoryAttempt ? "Narration correction saved · checking visible actions and dialogue" : "Original story direction saved · preparing dialogue" });
          });
          draft.input = { ...draft.input, script, scriptOrigin: draft.input.scriptOrigin || (draft.input.script?.trim() ? "owner" : "local-model") };
        }
        await update({ input: draft.input, scenes: draft.scenes, stage: "Narration and visual sequence saved" });
      };
      if (writingModelIdentity().startsWith("groq:")) {
        await withWritingSession(async () => {
          // Recheck inside the pinned session. A concurrent settings change must
          // never turn the remote-only exemption into an unreserved local model.
          if (!writingModelIdentity().startsWith("groq:")) throw new Error("Writing settings changed before planning. Retry to use the selected writer safely.");
          await preparePlan();
        });
      } else {
        // Acquire the heavy slot BEFORE opening the local writer session; the
        // opposite lock order can deadlock against a renderer that also writes.
        await attemptPlanningSlot(() => withWritingSession(preparePlan), "Creation planning");
      }
      if (draft.input.creationType === "children-song") {
        // Singing generates/stages actual audio and is never RAM-exempt, even
        // when the lyrics were prepared by Groq. Its own stricter guard stays.
        await attemptPlanningSlot(async () => {
          if (draft.input.songMode === "local-ace" && !draft.input.songAudioId) {
            const song = await prepareLocalSong({ lyrics: script, duration: draft.input.duration, style: draft.input.songStyle, taskId: draft.songTaskId, submissionStarted: draft.songSubmissionStarted }, update);
            draft.input.songAudioId = song.id;
            await update({ input: draft.input });
          }
          await requireSongAudio(draft.input.songAudioId, draft.input.duration);
        }, "Song audio preparation");
      }
      const scenes = draft.scenes.length ? draft.scenes
        : (draft.input.creationType === "children-song" ? script.split(/\n+/).map(s => s.trim()).filter(Boolean) : narrationBeats(script, 18))
          .map(narration => ({ narration, query: "" }));
      // Long lyric sheets are grouped without changing a word.
      const grouped = (scenes.length > 18 ? narrationBeats(script.replace(/\s+/g, " "), 18).map(narration => ({ narration, query: "" })) : scenes).map(scene => ({ ...scene, narration: scene.narration.replace(/\s+/g, " ").trim() }));
      validateDraftScenes(draft, grouped);
      if (draft.input.reviewMode === "final") {
        await update({ scenes: grouped });
        validateDraftScenes(draft, grouped, true);
        draft.scenes = grouped;
        await update({ scenes: grouped, status: "APPROVING", stage: "Visual plan ready — queuing render automatically", error: undefined, version: draft.version + 1 });
      } else {
        await update({ scenes: grouped, status: "READY", stage: "Ready for your review — nothing will render until approved", error: undefined, version: draft.version + 1, leaseUntil: undefined, leaseOwner: undefined });
      }
      if (draft.input.reviewMode === "final") await dispatchApproved(draft);
    } catch (error) {
      await mutate(drafts => {
        const current = drafts.find(d => d.id === draft.id);
        if (!current || current.leaseOwner !== leaseOwner || !["PLANNING", "APPROVING"].includes(current.status)) return;
        if (isWritingWaitError(error)) {
          Object.assign(current, { status: "QUEUED", stage: error.message, error: undefined, nextAttemptAt: new Date(Date.now() + error.retryAfterMs).toISOString(), version: current.version + 1, updatedAt: new Date().toISOString(), leaseUntil: undefined, leaseOwner: undefined });
          return;
        }
        Object.assign(current, { status: "FAILED", stage: "Creation preparation failed — retry resumes saved progress", error: error instanceof Error ? error.message : "Planning failed.", version: current.version + 1, updatedAt: new Date().toISOString(), leaseUntil: undefined, leaseOwner: undefined });
      });
    }
  } finally { if (heartbeat) clearInterval(heartbeat); planning = false; }
}

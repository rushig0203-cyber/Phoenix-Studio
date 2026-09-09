import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { reviewRoot } from "./reviewFiles";
import { writeAtomicJson } from "./atomicJson";
import { withFileLock } from "./fileLock";
import { withLocalRenderSlot } from "./renderResources";
import { createGenerationJobs, createStockScript, type GenerationInput } from "./generation";
import { createContent, type KidsRenderInput } from "./kidsRenderer";
import { getCreativeGuidance } from "./qualityManager";
import { createStockStoryboard, narrationBeats } from "./stockStoryboard";
import { stockNarrationError } from "./stockBrief";
import { requireSongAudio } from "./songAudio";
import { selectedFootage } from "./stockCatalog";
import { prepareLocalSong } from "./localSinging";
import type { CreationDraft, DraftScene } from "./creationDraftTypes";

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
    const requestKey = `${input.requestId || crypto.randomUUID()}:${index}`;
    const existing = drafts.find(d => d.requestKey === requestKey);
    if (existing) {
      if (existing.status === "ARCHIVED") throw new DraftConflict("This draft was removed. Start a new creation.");
      return existing;
    }
    const now = new Date().toISOString();
    const draft: CreationDraft = { id: crypto.randomUUID(), requestKey, version: 1, status: "QUEUED", stage: "Queued for story planning only — no video render", input, scenes: [], createdAt: now, updatedAt: now };
    drafts.push(draft);
    return draft;
  }));
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
  const input: GenerationInput = { ...draft.input, script, scriptApproved: true, scriptOrigin: "owner", requestId: draft.id,
    ...(isStockDraft(draft) ? { storyboard: draft.scenes.map(s => ({ narration: s.narration, query: s.query, assetId: s.footage!.id })) } : { sceneNarration: draft.scenes.map(s => s.narration) }),
  };
  const [job] = await createGenerationJobs("local-owner", [input]);
  return mutate(drafts => {
    const stored = drafts.find(d => d.id === draft.id)!;
    if (stored.status === "APPROVED") return stored;
    stored.status = "APPROVED"; stored.approvedJobId = job.id; stored.stage = "Approved and queued for rendering"; stored.error = undefined;
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

export async function changeDraftStatus(id: string, version: number, action: "retry" | "archive") {
  return mutate(drafts => {
    const draft = drafts.find(d => d.id === id);
    if (!draft || draft.version !== version) throw new DraftConflict("Draft changed or no longer exists. Reload it.");
    if (["PLANNING", "APPROVING"].includes(draft.status)) throw new DraftConflict("Wait for the current planning step to finish.");
    if (action === "retry" && draft.status !== "FAILED") throw new DraftConflict("Only failed plans can be retried.");
    draft.status = action === "retry" ? "QUEUED" : "ARCHIVED";
    draft.stage = action === "retry" ? "Queued to resume planning" : "Draft archived; saved media retained";
    draft.version++; draft.updatedAt = new Date().toISOString(); draft.error = undefined;
    return draft;
  });
}

let planning = false;
export async function processNextCreationDraft() {
  if (planning) return;
  planning = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const all = await listCreationDrafts();
    const approving = all.find(d => d.status === "APPROVING");
    if (approving) { await dispatchApproved(approving); return; }
    if (!all.some(d => d.status === "QUEUED" || (d.status === "PLANNING" && (d.leaseUntil || 0) < Date.now()))) return;
    const draft = await mutate(drafts => {
      if (drafts.some(d => d.status === "PLANNING" && (d.leaseUntil || 0) > Date.now())) return null;
      const selected = drafts.find(d => d.status === "QUEUED" || (d.status === "PLANNING" && (d.leaseUntil || 0) < Date.now()));
      if (!selected) return null;
      selected.status = "PLANNING"; selected.stage = "Planning locally — video will wait for your approval";
      selected.leaseOwner = leaseOwner; selected.leaseUntil = Date.now() + leaseMs; selected.version++;
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
      await withLocalRenderSlot(async () => {
        const script = draft.input.script?.trim() || (isStockDraft(draft)
          ? await createStockScript(draft.input)
          : await createContent(draft.input as KidsRenderInput, await getCreativeGuidance(draft.input.creationType)));
        draft.input = { ...draft.input, script };
        await update({ input: draft.input, stage: "Preparing editable narration and scene previews" });
        if (draft.input.creationType === "children-song" && draft.input.songMode === "local-ace" && !draft.input.songAudioId) {
          const song = await prepareLocalSong({ lyrics: script, duration: draft.input.duration, style: draft.input.songStyle, taskId: draft.songTaskId, submissionStarted: draft.songSubmissionStarted }, update);
          draft.input.songAudioId = song.id;
          await update({ input: draft.input });
        }
        if (draft.input.creationType === "children-song") await requireSongAudio(draft.input.songAudioId, draft.input.duration);
        const scenes = draft.scenes.length ? draft.scenes : isStockDraft(draft)
          ? await createStockStoryboard({ ...draft.input, script })
          : (draft.input.creationType === "children-song" ? script.split(/\n+/).map(s => s.trim()).filter(Boolean) : narrationBeats(script, Math.min(18, Math.ceil(draft.input.duration / 7))))
            .map(narration => ({ narration, query: "" }));
        // Long lyric sheets are grouped without changing a word.
        const grouped = (scenes.length > 18 ? narrationBeats(script.replace(/\s+/g, " "), 18).map(narration => ({ narration, query: "" })) : scenes).map(scene => ({ ...scene, narration: scene.narration.replace(/\s+/g, " ").trim() }));
        validateDraftScenes(draft, grouped);
        await update({ scenes: grouped, status: "READY", stage: "Ready for your review — nothing will render until approved", error: undefined, version: draft.version + 1, leaseUntil: undefined, leaseOwner: undefined });
      });
    } catch (error) {
      await update({ status: "FAILED", stage: "Planning failed — no video was rendered", error: error instanceof Error ? error.message : "Planning failed.", version: draft.version + 1, leaseUntil: undefined, leaseOwner: undefined });
    }
  } finally { if (heartbeat) clearInterval(heartbeat); planning = false; }
}

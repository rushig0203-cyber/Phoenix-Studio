// Phoenix Studio Queue Worker programmatic runner
// Overrides TS module compilation to CommonJS for path resolution compatibility

const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

require("ts-node").register({
  // Type-check at build/test time, not on every laptop worker startup.
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});
require("tsconfig-paths/register");

console.log("Phoenix Studio: Programmatic worker loader initialized.");

// Load entry points without accepting work; --preflight exercises this loader.
const { processNextSourceJob } = require("./src/lib/sourceProcessing.ts");
const { pollGenerationJobs, reconcileRenderResources } = require("./src/lib/generation.ts");
const { writeWorkerHeartbeat } = require("./src/lib/studioHealth.ts");
const { processNextReviewEdit } = require("./src/lib/reviewEdits.ts");
const { processNextCreationDraft, enableAutomaticCreation, creationDraftWorkflowReady } = require("./src/lib/creationDrafts.ts");
const { processNextPostingAnalysis } = require("./src/lib/videoPostingAnalysis.ts");
const { heavyWorkStatus, reconcileLocalModelWork } = require("./src/lib/renderResources.ts");
const { createWorkerDispatcher } = require("./scripts/worker-workflows.cjs");

// Exercise the real loader and every entry point without accepting any work.
if (process.argv.includes("--preflight")) {
  if (typeof creationDraftWorkflowReady !== "function") throw new Error("Draft workflow readiness helper is unavailable.");
  console.log("Phoenix worker preflight passed: source, generation, edits and drafts loaded.");
  process.exit(0);
}

let preparationReady = false;
const dispatcher = createWorkerDispatcher({
  workflows: {
    source: { run: processNextSourceJob, intervalMs: 5000, immediate: true },
    // Keep terminal stock artifact downloads/probes inside the same gate too.
    generation: { run: pollGenerationJobs, intervalMs: 3000, immediate: true },
    edits: { run: processNextReviewEdit, intervalMs: 3000, immediate: true },
    drafts: { run: async () => {
      if (!preparationReady) {
        await enableAutomaticCreation();
        preparationReady = true;
        // Legacy READY drafts must migrate before normal readiness is checked.
        // Their actual planning gets a fresh turn/admission, not a bypass.
        dispatcher.queue.enqueue("drafts");
        return;
      }
      await processNextCreationDraft();
    }, intervalMs: 5000, immediate: true },
    posting: { run: processNextPostingAnalysis, intervalMs: 15000 },
  },
  diagnostics: {
    heartbeat: { run: writeWorkerHeartbeat, intervalMs: 5000 },
    resources: { run: async () => {
      await reconcileLocalModelWork();
      // This status-only path releases terminal external reservations without
      // downloading/probing outputs or submitting another renderer task.
      await reconcileRenderResources();
    }, intervalMs: 5000 },
  },
  canRunWorkflow: async key => {
    const resources = await heavyWorkStatus();
    if (resources.lease) return false; // External work can outlive its submission.
    if (key === "drafts" && !preparationReady) return true; // Bounded store migration only.
    return key === "drafts" ? creationDraftWorkflowReady(resources) : !resources.waitingForMemory;
  },
  onError: (key, error) => console.error(`Phoenix ${key} worker:`, error instanceof Error ? error.message : String(error)),
});
function stopDispatch() {
  // Drain already-started work; do not kill its model/encoder or lose its lease.
  process.exitCode = 0;
  void dispatcher.stop();
}
process.once("SIGINT", stopDispatch);
process.once("SIGTERM", stopDispatch);
console.log("Phoenix Studio: Lumina local production manager active; submitted workflows run one at a time with final-video review. Cloud publishing, S3 exports, and unsolicited autonomous generation are disabled.");

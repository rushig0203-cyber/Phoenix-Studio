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

// Source-video processing is intentionally independent from the AI generator.
// It produces real local review files only when FFmpeg is available.
const { processNextSourceJob } = require("./src/lib/sourceProcessing.ts");
const { pollGenerationJobs, reconcileRenderResources } = require("./src/lib/generation.ts");
const { writeWorkerHeartbeat } = require("./src/lib/studioHealth.ts");
const { processNextReviewEdit } = require("./src/lib/reviewEdits.ts");
const { processNextCreationDraft, enableAutomaticCreation } = require("./src/lib/creationDrafts.ts");
const { processNextPostingAnalysis } = require("./src/lib/videoPostingAnalysis.ts");

// Exercise the real loader and every entry point without accepting any work.
if (process.argv.includes("--preflight")) {
  console.log("Phoenix worker preflight passed: source, generation, edits and drafts loaded.");
  process.exit(0);
}

void writeWorkerHeartbeat().catch(console.error);
setInterval(() => void writeWorkerHeartbeat().catch(console.error), 5000);
let resourceCheckRunning = false;
async function checkResources() {
  if (resourceCheckRunning) return;
  resourceCheckRunning = true;
  try { await reconcileRenderResources(); }
  catch (error) { console.error("Phoenix render reconciliation:", error.message); }
  finally { resourceCheckRunning = false; }
}
void checkResources();
setInterval(() => void checkResources(), 5000);

setInterval(() => void processNextSourceJob().catch((error) => console.error("Phoenix source processor:", error.message)), 5000);
void processNextSourceJob().catch((error) => console.error("Phoenix source processor startup:", error.message));

// Manual AI Creation jobs must be polled even when the old autonomous manager
// is disabled. Without this, a real provider task remains frozen at 5%.
setInterval(() => void pollGenerationJobs().catch((error) => console.error("Phoenix AI processor:", error.message)), 3000);
void pollGenerationJobs().catch(console.error);
// Posting analysis never blocks a finished MP4 or performs publication.
setInterval(() => void processNextPostingAnalysis().catch(error => console.error("Phoenix posting analysis:", error.message)), 15000);
setInterval(() => void processNextReviewEdit().catch((error) => console.error("Phoenix manual editor:", error.message)), 3000);
void processNextReviewEdit().catch(console.error);
console.log("Phoenix Studio: Lumina local production manager active; processing submitted jobs with final-video review. Cloud publishing, S3 exports, and unsolicited autonomous generation are disabled.");
let preparationReady = false;
setInterval(() => { if (preparationReady) void processNextCreationDraft().catch(error => console.error("Phoenix draft planner:", error.message)); }, 5000);
void enableAutomaticCreation().then(() => { preparationReady = true; return processNextCreationDraft(); }).catch(error => console.error("Phoenix draft planner startup:", error.message));

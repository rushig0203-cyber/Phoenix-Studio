// AuraClip Queue Worker programmatic runner
// Overrides TS module compilation to CommonJS for path resolution compatibility

const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

require("ts-node").register({
  compilerOptions: {
    module: "commonjs",
  },
});
require("tsconfig-paths/register");

console.log("AuraClip: Programmatic worker loader initialized.");

// Source-video processing is intentionally independent from the AI generator.
// It produces real local review files only when FFmpeg is available.
const { processNextSourceJob } = require("./src/lib/sourceProcessing.ts");
setInterval(() => void processNextSourceJob().catch((error) => console.error("Phoenix source processor:", error.message)), 5000);
void processNextSourceJob().catch((error) => console.error("Phoenix source processor startup:", error.message));
const { pollGenerationJobs } = require("./src/lib/generation.ts");

// Manual AI Creation jobs must be polled even when the old autonomous manager
// is disabled. Without this, a real provider task remains frozen at 5%.
setInterval(() => void pollGenerationJobs().catch((error) => console.error("Phoenix AI processor:", error.message)), 3000);
void pollGenerationJobs().catch(console.error);
const { processNextReviewEdit } = require("./src/lib/reviewEdits.ts");
setInterval(() => void processNextReviewEdit().catch((error) => console.error("Phoenix manual editor:", error.message)), 3000);
void processNextReviewEdit().catch(console.error);
console.log("Phoenix Studio: local-only worker active; cloud publishing, S3 exports, and autonomous generation are disabled.");

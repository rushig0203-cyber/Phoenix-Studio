// AuraClip Queue Worker programmatic runner
// Overrides TS module compilation to CommonJS for path resolution compatibility

const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

require("ts-node").register({
  compilerOptions: {
    module: "commonjs",
  },
});

console.log("AuraClip: Programmatic worker loader initialized.");
require("./src/workers/exportWorker.ts");

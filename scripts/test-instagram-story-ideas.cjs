const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// This pure helper does not use a model, provider, scheduler or the owner's media.
const filename = path.resolve(__dirname, "../src/lib/instagramStoryIdeas.ts");
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(source, {
  exports: exportsObject,
  require: () => assert.fail("Story ideas must remain local, not import a provider"),
  fetch: () => assert.fail("Story ideas must not perform network requests"),
  Date,
  Intl,
}, { filename });
const ideas = (file, day) => Array.from(exportsObject.instagramStoryIdeas(file, day));
const fixture = overrides => ({
  id: "00000000-0000-4000-8000-000000000001", title: "Waterfall beside green trees", quality: {}, ...overrides,
});

test("everyday Story prompts are three local, video-specific ideas, not automated posts or growth claims", () => {
  const prompts = ideas(fixture(), "2026-10-08");
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /Waterfall beside green trees/);
  assert.ok(prompts[1].endsWith("?")); assert.match(prompts[2], /^Poll idea — /);
  assert.ok(prompts.every(value => !/guarantee|trending|posted|#viral/i.test(value)));
});

test("completed frame observations ground the first Story prompt; unfinished analysis never invents a detail", () => {
  const file = fixture({ quality: { postingAnalysis: { status: "COMPLETE", observations: ["", "  Ocean waves\n\nreach the rocks.  ", "Invented unused claim"] } } });
  assert.match(ideas(file, "2026-10-08")[0], /Ocean waves reach the rocks\./);
  assert.ok(!ideas(file, "2026-10-08").join(" ").includes("Invented unused claim"));
  file.quality.postingAnalysis.status = "WAITING";
  assert.match(ideas(file, "2026-10-08")[0], /Waterfall beside green trees/);
});

test("daily prompt rotation is stable for one video/day and varies across days without another model request", () => {
  const file = fixture(); const first = ideas(file, "2026-10-08");
  assert.deepEqual(ideas(file, "2026-10-08"), first);
  const days = Array.from({ length: 20 }, (_, index) => JSON.stringify(ideas(file, `2026-10-${String(index + 1).padStart(2, "0")}`)));
  assert.ok(new Set(days).size >= 3, "Local prompt combinations must not remain fixed every day");
  assert.ok(new Set(days).size <= 27, "These are transparent prompt variations, not fabricated daily trend research");
});

test("Story detail text is whitespace-normalized and bounded instead of copying a long narration", () => {
  const prompt = ideas(fixture({ title: `   ${"A beautiful\n\nview ".repeat(50)} ` }), "2026-10-08")[0];
  assert.ok(!prompt.includes("\n")); assert.ok(!prompt.includes("  "));
  assert.ok(prompt.length < 210);
});

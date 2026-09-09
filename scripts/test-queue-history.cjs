/* Run with: node --test scripts/test-queue-history.cjs */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, after } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-queue-history-"));
require("ts-node").register({
  project: path.join(projectRoot, "tsconfig.json"),
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});
require("tsconfig-paths").register({ baseUrl: projectRoot, paths: { "@/*": ["src/*"] } });

// Stores resolve process.cwd() at import time. No live server or user files are touched.
process.chdir(testRoot);
const ai = require(path.join(projectRoot, "src/lib/generation.ts"));
const source = require(path.join(projectRoot, "src/lib/sourceProcessing.ts"));
const aiApi = require(path.join(projectRoot, "src/app/api/generations/route.ts"));
const sourceApi = require(path.join(projectRoot, "src/app/api/source-processing/route.ts"));
const reviewRoot = path.join(testRoot, "storage", "Phoenix Studio Review Files");
const aiPath = path.join(reviewRoot, "ai-creation-jobs.json");
const sourceQueuePath = path.join(reviewRoot, "source-processing-jobs.json");
const reviewPath = path.join(reviewRoot, "index.json");
const input = {
  requestId: crypto.randomUUID(), topic: "A bear helps a friend", language: "English", duration: 75,
  aspect: "9:16", voice: "local-windows-voice", subtitleStyle: "kids-bold", visualSource: "local-ai",
  targetPlatform: "YouTube", creationType: "children-story", publishingFormat: "youtube-short",
};
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value));
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const request = (endpoint, id) => new Request(`http://localhost/api/${endpoint}?id=${id}`, { method: "DELETE" });
function job(status) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id, projectId: id, title: "Test clip", project: { title: "Test clip" }, status, progress: status === "COMPLETED" ? 100 : 0,
    stage: "Test", sourceFile: "episode.mp4", mode: "coverage", duration: 75, requestJson: JSON.stringify(input),
    requestKey: input.requestId, retryCount: 0, completedClips: 0, totalClips: 0, reviewIds: [],
    createdAt: now, queuedAt: now, updatedAt: now,
  };
}
beforeEach(() => {
  fs.mkdirSync(path.join(reviewRoot, "sources"), { recursive: true });
  fs.mkdirSync(path.join(reviewRoot, "outputs"), { recursive: true });
  write(aiPath, []);
  write(sourceQueuePath, []);
  write(reviewPath, []);
});

test("cancelled AI job is hidden, persists, never starts, and cannot be restored by retry or duplicate request", async () => {
  const queued = job("QUEUED");
  write(aiPath, [queued]);
  const response = await aiApi.DELETE(request("generations", queued.id));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, cancelled: true, filesRetained: true });
  assert.deepEqual(await ai.listGenerationJobs(), []);
  assert.equal(await ai.processNextGenerationJob(), null);
  assert.equal(await ai.retryGenerationJob(queued.id), null);
  assert.equal(await ai.regenerateGenerationJob(queued.id), null);
  await assert.rejects(ai.createGenerationJobs("local-owner", [input]), /removed from the manager/);
  const persisted = read(aiPath)[0];
  assert.equal(persisted.status, "CANCELLED");
  assert.ok(persisted.archivedAt);
  assert.equal(read(aiPath).length, 1);
  assert.equal((await aiApi.DELETE(request("generations", queued.id))).status, 200);
});

test("cancelled source job never runs or revives, and its original upload is kept", async () => {
  const queued = job("QUEUED");
  const uploadedPath = path.join(reviewRoot, "sources", `${queued.id}-${queued.sourceFile}`);
  fs.writeFileSync(uploadedPath, "original-upload-sentinel");
  write(sourceQueuePath, [queued]);
  const response = await sourceApi.DELETE(request("source-processing", queued.id));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, cancelled: true, filesRetained: true });
  assert.deepEqual(await source.readSourceJobs(), []);
  assert.equal(await source.processNextSourceJob(), null);
  assert.equal(await source.retrySourceJob(queued.id), null);
  assert.equal(await source.updateJob(queued.id, { status: "QUEUED" }), null);
  assert.equal(fs.readFileSync(uploadedPath, "utf8"), "original-upload-sentinel");
  assert.equal(read(sourceQueuePath)[0].status, "CANCELLED");
  assert.ok(read(sourceQueuePath)[0].archivedAt);
});
test("regeneration queues an idempotent new copy and keeps the completed original", async () => {
  const completed=job("COMPLETED");write(aiPath,[completed]);
  const output=path.join(reviewRoot,"outputs",`${completed.id}-youtube.mp4`);
  fs.writeFileSync(output,"original-video");
  const replacement=await ai.regenerateGenerationJob(completed.id);
  assert.notEqual(replacement.id,completed.id);
  assert.equal((await ai.regenerateGenerationJob(completed.id)).id,replacement.id);
  assert.equal(read(aiPath)[0].status,"COMPLETED");
  assert.equal(fs.readFileSync(output,"utf8"),"original-video");
});
test("regeneration rewrites model narration but preserves owner and unknown legacy text", async () => {
  for (const origin of ["local-model", "owner", undefined]) {
    const completed = job("COMPLETED");
    completed.requestJson = JSON.stringify({...input, creationType:"business", script:"Saved narration.", scriptOrigin:origin, visualTerms:["customer support"], visualTermsOrigin:origin, storyboard:[{narration:"Saved narration.",query:"customer support"}]});
    write(aiPath,[completed]);
    const replacement = await ai.regenerateGenerationJob(completed.id);
    const requested = JSON.parse(replacement.requestJson);
    assert.equal(requested.script,origin === "local-model" ? undefined : "Saved narration.");
    assert.deepEqual(requested.visualTerms,origin === "local-model" ? undefined : ["customer support"]);
    assert.equal(requested.storyboard,undefined);
    assert.equal(read(aiPath)[0].requestJson,completed.requestJson);
  }
});

test("legacy spoken songs cannot regenerate or delete their existing result", async () => {
  const completed=job("COMPLETED");completed.requestJson=JSON.stringify({...input,creationType:"children-song"});write(aiPath,[completed]);
  const output=path.join(reviewRoot,"outputs",`${completed.id}-youtube.mp4`);fs.writeFileSync(output,"legacy-song");
  await assert.rejects(ai.regenerateGenerationJob(completed.id),/real sung recording/);
  assert.equal(read(aiPath).length,1);assert.equal(fs.readFileSync(output,"utf8"),"legacy-song");
});

test("removing completed or failed history preserves output bytes and review metadata", async () => {
  for (const [library, api, endpoint, store] of [
    [ai, aiApi, "generations", aiPath], [source, sourceApi, "source-processing", sourceQueuePath],
  ]) {
    for (const status of ["COMPLETED", "FAILED"]) {
      const completed = job(status);
      const output = path.join(reviewRoot, "outputs", `${completed.id}-youtube.mp4`);
      fs.writeFileSync(output, "finished-video-sentinel");
      const reviews = [{ id: completed.id, status: "READY", outputs: { youtube: { filename: path.basename(output) } } }];
      write(reviewPath, reviews);
      write(store, [completed]);
      const response = await api.DELETE(request(endpoint, completed.id));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).cancelled, false);
      assert.equal(fs.readFileSync(output, "utf8"), "finished-video-sentinel");
      assert.deepEqual(read(reviewPath), reviews);
      assert.equal(read(store)[0].status, status);
      const listed = library === ai ? await ai.listGenerationJobs() : await source.readSourceJobs();
      assert.deepEqual(listed, []);
    }
  }
});

test("active jobs reject deletion with 409 and remain unchanged", async () => {
  for (const [api, endpoint, store, status] of [
    [aiApi, "generations", aiPath, "RUNNING"], [sourceApi, "source-processing", sourceQueuePath, "PROCESSING"],
  ]) {
    const active = job(status);
    write(store, [active]);
    const response = await api.DELETE(request(endpoint, active.id));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /after it finishes or fails/);
    assert.deepEqual(read(store), [active]);
  }
});

test("both endpoints distinguish unknown and invalid identifiers", async () => {
  for (const [api, endpoint] of [[aiApi, "generations"], [sourceApi, "source-processing"]]) {
    assert.equal((await api.DELETE(request(endpoint, crypto.randomUUID()))).status, 404);
    assert.equal((await api.DELETE(request(endpoint, "not-an-id"))).status, 400);
  }
});

test("concurrent source retry and deletion always leave a cancelled or archived job", async () => {
  const failed = job("FAILED");
  write(sourceQueuePath, [failed]);
  await Promise.all([source.retrySourceJob(failed.id), source.removeSourceJob(failed.id)]);
  assert.deepEqual(await source.readSourceJobs(), []);
  assert.equal(await source.processNextSourceJob(), null);
  assert.ok(read(sourceQueuePath)[0].archivedAt);
});

after(() => {
  process.chdir(projectRoot);
  const resolved = path.resolve(testRoot);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + "phoenix-queue-history-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});

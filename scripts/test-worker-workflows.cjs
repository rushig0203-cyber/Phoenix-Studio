const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createWorkflowQueue, createWorkerDispatcher } = require("./worker-workflows.cjs");

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) {
  for (let index = 0; index < 30; index++) { if (check()) return; await turn(); }
  assert.ok(check(), "Mock dispatcher did not reach the expected state");
}
function fakeTimers() {
  const intervals = new Map(); let next = 0;
  return {
    setInterval(run, ms) { const id = ++next; intervals.set(id, { run, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    tick() { for (const entry of [...intervals.values()]) entry.run(); },
    get size() { return intervals.size; },
  };
}

test("fixed workflow keys stay FIFO and bounded while a callback is slow", async t => {
  const hold = deferred(), calls = [];
  let running = 0, maximum = 0;
  const run = key => async () => {
    maximum = Math.max(maximum, ++running); calls.push(key);
    try { if (key === "generation") await hold.promise; } finally { running--; }
  };
  const keys = ["generation", "source", "drafts", "edits", "posting"];
  const queue = createWorkflowQueue({ workflows: Object.fromEntries(keys.map(key => [key, run(key)])) });
  t.after(async () => { hold.resolve(); await queue.stop(); });
  queue.enqueue("generation"); await until(() => queue.snapshot().active === "generation");
  for (const key of keys.slice(1)) queue.enqueue(key);
  for (let tick = 0; tick < 1000; tick++) for (const key of keys) queue.enqueue(key);
  assert.deepEqual(queue.snapshot().pending, ["source", "drafts", "edits", "posting", "generation"]);
  assert.throws(() => queue.enqueue("unregistered"), /Unknown workflow/);
  hold.resolve(); await queue.whenIdle();
  assert.deepEqual(calls, ["generation", "source", "drafts", "edits", "posting", "generation"]);
  assert.equal(maximum, 1); assert.deepEqual(queue.snapshot().pending, []);
});

test("empty callbacks finish, and a blocked source reminder does not block eligible planning", async () => {
  const calls = []; let sourceReady = false;
  const queue = createWorkflowQueue({ workflows: {
    source: async () => { calls.push("source-empty"); return null; },
    drafts: async () => { calls.push("drafts"); },
    edits: async () => { calls.push("edits"); },
  }, canRun: async key => key !== "source" || sourceReady });
  queue.enqueue("source"); queue.enqueue("drafts"); queue.enqueue("edits");
  await queue.whenIdle();
  assert.deepEqual(calls, ["drafts", "edits"]); assert.deepEqual(queue.snapshot().pending, ["source"]);
  sourceReady = true; queue.resume(); await queue.whenIdle();
  assert.deepEqual(calls, ["drafts", "edits", "source-empty"]);
  queue.enqueue("drafts"); await queue.whenIdle(); assert.equal(calls.at(-1), "drafts");
  await queue.stop();
});

test("synchronous/rejected callback and logger failures release the workflow gate", async () => {
  const calls = [];
  const queue = createWorkflowQueue({ workflows: {
    thrown: () => { throw new Error("sync failure"); },
    rejected: async () => { throw new Error("async failure"); },
    next: async () => { calls.push("next"); },
  }, onError: key => { calls.push(key); if (key === "thrown") throw new Error("broken logger"); return Promise.reject(new Error("rejected logger")); } });
  queue.enqueue("thrown"); queue.enqueue("rejected"); queue.enqueue("next"); await queue.whenIdle();
  assert.deepEqual(calls, ["thrown", "rejected", "next"]); assert.equal(queue.snapshot().active, null);
  await queue.stop();
});

test("admission errors fail closed and retry the existing reminder without a backlog", async () => {
  let ready = false, calls = 0, errors = 0;
  const queue = createWorkflowQueue({ workflows: { source: async () => { calls++; } },
    canRun: async () => { if (!ready) throw new Error("corrupt lease"); return true; }, onError: () => { errors++; } });
  queue.enqueue("source"); await queue.whenIdle();
  assert.equal(calls, 0); assert.equal(errors, 1); assert.deepEqual(queue.snapshot().pending, ["source"]);
  ready = true; queue.resume(); await queue.whenIdle(); assert.equal(calls, 1); await queue.stop();
});

test("reentrant fast callbacks yield so diagnostics and shutdown remain responsive", async () => {
  let calls = 0, diagnostic = false, queue;
  queue = createWorkflowQueue({ workflows: { generation: () => {
    calls++; if (calls < 200) queue.enqueue("generation");
  } } });
  queue.enqueue("generation");
  const stopped = new Promise(resolve => setImmediate(() => {
    diagnostic = true; void queue.stop().then(resolve);
  }));
  await stopped;
  assert.equal(diagnostic, true); assert.ok(calls > 0 && calls < 200, "Queue monopolized the event loop");
  assert.equal(queue.enqueue("generation"), false); assert.deepEqual(queue.snapshot().pending, []);
});

test("stop during asynchronous admission does not begin a callback", async () => {
  const admission = deferred(); let calls = 0;
  const queue = createWorkflowQueue({ workflows: { generation: () => { calls++; } }, canRun: () => admission.promise });
  queue.enqueue("generation"); const stopped = queue.stop(); admission.resolve(true); await stopped;
  assert.equal(calls, 0); assert.deepEqual(queue.snapshot(), { stopped: true, active: null, pending: [] });
});

test("independent diagnostics run without self-overlap during a slow workflow and stop drains safely", async t => {
  const timers = fakeTimers(), work = deferred(), check = deferred();
  let generationCalls = 0, sourceCalls = 0, heartbeatCalls = 0, resourceCalls = 0;
  const dispatcher = createWorkerDispatcher({ timers, workflows: {
    generation: { run: async () => { generationCalls++; await work.promise; }, intervalMs: 3, immediate: true },
    source: { run: async () => { sourceCalls++; }, intervalMs: 5 },
  }, diagnostics: {
    heartbeat: { run: async () => { heartbeatCalls++; }, intervalMs: 5 },
    resources: { run: async () => { resourceCalls++; await check.promise; }, intervalMs: 5 },
  } });
  t.after(async () => { work.resolve(); check.resolve(); await dispatcher.stop(); });
  await until(() => generationCalls === 1 && resourceCalls === 1);
  for (let index = 0; index < 20; index++) { timers.tick(); await turn(); }
  assert.ok(heartbeatCalls > 1); assert.equal(resourceCalls, 1); assert.equal(sourceCalls, 0);
  assert.ok(dispatcher.snapshot().pending.length <= 2);
  const stopped = dispatcher.stop(); assert.equal(timers.size, 0);
  timers.tick(); work.resolve(); check.resolve(); await stopped; await dispatcher.stop();
  assert.equal(generationCalls, 1); assert.equal(sourceCalls, 0);
  assert.equal(dispatcher.queue.enqueue("source"), false);
});

function mockedRunner() {
  const timers = fakeTimers(), calls = [], signals = new Map(), errors = [];
  const hold = deferred(); let dispatcher, heldGeneration = false, active = 0, maximum = 0;
  let resources = { lease: null, waitingForMemory: false }, draftReady = true;
  const run = key => async () => {
    maximum = Math.max(maximum, ++active); calls.push(key);
    try { if (key === "generation" && heldGeneration) await hold.promise; } finally { active--; }
  };
  const modules = {
    "@next/env": { loadEnvConfig() {} }, "ts-node": { register() {} }, "tsconfig-paths/register": {},
    "./src/lib/sourceProcessing.ts": { processNextSourceJob: run("source-empty") },
    "./src/lib/generation.ts": { pollGenerationJobs: run("generation"), reconcileRenderResources: async () => { calls.push("reconcile"); } },
    "./src/lib/studioHealth.ts": { writeWorkerHeartbeat: async () => { calls.push("heartbeat"); } },
    "./src/lib/reviewEdits.ts": { processNextReviewEdit: run("edits") },
    "./src/lib/creationDrafts.ts": { enableAutomaticCreation: async () => { calls.push("enable"); },
      processNextCreationDraft: run("drafts"), creationDraftWorkflowReady: async () => draftReady },
    "./src/lib/videoPostingAnalysis.ts": { processNextPostingAnalysis: run("posting") },
    "./src/lib/renderResources.ts": { heavyWorkStatus: async () => resources,
      reconcileLocalModelWork: async () => { calls.push("model-status"); } },
    "./scripts/worker-workflows.cjs": { createWorkerDispatcher: options => {
      dispatcher = createWorkerDispatcher({ ...options, timers }); return dispatcher;
    } },
  };
  const mockProcess = { argv: ["node", "run-worker.js"], cwd: () => path.resolve(__dirname, ".."),
    once: (signal, handler) => signals.set(signal, handler), exitCode: undefined };
  function start() {
    const source = fs.readFileSync(path.join(__dirname, "..", "run-worker.js"), "utf8");
    vm.runInNewContext(source, { require: name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected production dependency: ${name}`); return modules[name];
    }, process: mockProcess, console: { log() {}, error: (...args) => errors.push(args) } });
  }
  return { timers, calls, signals, errors, process: mockProcess, start, hold,
    get dispatcher() { return dispatcher; }, get maximum() { return maximum; },
    set resources(value) { resources = value; }, set draftReady(value) { draftReady = value; },
    set heldGeneration(value) { heldGeneration = value; } };
}

test("real runner wiring defers heavy workflows but permits ready Groq text planning under RAM-only pressure", async t => {
  const runner = mockedRunner(); runner.resources = { lease: null, waitingForMemory: true }; runner.start();
  t.after(() => runner.dispatcher.stop()); await runner.dispatcher.queue.whenIdle();
  assert.deepEqual(runner.calls.filter(key => ["source-empty", "generation", "edits", "drafts", "posting"].includes(key)), ["drafts"]);
  assert.equal(runner.calls.filter(key => key === "enable").length, 1);
  runner.resources = { lease: { external: { taskId: "mock-existing-render" } }, waitingForMemory: false };
  runner.timers.tick(); await runner.dispatcher.queue.whenIdle();
  assert.equal(runner.calls.filter(key => key === "drafts").length, 1, "Planning overlapped an existing external renderer");
  assert.ok(runner.calls.includes("reconcile")); assert.ok(runner.calls.includes("heartbeat"));
  runner.resources = { lease: null, waitingForMemory: false };
  runner.dispatcher.queue.resume(); await runner.dispatcher.queue.whenIdle();
  assert.ok(runner.calls.includes("generation")); assert.ok(runner.calls.includes("posting"));
  assert.equal(runner.maximum, 1); assert.equal(runner.errors.length, 0);
});

test("real runner shutdown signal clears timers and pending work without killing an active workflow", async t => {
  const runner = mockedRunner(); runner.heldGeneration = true; runner.start();
  t.after(async () => { runner.hold.resolve(); await runner.dispatcher.stop(); });
  await until(() => runner.dispatcher.snapshot().active === "generation");
  runner.timers.tick(); await turn();
  assert.ok(runner.calls.includes("heartbeat")); assert.ok(runner.calls.includes("reconcile"));
  runner.signals.get("SIGTERM")(); assert.equal(runner.timers.size, 0); assert.equal(runner.process.exitCode, 0);
  runner.hold.resolve(); await runner.dispatcher.stop();
  assert.equal(runner.calls.filter(key => key === "generation").length, 1);
  assert.ok(!runner.calls.includes("edits") && !runner.calls.includes("drafts") && !runner.calls.includes("posting"));
  assert.equal(runner.maximum, 1);
});

test("real runner migrates legacy drafts once even when initial planning readiness is false", async t => {
  const runner = mockedRunner(); runner.resources = { lease: null, waitingForMemory: true };
  runner.draftReady = false; runner.start(); t.after(() => runner.dispatcher.stop());
  await runner.dispatcher.queue.whenIdle();
  assert.equal(runner.calls.filter(key => key === "enable").length, 1);
  assert.ok(!runner.calls.includes("drafts"), "Migration bypassed planning admission");
  assert.ok(runner.dispatcher.snapshot().pending.includes("drafts"));
  runner.timers.tick(); await runner.dispatcher.queue.whenIdle();
  assert.equal(runner.calls.filter(key => key === "enable").length, 1);
  assert.ok(!runner.calls.includes("drafts"));
  runner.draftReady = true; runner.dispatcher.queue.resume(); await runner.dispatcher.queue.whenIdle();
  assert.equal(runner.calls.filter(key => key === "drafts").length, 1);
  assert.equal(runner.calls.filter(key => key === "enable").length, 1);
});

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const lease = require('../src/lib/renderResources.ts');
const originalRetain = lease.retainLocalModelWork, originalFinish = lease.finishLocalModelWork;
const reservations = [];
lease.retainLocalModelWork = async value => reservations.push(['retain', value]);
lease.finishLocalModelWork = async value => reservations.push(['finish', value]);
const { generateLocalModel, withLocalWritingSession, isLocalModelSessionUncertainError } = require('../src/lib/localModelSession.ts');
const { LocalModelResourceWaitError } = require('../src/lib/localModelResources.ts');
const realFetch = global.fetch, realFree = os.freemem, originalModel = process.env.OLLAMA_MODEL;
const writingSettings = require('../src/lib/writingSettings.ts');
const realSettings = writingSettings.readWritingSettings;
// Never let integration fixtures inherit the owner's cloud key/provider.
writingSettings.readWritingSettings = () => ({ provider: 'ollama', model, freePlanConfirmed: false });
after(() => {
  global.fetch = realFetch; os.freemem = realFree;
  writingSettings.readWritingSettings = realSettings;
  lease.retainLocalModelWork = originalRetain; lease.finishLocalModelWork = originalFinish;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = originalModel;
});
const MiB = 1024 * 1024;
const model = 'session-test:latest', digest = 'our-installed-version';
process.env.OLLAMA_MODEL = model;
const selected = { model, name: model, digest, size: 1929912432 };
const payload = () => ({ model, prompt: 'Write one useful line.', options: { num_ctx: 4096 } });
const runner = (overrides = {}) => ({ ...selected, size: 2500 * MiB, context_length: 4096,
  expires_at: new Date(Date.now() + 120_000).toISOString(), ...overrides });

function environment({ loaded = [], generate, unload, free = 6 * 1024 * MiB } = {}) {
  const state = { loaded, calls: [], generating: 0, peak: 0 };
  reservations.length = 0;
  os.freemem = () => free;
  global.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    state.calls.push({ pathname, body: options.body && JSON.parse(options.body), options });
    if (pathname === '/api/tags') return Response.json({ models: [selected] });
    if (pathname === '/api/ps') return Response.json({ models: state.loaded });
    assert.equal(pathname, '/api/generate');
    const body = JSON.parse(options.body);
    assert.equal(body.model, model);
    if (body.keep_alive === 0) {
      if (unload) return unload(state, options);
      state.loaded = state.loaded.filter(item => item.model !== model);
      return Response.json({ model, done: true, done_reason: 'unload' });
    }
    assert.equal(body.stream, false); assert.equal(body.options.num_batch, 128);
    assert.ok(body.options.num_thread <= 2);
    state.generating++; state.peak = Math.max(state.peak, state.generating);
    state.loaded = [runner(), ...state.loaded.filter(item => item.model !== model)];
    try {
      if (generate) return await generate(state, body, options);
      return Response.json({ model, done: true, response: 'A complete answer.' });
    } finally { state.generating--; }
  };
  return state;
}
const generations = state => state.calls.filter(call => call.pathname === '/api/generate' && call.body.keep_alive !== 0);
const unloads = state => state.calls.filter(call => call.pathname === '/api/generate' && call.body.keep_alive === 0);

test('cached writing session has no inventory, model calls, loads or unloads', async () => {
  const state = environment();
  assert.equal(await withLocalWritingSession(async () => 'cached', { model }), 'cached');
  assert.deepEqual(state.calls, []);
  assert.deepEqual(reservations, []);
});

test('one cold runner is shared across nested planning stages and released after final body consumption', async () => {
  const state = environment();
  const texts = await withLocalWritingSession(async () => {
    const first = await generateLocalModel(payload());
    assert.equal(unloads(state).length, 0);
    const second = await withLocalWritingSession(() => generateLocalModel(payload()));
    assert.equal(unloads(state).length, 0);
    return [await first.json(), await second.json()];
  }, { model });
  assert.equal(texts[0].response, 'A complete answer.');
  assert.equal(generations(state).length, 2); assert.equal(unloads(state).length, 1);
  assert.equal(state.loaded.length, 0);
  assert.equal(reservations.filter(item => item[0] === 'retain').length, 2);
  assert.equal(reservations.at(-1)[0], 'finish');
});

test('pre-existing configured model is borrowed and never unloaded or given shorter expiry', async () => {
  const expiry = Date.now() + 15 * 60_000;
  const state = environment({ loaded: [runner({ expires_at: new Date(expiry).toISOString() })] });
  await generateLocalModel(payload());
  assert.equal(unloads(state).length, 0);
  assert.ok(generations(state)[0].body.keep_alive >= 15 * 60);
  assert.equal(state.loaded.length, 1);
});

test('unrelated resident models are never the unload target', async () => {
  const other = runner({ model: 'foreign:latest', name: 'foreign:latest', digest: 'foreign' });
  const state = environment({ loaded: [other] });
  await generateLocalModel(payload());
  assert.deepEqual(state.loaded, [other]);
  assert.deepEqual(unloads(state).map(call => call.body.model), [model]);
});

test('an outside model version change or keep-alive extension relinquishes ownership', async () => {
  for (const change of [{ digest: 'new-owner-version' }, { expires_at: new Date(Date.now() + 60 * 60_000).toISOString() }]) {
    const state = environment();
    await withLocalWritingSession(async () => {
      await generateLocalModel(payload());
      state.loaded = state.loaded.map(item => ({ ...item, ...change }));
    }, { model });
    assert.equal(unloads(state).length, 0);
    assert.equal(state.loaded.length, 1);
  }
});

test('failed content validation still releases the owned runner', async () => {
  const state = environment();
  await assert.rejects(withLocalWritingSession(async () => {
    await generateLocalModel(payload());
    throw new Error('Editorial validation failed');
  }, { model }), /Editorial validation failed/);
  assert.equal(unloads(state).length, 1); assert.equal(state.loaded.length, 0);
});

test('in-flight timeout is not treated as stopped; explicit unload confirms cleanup', async () => {
  const state = environment({ generate: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await assert.rejects(generateLocalModel(payload()), /timed out/);
  assert.equal(unloads(state).length, 1);
  assert.equal(reservations.at(-1)[0], 'finish');
});

test('unknown completion or failed unload keeps reservation and exposes typed uncertainty', async () => {
  const state = environment({
    generate: async () => { throw new DOMException('timed out', 'TimeoutError'); },
    unload: async () => { throw new Error('connection lost'); },
  });
  await assert.rejects(generateLocalModel(payload()), error => {
    assert.ok(isLocalModelSessionUncertainError(error));
    assert.equal(error.requestMayStillBeRunning, true); assert.equal(error.phoenixOwned, true);
    return true;
  });
  assert.equal(unloads(state).length, 1);
  assert.equal(reservations.some(item => item[0] === 'finish'), false);
});

test('borrowed model timeout never unloads someone else runner and retains reservation', async () => {
  const state = environment({ loaded: [runner()], generate: async () => { throw new Error('lost connection'); } });
  await assert.rejects(generateLocalModel(payload()), error => isLocalModelSessionUncertainError(error) && !error.phoenixOwned);
  assert.equal(unloads(state).length, 0);
  assert.equal(reservations.some(item => item[0] === 'finish'), false);
});

test('user cancellation runs cleanup with a fresh signal instead of the aborted signal', async () => {
  const controller = new AbortController();
  const state = environment({ generate: async () => { controller.abort(new Error('user cancelled')); throw controller.signal.reason; } });
  await assert.rejects(withLocalWritingSession(() => generateLocalModel(payload()), { model, signal: controller.signal }), /user cancelled/);
  assert.equal(unloads(state).length, 1);
  assert.equal(unloads(state)[0].options.signal.aborted, false);
});

test('sessions and parallel requests are single-flight', async () => {
  const state = environment({ generate: async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ done: true, response: 'Done' });
  } });
  await Promise.all([
    withLocalWritingSession(() => Promise.all([generateLocalModel(payload()), generateLocalModel(payload())]), { model }),
    withLocalWritingSession(() => generateLocalModel(payload()), { model }),
  ]);
  assert.equal(state.peak, 1); assert.equal(unloads(state).length, 2);
});

test('low RAM never dispatches a model; unsafe endpoint/nested model never dispatches anything', async () => {
  let state = environment({ free: 900 * MiB });
  await assert.rejects(generateLocalModel(payload()), LocalModelResourceWaitError);
  assert.equal(generations(state).length, 0); assert.equal(unloads(state).length, 0);
  state = environment();
  await assert.rejects(withLocalWritingSession(async () => undefined, { baseUrl: 'https://api.example.com' }), /loopback/);
  await assert.rejects(withLocalWritingSession(() => withLocalWritingSession(async () => undefined, { model: 'another:latest' }), { model }), /cannot switch/);
  assert.equal(state.calls.length, 0);
});

test('successful HTTP without done proof is not accepted and an unconfirmed unload retains uncertainty', async () => {
  const state = environment({ generate: async () => Response.json({ response: 'partial' }),
    unload: async () => Response.json({ done: true, done_reason: 'stop' }) });
  await assert.rejects(generateLocalModel(payload()), isLocalModelSessionUncertainError);
  assert.equal(unloads(state).length, 1);
  assert.equal(reservations.some(item => item[0] === 'finish'), false);
});

test('cold loading requires a verifiable installed identity before allocating or reserving memory', async () => {
  const state = environment();
  const fetchInventory = global.fetch;
  global.fetch = async (url, options) => new URL(url).pathname === '/api/tags'
    ? Response.json({ models: [{ ...selected, digest: undefined }] }) : fetchInventory(url, options);
  await assert.rejects(generateLocalModel(payload()), error => error instanceof LocalModelResourceWaitError && error.reason === 'probe-unavailable');
  assert.equal(generations(state).length, 0); assert.equal(unloads(state).length, 0);
  assert.deepEqual(reservations, []);
});

const script = 'Replace a vague task with a small action you can actually finish. Suppose your list says organize the kitchen, but you keep walking past it because the job feels too big. Choose just one drawer and name what you will do there. Write put the loose spoons into the tray instead of organize everything. Open that drawer and move those spoons, leaving the other cupboards for another time. Now you can tell whether the action is finished by looking at the empty space beside the tray. If another object needs a home, write that as a separate action instead of silently expanding this one. A small next step does not solve the whole kitchen. It gives you a clear place to begin and a visible stopping point for today.';
const outline = {
  viewerQuestion: 'How can a vague task become one specific next action?', audience: 'People planning everyday household tasks',
  angles: [
    { angle: 'Use one kitchen drawer as a worked example', value: 'Make a small complete action easy to identify.' },
    { angle: 'Compare vague and specific task descriptions', value: 'Show the difference between a goal and an action.' },
    { angle: 'Explain why a clear stopping point helps', value: 'Keep the task bounded so the result can be checked.' },
  ], selectedAngle: 0, structure: 'worked-example', opening: 'Replace a vague task with a small action you can finish.',
  beats: [
    { point: 'Choose one drawer instead of the entire kitchen.', visual: 'Kitchen drawer with loose spoons.' },
    { point: 'Name the specific action before beginning.', visual: 'Person planning a simple household task.' },
    { point: 'Move the spoons and notice the stopping point.', visual: 'Spoons arranged inside a drawer tray.' },
  ], payoff: 'A specific action provides a clear place to begin and stop.', avoid: ['Do not claim that one small action solves the entire kitchen.'],
};
const verdict = Object.fromEntries(['topicAnswer', 'directOpening', 'consistentFacts', 'causalOrder', 'specificTakeaway', 'filmableActions']
  .map(name => [name, { passed: true, evidence: 'Choose just one drawer', reason: 'The example identifies a specific action and consistent setting.' }]));
const stockInput = () => ({ topic: 'Turn a vague task into a next action', duration: 45, creationType: 'general', aspect: '9:16' });
function stockResponse(body) {
  if (body.format?.properties?.viewerQuestion) return JSON.stringify(outline);
  if (body.format?.properties?.topicAnswer) return JSON.stringify(verdict);
  if (body.format === 'json') {
    const { narrationBeats } = require('../src/lib/stockStoryboard.ts');
    return JSON.stringify({ queries: narrationBeats(script, Math.ceil(45 / 6)).map(() => 'organizing kitchen drawer') });
  }
  return script;
}

test('actual stock writing shares one runner and releases it before footage; saved retry does no model work', async () => {
  const guidance = require('../src/lib/qualityManager.ts');
  const footage = require('../src/lib/automaticFootage.ts');
  const { prepareStockCreation } = require('../src/lib/stockPreparation.ts');
  const oldGuidance = guidance.getCreativeGuidance, oldFootage = footage.selectAutomaticFootage;
  guidance.getCreativeGuidance = async () => ({ revision: 'fixture', rules: [], feedbackCount: 0 });
  const state = environment({ generate: async (_, body) => Response.json({ done: true, response: stockResponse(body) }) });
  let footageCalls = 0;
  footage.selectAutomaticFootage = async (scenes, _duration, _aspect, save) => {
    assert.equal(state.loaded.length, 0, 'Writing runner must be gone before footage work');
    assert.equal(unloads(state).length, 1);
    footageCalls++;
    for (const [index, scene] of scenes.entries()) scene.footage = { id: index + 1 };
    await save(scenes, 'Fixture footage saved');
  };
  try {
    const result = await prepareStockCreation(stockInput());
    assert.equal(result.input.script, script); assert.equal(generations(state).length, 4);
    assert.equal(unloads(state).length, 1); assert.equal(footageCalls, 1);
    const before = state.calls.length, retainedBefore = reservations.length;
    await prepareStockCreation(result.input, result.scenes);
    assert.equal(state.calls.length, before, 'A saved script, verdict and scenes require no inventory or generation');
    assert.equal(reservations.length, retainedBefore, 'A cached writing phase does not touch the model reservation');
  } finally { guidance.getCreativeGuidance = oldGuidance; footage.selectAutomaticFootage = oldFootage; }
});

test('a later editorial memory wait retains completed narration and cleans the owned runner', async () => {
  const guidance = require('../src/lib/qualityManager.ts');
  const { prepareStockCreation } = require('../src/lib/stockPreparation.ts');
  const oldGuidance = guidance.getCreativeGuidance;
  guidance.getCreativeGuidance = async () => ({ revision: 'fixture', rules: [], feedbackCount: 0 });
  const state = environment({ generate: async (_, body) => {
    if (!body.format) os.freemem = () => 600 * MiB;
    return Response.json({ done: true, response: stockResponse(body) });
  } });
  const snapshots = [];
  try {
    await assert.rejects(prepareStockCreation(stockInput(), [], async input => snapshots.push(structuredClone(input))), LocalModelResourceWaitError);
    assert.equal(snapshots.at(-1).script, script); assert.equal(snapshots.at(-1).scriptOrigin, 'local-model');
    assert.equal(snapshots.at(-1).creativeBrief.structure, 'worked-example');
    assert.equal(generations(state).length, 2); assert.equal(unloads(state).length, 1); assert.equal(state.loaded.length, 0);
  } finally { guidance.getCreativeGuidance = oldGuidance; }
});

test('children model writing completes cleanup before returning and approved narration skips the model', async () => {
  const { createContent } = require('../src/lib/kidsRenderer.ts');
  const { guidanceFromFeedback } = require('../src/lib/qualityManager.ts');
  const state = environment({ generate: async () => Response.json({ done: true, response: 'A bunny plants a seed.' }) });
  const input = { topic: 'A bunny plants a seed', duration: 45, creationType: 'children-story' };
  const result = await createContent(input, guidanceFromFeedback([]));
  assert.ok(result.length > 0); assert.equal(unloads(state).length, 1); assert.equal(state.loaded.length, 0);
  const before = state.calls.length;
  assert.equal(await createContent({ ...input, script: result, scriptApproved: true }, guidanceFromFeedback([])), result);
  assert.equal(state.calls.length, before);
});

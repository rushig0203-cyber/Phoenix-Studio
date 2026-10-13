const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');

// Real planning/selection code with isolated catalog/writer fixtures only.
// No keys, owner storage, provider requests, media downloads or renderer.
function load(relative, dependencies) {
  const filename = path.join(project, relative), mod = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new vm.Script(output, { filename }).runInNewContext({
    module: mod, exports: mod.exports, Error, URL, Promise, Response,
    process: { env: { OLLAMA_MODEL: 'fixture-only' } },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name); return dependencies[name]; },
  }, { timeout: 1000 });
  return mod.exports;
}
const brief = load('src/lib/stockBrief.ts', {});
const semantics = load('src/lib/footageSemantics.ts', {});
const news = load('src/lib/newsVisualPolicy.ts', { './stockBrief': brief });
const plain = value => JSON.parse(JSON.stringify(value));
const scenes = [
  { narration: 'A generic customer follow-up can come across as insincere, but a tailored approach can strengthen relationships and drive business growth.', query: 'Generic email sent' },
  { narration: 'Email follow-up can be perceived as impersonal, whereas phone follow-up allows for real-time conversation and feedback.', query: 'Phone call made' },
  { narration: "In-person follow-up shows a genuine investment in the customer's needs, and combining these methods can maximize effectiveness.", query: 'In-person meeting held' },
  { narration: 'For example, sending a follow-up email after a meeting can help clarify discussions and show the customer you value their time.', query: 'Send follow-up email' },
  { narration: 'By comparing and combining different follow-up methods, you can create a personalized approach that addresses the unique needs and preferences of each customer, ultimately leading to stronger relationships and business growth.', query: 'Customer relationships compared' },
];
const replacements = ['customer conversation', 'person talking phone', 'customers discussing meeting', 'typing email laptop', 'customers discussing follow up'];
const footage = (id, title, extra = {}) => ({ id, duration: 40, width: 720, height: 1280,
  sourcePage: `https://www.pexels.com/video/${title.replace(/\s+/g, '-')}-${id}/`,
  creator: 'Fixture filmmaker', ...extra });
const base = { topic: 'Make a useful customer follow-up specific', duration: 47, aspect: '9:16',
  script: scenes.map(scene => scene.narration).join(' '), scriptOrigin: 'local-model', reviewMode: 'final' };
function harness({ reply = replacements, search = async () => [], providerError } = {}) {
  const calls = { writer: [], search: [], checkpoints: [] };
  const writing = { withWritingSession: async fn => fn(), async generateWritingModel(body) {
    calls.writer.push(body);
    if (providerError) throw providerError;
    return Response.json({ response: JSON.stringify({ queries: reply }) });
  } };
  const storyboard = load('src/lib/stockStoryboard.ts', { './footageSemantics': semantics, './writingModel': writing, './newsVisualPolicy': news });
  const catalog = { async searchFootage(...args) { calls.search.push(args); return search(...args); },
    async selectedFootage() { assert.fail('A selected asset must not be replaced/resolved in these fixtures'); } };
  const automatic = load('src/lib/automaticFootage.ts', { './stockCatalog': catalog, './stockBrief': brief, './footageSemantics': semantics, './newsVisualPolicy': news });
  const preparation = load('src/lib/stockPreparation.ts', { './generation': { createStockScript: async input => input.script },
    './stockStoryboard': storyboard, './automaticFootage': automatic, './stockCatalog': catalog,
    './writingModel': writing, './newsVisualPolicy': news });
  return { calls, storyboard, automatic, preparation, checkpoint: async (input, selected, stage) => calls.checkpoints.push({ input: plain(input), selected: plain(selected), stage }) };
}

test('exact cached customer follow-up failure gets one repair, saves it and selects five distinct usable shots', async () => {
  const original = plain(scenes);
  let correctedPlanSaved = false;
  const h = harness({ search: async query => {
    const at = replacements.indexOf(query);
    if (at < 0) return [footage(11025439, 'woman using laptop'), footage(7652166, 'person typing laptop', { duration: 13 })];
    assert.equal(correctedPlanSaved, true, 'Replacement query is saved before searching');
    return [footage(at + 1, replacements[at])];
  } });
  const result = await h.preparation.prepareStockCreation(base, scenes, async (...args) => {
    await h.checkpoint(...args);
    if (args[2] === 'Corrected visual searches saved — checking exact footage') correctedPlanSaved = true;
  });
  assert.equal(h.calls.writer.length, 1);
  assert.deepEqual(plain(result.scenes.map(scene => scene.query)), replacements);
  assert.deepEqual(plain(result.scenes.map(scene => scene.footage.id)), [1, 2, 3, 4, 5]);
  assert.equal(result.input.script, base.script); assert.equal(result.input.duration, 47);
  assert.deepEqual(plain(scenes), original, 'Caller/cache data is not mutated');
  assert.equal(h.calls.search.filter(call => call[0] === 'Generic email sent').length, 3);
  assert.match(h.calls.writer[0].prompt, /woman using laptop/);
  assert.ok(result.scenes.every(scene => /Metadata checks only/.test(scene.footageReason)));
});

test('saved selected clips on either side of the failed section stay exact', async () => {
  const earlier = { ...scenes[0], query: replacements[0], footage: footage(50, replacements[0]), footageReason: 'Earlier selected choice' };
  const later = { ...scenes[4], query: replacements[4], footage: footage(55, replacements[4]), footageReason: 'Later selected choice' };
  const plan = [earlier, { ...scenes[1] }, { ...scenes[2] }, { ...scenes[3] }, later];
  const h = harness({ search: async query => {
    const at = replacements.indexOf(query); return at < 0 ? [] : [footage(at + 1, query)];
  } });
  const result = await h.preparation.prepareStockCreation(base, plan, h.checkpoint);
  assert.equal(h.calls.writer.length, 1);
  assert.deepEqual(plain(result.scenes[0]), earlier); assert.deepEqual(plain(result.scenes[4]), later);
  assert.equal(h.calls.search.some(call => call[0] === earlier.query || call[0] === later.query), false);
});

test('a second unavailable section cannot trigger another repair or generic filler', async () => {
  const h = harness({ search: async query => query === replacements[0] ? [footage(1, query)] : [] });
  await assert.rejects(h.preparation.prepareStockCreation(base, scenes, h.checkpoint), /Section 2.*no distinct.*footage/);
  assert.equal(h.calls.writer.length, 1);
  const saved = h.calls.checkpoints.at(-1).selected;
  assert.equal(saved[0].footage.id, 1); assert.equal(saved[1].query, replacements[1]);
});

test('owner-written, approved, explicit visual briefs and exact-ID plans cannot receive query repair', async () => {
  for (const extra of [{ scriptOrigin: 'owner' }, { scriptOrigin: undefined }, { scriptApproved: true }, { visualTerms: ['Generic email sent'] },
    { storyboard: [{ ...scenes[4], assetId: 555 }] }]) {
    const h = harness();
    await assert.rejects(h.preparation.prepareStockCreation({ ...base, ...extra }, scenes, h.checkpoint), /Section 1.*no distinct/);
    assert.equal(h.calls.writer.length, 0); assert.equal(h.calls.search.length, 3);
    assert.deepEqual(h.calls.checkpoints.at(-1).selected, scenes);
  }
});

test('writer/quota errors propagate without searching a replacement or changing the plan', async () => {
  const h = harness({ providerError: new Error('Fixture free quota reached') });
  await assert.rejects(h.preparation.prepareStockCreation(base, scenes, h.checkpoint), /Fixture free quota reached/);
  assert.equal(h.calls.writer.length, 1); assert.equal(h.calls.search.length, 3);
  assert.deepEqual(h.calls.checkpoints.at(-1).selected, scenes);
});

test('invalid or mismatched repair cannot change narration or search off-topic footage', async () => {
  for (const reply of [[], replacements.slice(0, 4), [null, ...replacements.slice(1)], ['drinking coffee', ...replacements.slice(1)],
    ['typing email laptop', ...replacements.slice(1)], ['generic email sent ', ...replacements.slice(1)]]) {
    const h = harness({ reply });
    await assert.rejects(h.preparation.prepareStockCreation(base, scenes, h.checkpoint), /correction|repair|match|changed|unchanged|unavailable/i);
    assert.equal(h.calls.writer.length, 1); assert.equal(h.calls.search.length, 3);
    assert.deepEqual(h.calls.checkpoints.at(-1).selected, scenes);
  }
});

test('query correction cannot admit too-short, low-resolution or explicitly unrelated replacement footage', async () => {
  const h = harness({ search: async query => replacements.includes(query) ? [
    footage(1, 'drinking coffee'), footage(2, query, { duration: 1 }), footage(3, query, { width: 120 }),
  ] : [] });
  await assert.rejects(h.preparation.prepareStockCreation(base, scenes, h.checkpoint), /Section 1.*no distinct/);
  assert.equal(h.calls.writer.length, 1);
  assert.equal(h.calls.checkpoints.some(item => item.selected.some(scene => scene.footage)), false);
});

test('a resumed corrected query plan does not call the writer or replay its old rejected search', async () => {
  const corrected = scenes.map((scene, at) => ({ ...scene, query: replacements[at] }));
  const h = harness({ search: async query => [footage(replacements.indexOf(query) + 1, query)] });
  const result = await h.preparation.prepareStockCreation({ ...base, stockPreparation: { version: 1, scenes: corrected } }, corrected, h.checkpoint);
  assert.equal(h.calls.writer.length, 0); assert.equal(result.scenes.length, 5);
  assert.equal(h.calls.search.some(call => call[0] === 'Generic email sent'), false);
});

test('helper refuses news actors instead of broadening a neutral contextual plan into an event', async () => {
  const research = { title: 'Cyberattack disrupts supermarket fridges', summary: 'A supermarket network was affected by a cyberattack.', text: 'Supermarket fridge systems stopped working after a cyberattack.', citations: [] };
  const h = harness({ reply: ['hackers using computers'] });
  await assert.rejects(h.storyboard.repairUnavailableStockQueries({ topic: research.title, research },
    [{ narration: 'The supermarket fridge systems stopped working.', query: 'supermarket refrigerator aisle' }], 0, ['supermarket refrigerator shelves']), /repair|correction|unsafe|match|news/i);
  assert.equal(h.calls.writer.length, 1);
});

test('normal same-query expanded search that finds suitable footage never invokes repair', async () => {
  const h = harness({ search: async (query, aspect, anyOrientation) => anyOrientation ? [footage(1, 'opening curtains')] : [] });
  const result = await h.automatic.selectAutomaticFootage([{ narration: 'Open the curtains.', query: 'opening curtains' }], 20, '9:16', async () => {}, undefined,
    async () => { assert.fail('No repair needed'); });
  assert.equal(result[0].footage.id, 1); assert.equal(h.calls.search.length, 2); assert.equal(h.calls.writer.length, 0);
});

test('selector rejects normalized-equivalent query changes before replacement search', async () => {
  const h = harness();
  await assert.rejects(h.automatic.selectAutomaticFootage([scenes[0]], 15, '9:16', async () => {}, undefined,
    async () => [' generic   EMAIL sent ']), /correction was invalid/);
  assert.equal(h.calls.search.length, 3);
});

test('a failed correction checkpoint stops before any replacement catalog search', async () => {
  const h = harness();
  await assert.rejects(h.preparation.prepareStockCreation(base, scenes, async (...args) => {
    if (args[2] === 'Corrected visual searches saved — checking exact footage') throw new Error('Fixture disk write failed');
    await h.checkpoint(...args);
  }), /Fixture disk write failed/);
  assert.equal(h.calls.writer.length, 1); assert.equal(h.calls.search.length, 3);
});

test('helper never accepts a changed selected query', async () => {
  const selected = { ...scenes[0], query: replacements[0], footage: footage(50, replacements[0]) };
  const h = harness({ reply: ['different customer conversation', ...replacements.slice(1)] });
  await assert.rejects(h.storyboard.repairUnavailableStockQueries(base, [selected, ...scenes.slice(1)], 1, []), /change selected section/);
  assert.equal(h.calls.writer.length, 1);
});

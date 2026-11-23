const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function load(relative, dependencies) {
  const filename = path.join(project, relative), mod = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports, Error, URL, Promise, Response,
    process: { env: {}, pid: 1 }, require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  return mod.exports;
}
const brief = load('src/lib/stockBrief.ts', {});
const semantics = load('src/lib/footageSemantics.ts', { './stockBrief': brief });
const policy = load('src/lib/newsVisualPolicy.ts', { './stockBrief': brief });
const research = { title: 'Australian author jailed', summary: 'An author pleaded guilty during a court case.', text: 'The report concerns court proceedings.' };
const narration = 'The author was jailed after pleading guilty. The court heard the case earlier this year.';
const input = { topic: research.title, script: narration, duration: 25, aspect: '9:16', research, newsVisualPolicy: policy.NEWS_MIXED_VISUAL_POLICY, scriptOrigin: 'local-model' };
test('one truthful disclosure works for stock, original illustrations and mixed news without claiming an event photograph', () => {
  assert.equal(policy.NEWS_VISUAL_DISCLOSURE, 'Visuals are illustrative.');
  assert.equal(policy.hasNewsVisualDisclosure(policy.NEWS_VISUAL_DISCLOSURE), true);
  assert.equal(policy.hasNewsVisualDisclosure('These are illustrative stock footage.'), true, 'Saved legacy narration remains eligible');
  for (const value of ['Visuals are not illustrative.', 'This is footage of the real event.', 'BBC News reports continuing talks.']) assert.equal(policy.hasNewsVisualDisclosure(value), false);
});
function harness(search = async () => []) {
  const calls = { writer: 0, search: [], checkpoints: [] };
  const writing = { withWritingSession: async work => work(), generateWritingModel: async () => { calls.writer++; assert.fail('New automatic news shot planning must not retry a writer'); } };
  const storyboard = load('src/lib/stockStoryboard.ts', { './footageSemantics': semantics, './writingModel': writing, './newsVisualPolicy': policy });
  const catalog = { searchFootage: async (...args) => { calls.search.push(args); return search(...args); }, selectedFootage: async () => assert.fail('Cached exact assets must be retained') };
  const automatic = load('src/lib/automaticFootage.ts', { './stockCatalog': catalog, './stockBrief': brief, './footageSemantics': semantics, './newsVisualPolicy': policy });
  const preparation = load('src/lib/stockPreparation.ts', { './generation': { createStockScript: async value => value.script }, './stockStoryboard': storyboard,
    './automaticFootage': automatic, './stockCatalog': catalog, './writingModel': writing, './newsVisualPolicy': policy });
  return { calls, storyboard, preparation, checkpoint: async (saved, scenes) => calls.checkpoints.push(plain({ saved, scenes })) };
}

test('new automatic news avoids failed query repair, tries licensed stock then saves exact labelled originals', async () => {
  const h = harness();
  const result = await h.preparation.prepareStockCreation(input, [], h.checkpoint);
  assert.equal(h.calls.writer, 0);
  assert.equal(result.input.script, narration);
  assert.equal(result.scenes.map(scene => scene.narration).join(' '), narration);
  assert.ok(h.calls.search.length > 0 && h.calls.search.length <= 10, 'Bounded stock searches');
  for (const scene of result.scenes) assert.deepEqual(plain(scene.illustration), { kind: 'editorial-2d-v1', subject: 'legal', label: 'Illustration' });
  assert.deepEqual(plain(result.input.storyboard.map(beat => beat.illustration)), plain(result.scenes.map(scene => scene.illustration)));
  const before = h.calls.search.length;
  const resumed = await h.preparation.prepareStockCreation(result.input, result.scenes, h.checkpoint);
  assert.equal(h.calls.search.length, before, 'Resume uses saved illustration identity without repeating searches');
  assert.deepEqual(plain(resumed.input.storyboard), plain(result.input.storyboard));
});

test('eligible distinct stock remains first choice with fallback only for the unavailable section', async () => {
  const stock = { id: 42, duration: 120, width: 720, height: 1280, creator: 'Fixture', sourcePage: 'https://www.pexels.com/video/unbranded-gavel-42/' };
  const h = harness(async query => query === 'gavel' ? [stock] : []);
  const result = await h.preparation.prepareStockCreation(input);
  assert.equal(result.scenes[0].footage.id, 42);
  assert.equal(result.scenes[0].illustration, undefined);
  assert.equal(result.scenes[1].footage, undefined);
  assert.equal(result.scenes[1].illustration.subject, 'legal');
});

test('network and quota failures are preserved instead of becoming illustration success', async () => {
  for (const message of ['Network failed', 'Free quota reached']) {
    const h = harness(async () => { throw new Error(message); });
    await assert.rejects(h.preparation.prepareStockCreation(input), new RegExp(message));
    assert.equal(h.calls.search.length, 1);
  }
});

test('legacy approved news stock guard cannot gain illustration fallback', async () => {
  const h = harness();
  const legacy = { ...input, newsVisualPolicy: policy.NEWS_STOCK_VISUAL_POLICY,
    storyboard: [{ narration, query: 'gavel' }], scriptApproved: true };
  await assert.rejects(h.preparation.prepareStockCreation(legacy), /no distinct.*footage/);
  assert.equal(h.calls.writer, 0);
});

test('fallback subjects follow each supported narration section without people or event reconstruction fields', () => {
  const cases = [
    ['Houthis airstrike reported', 'An airstrike damaged infrastructure.', 'infrastructure'],
    ['Evacuees leave occupied city', 'The railway station remained closed.', 'transport'],
    ['Boat capsizes at sea', 'The coast guard reported a capsized boat.', 'maritime'],
    ['Hospital report published', 'The hospital was inspected.', 'health'],
    ['A report is published', 'The report described the decision.', 'documents'],
  ];
  for (const [title, spoken, subject] of cases) assert.deepEqual(plain(policy.newsEditorialIllustration({ title, summary: spoken, text: spoken }, spoken)), { kind: 'editorial-2d-v1', subject, label: 'Illustration' });
  assert.equal(policy.readNewsIllustration({ kind: 'editorial-2d-v1', subject: 'legal', label: 'Illustration', prompt: 'Invent a courtroom' }), undefined);
});

test('completion accepts only exact approved illustration metadata and rejects stock substitution', () => {
  const h = harness();
  const illustration = policy.newsEditorialIllustration(research, narration);
  const approved = [{ narration, query: policy.newsIllustrationQuery(illustration), illustration }];
  const shot = { ...approved[0], start: 0, end: 25, timing: 'subtitle-boundary', playbackRate: 1 };
  const parsed = h.storyboard.readStockShots([shot], 25, true);
  policy.assertNewsStockRender(policy.NEWS_MIXED_VISUAL_POLICY, approved, parsed);
  for (const change of [{ illustration: { ...illustration, subject: 'transport' } }, { illustration: undefined, sourcePage: 'https://www.pexels.com/video/gavel-42/' }, { query: 'different illustration' }, { narration: 'Rewritten narration.' }, { supplementalReason: 'Extra stock' }]) {
    assert.throws(() => policy.assertNewsStockRender(policy.NEWS_MIXED_VISUAL_POLICY, approved, [{ ...shot, ...change }]), /no review-ready video/);
  }
  assert.throws(() => policy.assertNewsStockRender(policy.NEWS_STOCK_VISUAL_POLICY, approved, [shot]), /no review-ready video/);
  assert.throws(() => h.storyboard.readStockShots([{ ...shot, sourcePage: 'https://www.pexels.com/video/gavel-42/' }], 25, true), /invalid editorial illustration/);
});

test('capability requires explicit supported policy values and distinguishes old renderer', () => {
  const properties = { phoenix_news_visual_policy: { anyOf: [{ enum: [policy.NEWS_STOCK_VISUAL_POLICY, policy.NEWS_MIXED_VISUAL_POLICY], type: 'string' }, { type: 'null' }] } };
  assert.equal(policy.supportsNewsStockVisualPolicy(properties, policy.NEWS_MIXED_VISUAL_POLICY), true);
  assert.equal(policy.supportsNewsStockVisualPolicy(properties), true);
  assert.equal(policy.supportsNewsStockVisualPolicy({ phoenix_news_visual_policy: { const: policy.NEWS_STOCK_VISUAL_POLICY } }, policy.NEWS_MIXED_VISUAL_POLICY), false);
  assert.equal(policy.supportsNewsStockVisualPolicy({ phoenix_news_visual_policy: { type: 'string' } }, policy.NEWS_MIXED_VISUAL_POLICY), false);
});

test('new draft policy and approval snapshot preserve exact original metadata and narration', async () => {
  let saved = [], jobs = [];
  const imports = {
    'node:crypto': require('node:crypto'), 'node:path': path, 'node:fs/promises': { mkdir: async () => {}, readFile: async () => JSON.stringify(saved) },
    './reviewFiles': { reviewRoot: () => 'fixture-only' }, './atomicJson': { writeAtomicJson: async (_name, value) => { saved = plain(value); } }, './fileLock': { withFileLock: async (_name, work) => work() },
    './renderResources': {}, './generation': { createGenerationJobs: async (_owner, values) => { jobs = plain(values); return [{ id: 'fixture-job' }]; } }, './kidsRenderer': {}, './krishnaStory': {}, './qualityManager': {}, './songWriting': {},
    './stockStoryboard': {}, './stockBrief': { stockNarrationError: () => undefined }, './songAudio': {}, './stockCatalog': {}, './localSinging': {}, './hostedSinging': {}, './stockPreparation': {}, './newsVisualPolicy': policy, './writingModel': {},
  };
  const drafts = load('src/lib/creationDrafts.ts', imports);
  const [created] = await drafts.createCreationDrafts([{ ...input, requestId: 'new-request' }]);
  assert.equal(created.input.newsVisualPolicy, policy.NEWS_MIXED_VISUAL_POLICY);
  const illustration = policy.newsEditorialIllustration(research, narration);
  saved[0].status = 'READY'; saved[0].scenes = [{ narration, query: policy.newsIllustrationQuery(illustration), illustration }];
  await drafts.approveCreationDraft(created.id, created.version);
  assert.deepEqual(jobs[0].storyboard, [{ narration, query: policy.newsIllustrationQuery(illustration), illustration: plain(illustration) }]);
  assert.equal(jobs[0].newsVisualPolicy, policy.NEWS_MIXED_VISUAL_POLICY);
  const legacy = { ...saved[0], id: 'old', requestKey: 'legacy:0', input: { ...input, requestId: 'legacy', newsVisualPolicy: undefined }, status: 'FAILED' };
  saved = [legacy];
  const [existing] = await drafts.createCreationDrafts([{ ...input, requestId: 'legacy' }]);
  assert.equal(existing.input.newsVisualPolicy, undefined, 'Existing draft is not silently upgraded');
});

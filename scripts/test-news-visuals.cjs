const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, mock } = require('node:test');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('./mock-model-admission.cjs');
mock.method(require('../src/lib/writingSettings.ts'), 'readWritingSettings', () => ({ provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false }));
const policy = require('../src/lib/newsVisualPolicy.ts');
const storyboard = require('../src/lib/stockStoryboard.ts');
const footage = require('../src/lib/automaticFootage.ts');
const research = {
  id: 'a'.repeat(32), title: 'Boat capsizes near Djibouti', summary: 'A migrant boat capsized at sea near the coast.',
  text: 'Authorities reported deaths after a boat capsized near Djibouti. The circumstances remain under investigation.',
  source: 'BBC News', url: 'https://www.bbc.com/news/articles/abc123', publishedAt: '2026-10-12T00:00:00Z', fetchedAt: '2026-10-12T01:00:00Z', limitation: 'Single source',
};
const choice = (id, slug) => ({ id, duration: 120, width: 720, height: 1280, creator: 'Fixture', sourcePage: `https://www.pexels.com/video/${slug}-${id}/` });
const narration = 'Authorities reported that a boat capsized near Djibouti.';
const input = { topic: research.title, script: narration, duration: 18, research };

test('news queries require relevant neutral filmed context, never literal victims or reenactments', () => {
  for (const query of ['bodies in the water', 'boat capsizing at sea', 'migrant rescue boat', 'cartoon harbor boats', 'beautiful water', 'portrait smiling', 'forest mountain aerial', 'sea forest', 'sea horizon swimming']) {
    assert.ok(policy.newsStockQueryIssue(query, research), query);
  }
  for (const query of ['sea horizon', 'empty harbor boats', 'coastal ship exterior']) assert.equal(policy.newsStockQueryIssue(query, research), undefined, query);
  assert.deepEqual(policy.newsVisualTerms('being above beautiful water outside'), []);
});

test('news ranking rejects unknown, leisure, animated and wrong-setting catalogue results', () => {
  const options = [choice(1, 'breathtaking-waterfall-with-swimmer-in-nature'), choice(2, 'urban-river-boat-bangladesh'), choice(3, ''), choice(4, 'animated-boat-on-ocean-horizon'), choice(5, 'being-outside'), choice(6, 'boat-on-sea-horizon')];
  assert.deepEqual(footage.rankFootage(options, 'boat sea horizon', 15, '9:16', new Set(), undefined, research).map(result => result.choice.id), [6]);
  assert.equal(footage.rankFootage([choice(7, 'calm-ocean-horizon')], 'sea horizon', 15, '9:16', new Set(), undefined, research).length, 1);
  assert.equal(footage.rankFootage([choice(8, 'ordinary-port-boats')], 'harbor boats', 15, '9:16', new Set(), undefined, research).length, 1);
  assert.equal(footage.rankFootage([choice(9, '')], 'harbor boats', 15, '9:16', new Set()).length, 1, 'non-news unknown-title behavior remains unchanged');
});

test('named report identities are not justified by matching catalogue names', () => {
  const politics = { ...research, title: 'Donald Trump announces government changes', summary: 'Political measures were announced by President Donald Trump.', text: 'Donald Trump announced the measures.' };
  assert.ok(policy.newsStockQueryIssue('Donald Trump government building', politics));
  assert.ok(policy.newsFootageMetadataIssue('Donald Trump government building', 'government building', politics));
  assert.equal(policy.newsStockQueryIssue('government building exterior', politics), undefined);
  const surnameOnly = { ...politics, title: 'Trump announces government changes', summary: 'Trump announced the measures.', text: 'Trump announced the measures.' };
  assert.ok(policy.newsStockQueryIssue('Trump government building', surnameOnly));
  assert.ok(policy.newsFootageMetadataIssue('Trump government building', 'government building', surnameOnly));
  const heading = { ...politics, title: 'Government Buildings', summary: 'Politics and Government Buildings', text: 'Government Buildings are discussed in the report.' };
  assert.equal(policy.newsStockQueryIssue('government buildings exterior', heading), undefined, 'neutral multiword headings are not named people');
  assert.equal(policy.newsFootageMetadataIssue('government buildings exterior', 'government building', heading), undefined);
});

test('a report cannot silently use unrelated infrastructure when its theme is unknown', () => {
  const weather = { ...research, title: 'Severe heatwave sweeps France', summary: 'Temperatures rise across France.', text: 'The heatwave affected several cities.' };
  assert.ok(policy.newsStockQueryIssue('airport runway', weather));
  assert.ok(policy.newsFootageMetadataIssue('airport runway', 'airport runway', weather));
  assert.equal(policy.newsStockQueryIssue('city streets', weather), undefined);
  const unknown = { ...research, title: 'A town changes overnight', summary: 'Several streets in the town changed.', text: 'The report concerns the town streets.' };
  assert.ok(policy.newsStockQueryIssue('airport runway', unknown));
  assert.ok(policy.newsStockQueryIssue('town airport runway', unknown));
  assert.equal(policy.newsStockQueryIssue('town streets', unknown), undefined);
  assert.ok(policy.newsStockQueryIssue('portrait smiling', unknown));
});

test('fresh unsafe news queries get one bounded neutral repair without rewriting narration', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    const body = JSON.parse(init.body);
    assert.match(body.prompt, /NEWS VISUAL POLICY/);
    assert.match(body.prompt, /untrusted DATA/);
    calls++;
    return Response.json({ response: JSON.stringify({ queries: [calls === 1 ? 'bodies in the water' : 'sea horizon'] }) });
  };
  try {
    const plan = await storyboard.createStockStoryboard(input);
    assert.deepEqual(plan, [{ narration, query: 'sea horizon' }]);
    assert.equal(calls, 2);
  } finally { global.fetch = originalFetch; }
});

test('malformed news list repair does not permit a third model request for unsafe visuals', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => Response.json({ response: JSON.stringify({ queries: ++calls === 1 ? [] : ['bodies in the water'] }) });
  try {
    await assert.rejects(storyboard.createStockStoryboard(input), /after one repair/);
    assert.equal(calls, 2);
  } finally { global.fetch = originalFetch; }
});

test('unsafe retained plans and explicitly supplied visual terms fail without provider calls', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Retained or owner visuals must not contact a writer'); };
  try {
    await assert.rejects(storyboard.createStockStoryboard({ ...input, storyboard: [{ narration, query: 'bodies in the water' }] }), /unsafe footage was not substituted/);
    await assert.rejects(storyboard.createStockStoryboard({ ...input, visualTerms: ['bodies in the water'] }), /unsafe footage was not substituted/);
    await assert.rejects(footage.selectAutomaticFootage([{ narration, query: 'boat sea horizon', footage: choice(1, 'urban-river-boat-bangladesh') }], 18, '9:16', async () => {}, research), /No approved asset was silently replaced/);
    const retained = await footage.selectAutomaticFootage([{ narration, query: 'sea horizon', footage: choice(2, 'ocean-horizon') }], 18, '9:16', async () => {}, research);
    assert.equal(retained[0].footage.id, 2);
  } finally { global.fetch = originalFetch; }
});

test('shared preparation validates legacy saved scenes even without footage selection', async () => {
  // Isolate the shared preparation boundary: no owner storage, writer or asset
  // search is involved in this legacy-cache regression.
  const module = { exports: {} };
  const imports = {
    './generation': { createStockScript: async value => value.script },
    './stockStoryboard': storyboard, './automaticFootage': footage,
    './stockCatalog': { selectedFootage: async () => { throw new Error('Unexpected asset request'); } },
    './writingModel': { withWritingSession: async work => work() }, './newsVisualPolicy': policy,
  };
  const source = require('typescript').transpileModule(fs.readFileSync(path.join(project, 'src/lib/stockPreparation.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: id => { assert.ok(id in imports, id); return imports[id]; } });
  const stages = [];
  await assert.rejects(module.exports.prepareStockCreation({ ...input, aspect: '9:16' }, [{ narration, query: 'bodies in the water' }], async (saved, scenes, stage) => stages.push({ saved, scenes, stage }), false), /legacy shot/);
  assert.equal(stages[0].saved.script, narration);
  assert.equal(stages.length, 1, 'saved narration survives but unsafe shot is not marked ready');
});

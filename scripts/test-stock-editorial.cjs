const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const project = path.resolve(__dirname, '..');
const originalCwd = process.cwd(), originalFetch = global.fetch, originalModel = process.env.OLLAMA_MODEL;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-editorial-tests-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
require('./mock-model-admission.cjs');
process.chdir(root);
const settings = require('../src/lib/writingSettings.ts');
mock.method(settings, 'readWritingSettings', () => ({ provider: 'ollama', model: process.env.OLLAMA_MODEL || 'fixture:local', freePlanConfirmed: false }));
const editor = require(path.join(project, 'src/lib/stockEditorial.ts'));
const { createStockScript } = require(path.join(project, 'src/lib/generation.ts'));
const script = 'Replace a vague task with a small action you can actually finish. Suppose your list says organize the kitchen, but you keep walking past it because the job feels too big. Choose just one drawer and name what you will do there. Write put the loose spoons into the tray instead of organize everything. Open that drawer and move those spoons, leaving the other cupboards for another time. Now you can tell whether the action is finished by looking at the empty space beside the tray. If another object needs a home, write that as a separate action instead of silently expanding this one. A small next step does not solve the whole kitchen. It gives you a clear place to begin and a visible stopping point for today.';
const brief = { topic: 'Turn a vague task into a next action', duration: 45, script, feedbackRevision: 'review-one' };
const criteria = ['topicAnswer', 'directOpening', 'consistentFacts', 'causalOrder', 'specificTakeaway', 'filmableActions'];
const verdict = (changes = {}) => Object.fromEntries(criteria.map(criterion => [criterion, { passed: true, evidence: 'Choose just one drawer', reason: 'The example identifies one specific action and preserves the same setting.', ...changes[criterion] }]));
function responses(items) {
  let count = 0;
  global.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(JSON.parse(init.body).options.num_thread, 2);
    assert.ok(count < items.length, 'Unexpected additional model call');
    const item = items[count++];
    if (item instanceof Error) throw item;
    return Response.json({ response: JSON.stringify(item) });
  };
  return () => count;
}
after(() => { global.fetch = originalFetch; if (originalModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = originalModel; process.chdir(originalCwd); fs.rmSync(root, { recursive: true, force: true }); });

test('approval retains grounded findings and caches only the same model/policy/feedback', async () => {
  const count = responses([verdict(), verdict()]); const history = [];
  const result = await editor.editStockNarration(brief, async () => {}, async attempt => history.push(attempt));
  assert.equal(history.length, 1); assert.equal(history[0].script, script);
  assert.equal(result.editorial.findings.length, 6);
  await editor.editStockNarration({ ...brief, editorial: result.editorial });
  assert.equal(count(), 1);
  await editor.editStockNarration({ ...brief, editorial: result.editorial, feedbackRevision: 'review-two' });
  assert.equal(count(), 2);
  const before = editor.editorialFingerprint(brief);
  process.env.OLLAMA_MODEL = 'test-model'; assert.notEqual(editor.editorialFingerprint(brief), before);
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = originalModel;
});

test('fabricated evidence cannot approve a script and the failed attempt is saved', async () => {
  const invalid = verdict({ topicAnswer: { evidence: 'This phrase was never spoken.' } });
  const count = responses([invalid, invalid]);
  const history = [];
  await assert.rejects(editor.editStockNarration(brief, async () => {}, async attempt => history.push(attempt)), /invented evidence/);
  assert.equal(count(), 2); assert.equal(history.length, 2); assert.match(history[0].error, /topicAnswer/); assert.equal(history[0].script, script);
});

test('invalid causal-order review is corrected once without rewriting narration', async () => {
  const history = [], prompts = [], stages = [];
  const invalid = verdict({ causalOrder: { evidence: 'Invented combined quotation.' } });
  global.fetch = async (_, init) => {
    const body = JSON.parse(init.body); prompts.push(body.prompt);
    return Response.json({ response: JSON.stringify(prompts.length === 1 ? invalid : verdict()) });
  };
  const result = await editor.editStockNarration(brief, async stage => stages.push(stage), async attempt => history.push(attempt));
  assert.equal(prompts.length, 2); assert.match(prompts[1], /causalOrder/);
  assert.match(prompts[1], /Correct the REVIEW only/);
  assert.equal(result.script, script); assert.equal(result.editorial.revised, false);
  assert.equal(history.length, 2); assert.match(history[0].error, /non-verbatim/);
  assert.equal(history[1].findings.length, 6);
  assert.ok(stages.some(stage => stage.includes('Correcting the editor response once')));
});

test('review shape, quote length and missing evidence are repaired with specific feedback', async () => {
  for (const [change, feedback] of [
    [{ evidence: '' }, /nonempty/],
    [{ evidence: 'x'.repeat(221) }, /220 characters/],
    [{ reason: 'x' }, /3–350/],
    [{ passed: 'yes' }, /boolean/],
  ]) {
    let calls = 0;
    global.fetch = async (_, init) => {
      calls++;
      if (calls === 2) assert.match(JSON.parse(init.body).prompt, feedback);
      return Response.json({ response: JSON.stringify(calls === 1 ? verdict({ causalOrder: change }) : verdict()) });
    };
    assert.equal((await editor.editStockNarration(brief)).script, script);
    assert.equal(calls, 2);
  }
});

test('incomplete review JSON has one bounded correction', async () => {
  let calls = 0;
  global.fetch = async () => Response.json({ response: ++calls === 1 ? '{"unfinished":' : JSON.stringify(verdict()) });
  assert.equal((await editor.editStockNarration(brief)).script, script);
  assert.equal(calls, 2);
});

test('evidence IDs resolve only to actual bounded narration excerpts', async () => {
  const excerpts = editor.editorialExcerpts(script);
  for (const quote of Object.values(excerpts)) { assert.ok(script.includes(quote)); assert.ok(quote.length <= 220); }
  const count = responses([verdict(Object.fromEntries(criteria.map(key => [key, { evidence: 'E1' }])))]);
  const result = await editor.editStockNarration(brief);
  assert.equal(count(), 1);
  assert.ok(result.editorial.findings.every(item => item.evidence === excerpts.E1));
  const unknown = verdict({ causalOrder: { evidence: 'E999999' } });
  const rejected = responses([unknown, unknown]);
  await assert.rejects(editor.editStockNarration(brief), /reference is not in/);
  assert.equal(rejected(), 2);
  const long = editor.editorialExcerpts('a'.repeat(500) + '.');
  assert.ok(Object.values(long).every(quote => quote.length <= 200));
});

test('oversized generated rewrite receives one length correction and a full re-review', async () => {
  const bad = verdict({ specificTakeaway: { passed: false, evidence: '', reason: 'The promised ending is missing.' } });
  const tooLong = script + ' ' + Array(30).fill('extra').join(' ') + '.';
  const count = responses([bad, { script: tooLong }, { script }, verdict()]);
  const result = await editor.editStockNarration(brief);
  assert.equal(count(), 4); assert.equal(result.script, script);
  const bounded = responses([bad, { script: tooLong }, { script: tooLong }, verdict()]);
  await assert.rejects(editor.editStockNarration(brief), /words/);
  assert.equal(bounded(), 4, 'no endless length repairs or silent truncation');
});

test('provider, configuration and quota errors are never retried as review corrections', async () => {
  const writer = require('../src/lib/writingModel.ts');
  const { WritingWaitError, WritingConfigurationError } = require('../src/lib/groqWriter.ts');
  const original = writer.generateWritingModel;
  try {
    for (const failure of [new Error('Transport failed'), new WritingWaitError('Quota wait', 60000), new WritingConfigurationError('Settings changed')]) {
      for (const duringRepair of [false, true]) {
        let calls = 0;
        writer.generateWritingModel = async () => {
          calls++;
          if (duringRepair && calls === 1) return Response.json({ response: JSON.stringify(verdict({ causalOrder: { evidence: '' } })) });
          throw failure;
        };
        await assert.rejects(editor.editStockNarration(brief), error => error === failure);
        assert.equal(calls, duringRepair ? 2 : 1);
      }
    }
  } finally { writer.generateWritingModel = original; }
});

test('corrected review still rejects genuine meaning failures', async () => {
  const invalid = verdict({ causalOrder: { evidence: '' } });
  const bad = verdict({ causalOrder: { passed: false, evidence: '', reason: 'Actions do not follow their prerequisites.' } });
  const count = responses([invalid, bad, { script }, bad]);
  await assert.rejects(editor.editStockNarration(brief), /Actions do not follow/);
  assert.equal(count(), 4);
});

test('a meaning failure triggers exactly one rewrite then blocks if still unresolved', async () => {
  const bad = verdict({ topicAnswer: { passed: false, evidence: '', reason: 'The promised action is missing.' } });
  const count = responses([bad, { script }, bad]); const history = [];
  await assert.rejects(editor.editStockNarration(brief, async () => {}, async attempt => history.push(attempt)), /promised action is missing/);
  assert.equal(count(), 3); assert.equal(history.length, 2);
});

test('subjective visual advice remains a visible warning after the bounded rewrite', async () => {
  const warning = verdict({ filmableActions: { passed: false, evidence: 'A small next step', reason: 'This line may need an explanatory graphic rather than illustrative stock.' } });
  const count = responses([warning, { script }, warning]);
  const result = await editor.editStockNarration(brief);
  assert.equal(count(), 3); assert.equal(result.editorial.warnings.length, 1);
  assert.match(result.editorial.warnings[0], /explanatory graphic/);
});

test('literal rainy weather and rocket science are not banned topics', () => {
  assert.deepEqual(editor.editorialIssues('A rainy day leaves drops on the window. Rocket science studies propulsion.'), []);
});

test('the bounded rewrite retains selected feedback and fingerprints its actual rules', async () => {
  const previous=global.fetch;
  const guidanceRules=['Each beat adds new information; remove repeated motivational filler.'];
  const bad=verdict({specificTakeaway:{passed:false,evidence:'',reason:'The ending does not answer the opening.'}});
  let calls=0;
  global.fetch=async(_,init)=>{
    const body=JSON.parse(init.body); calls++;
    if(calls===1){assert.ok(body.prompt.includes(guidanceRules[0]));return Response.json({response:JSON.stringify(bad)});}
    if(calls===2){assert.ok(body.prompt.includes(guidanceRules[0]));return Response.json({response:JSON.stringify({script})});}
    return Response.json({response:JSON.stringify(verdict())});
  };
  try {
    const result=await editor.editStockNarration({...brief,guidanceRules});
    assert.equal(result.editorial.revised,true);assert.equal(calls,3);
    assert.notEqual(editor.editorialFingerprint(brief),editor.editorialFingerprint({...brief,guidanceRules}));
  } finally {global.fetch=previous;}
});

test('generation checkpoints retain rejected model narration and history on failure', async () => {
  const bad = verdict({ consistentFacts: { passed: false, evidence: '', reason: 'The setup contradicts the claimed outcome.' } });
  responses([bad, { script }, bad]);
  const input = { ...brief, scriptOrigin: 'local-model', creationType: 'general' };
  const snapshots = [];
  await assert.rejects(createStockScript(input, async () => snapshots.push(structuredClone(input))), /contradicts/);
  assert.equal(input.editorialAttempts.length, 2);
  assert.equal(snapshots.at(-1).editorialAttempts.length, 2);
  assert.equal(snapshots.at(-1).script, script);
});

test('owner narration never enters automatic rewriting', async () => {
  global.fetch = async () => { throw new Error('Owner text must not be sent for rewriting'); };
  const input = { ...brief, scriptOrigin: 'owner', creationType: 'general' };
  assert.equal(await createStockScript(input), script);
  assert.equal(input.editorialAttempts, undefined);
});

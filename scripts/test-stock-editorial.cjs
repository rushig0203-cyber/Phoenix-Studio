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

test('engagement bait is a visible editorial issue while a concrete question is allowed', () => {
  assert.match(editor.editorialIssues("You won't believe this. Watch until the end.").join(' '), /engagement bait/);
  assert.deepEqual(editor.editorialIssues('Why does this shadow get longer? The light reaches the ground from a lower angle.'), []);
});

test('honest visual provenance is allowed without hiding actual production instructions', () => {
  assert.deepEqual(editor.editorialIssues('BBC News reports continuing talks. The visuals are illustrative stock footage, not images of the reported event.'), []);
  assert.match(editor.editorialIssues('The visuals are illustrative stock footage; the camera shows a skyline.').join(' '), /production instructions/);
  assert.match(editor.editorialIssues('Use stock footage of an office for this narration.').join(' '), /production instructions/);
});

test('business writing retains feasible visuals and the reviewer evaluates the promised payoff with real evidence', async () => {
  const outline = {
    viewerQuestion: 'How can a repair update give a customer a useful next step?', audience: 'Repair shop owners',
    angles: [
      { angle: 'Compare a vague update with an actionable update', value: 'Give the customer a clear status and next check.' },
      { angle: 'Explain why an expected date needs a condition', value: 'Keep the message honest when a part is delayed.' },
      { angle: 'Show the information to gather before calling', value: 'Separate known facts from an estimate.' },
    ], selectedAngle: 0, structure: 'comparison', opening: 'A vague task is easier to act on when its next action is named.',
    beats: [
      { point: 'Name the specific situation instead of making a broad promise.', visual: 'Hands writing a repair note in a notebook.' },
      { point: 'Give one next action and the condition it depends on.', visual: 'A mechanic checks a replacement component.' },
      { point: 'State when the next update will happen.', visual: 'A person making an illustrative phone call.' },
    ], payoff: 'A useful update gives a status, next action and next check.', avoid: ['Do not claim the catalogue actor is the actual customer.'],
  };
  const prompts = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); prompts.push(body.prompt);
    if (prompts.length === 1) return Response.json({ response: JSON.stringify(outline) });
    if (prompts.length === 2) {
      assert.match(body.prompt, /specific customer or working problem/);
      assert.match(body.prompt, /do not claim personal travel, testing, ownership or experience/);
      assert.match(body.prompt, /visualConstraints/);
      assert.ok(body.prompt.includes(outline.beats[0].visual));
      return Response.json({ response: script });
    }
    assert.match(body.prompt, /without treating them as evidence/);
    assert.match(body.prompt, /first sentence/);
    assert.match(body.prompt, /exact opening promise/);
    assert.match(body.prompt, /real-person quotations/);
    return Response.json({ response: JSON.stringify(verdict()) });
  };
  const input = { topic: 'Repair updates with a clear next action', duration: 45, creationType: 'business' };
  assert.equal(await createStockScript(input), script);
  assert.equal(prompts.length, 3);
  assert.equal(input.editorial.version, 5);
  assert.ok(input.editorial.findings.every(finding => script.includes(finding.evidence)));
  assert.notEqual(editor.editorialFingerprint(brief), editor.editorialFingerprint({ ...brief, creationType: 'business' }));
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
test('automatic dog narration rejects camera inventories and first-person directions, preserving explicit filmmaking',()=>{
  const topic='A dog exploring the park';
  for(const line of [
    'The video opens with a close‑up of the dog’s excited face.',
    'The camera, mounted on a harness, shifts to a first‑person view.',
    'The camera tilts to capture the thump of paws against the seat.',
    'This shows how a GoPro or phone on a harness can turn a walk into an adventure.',
    'You will learn how to film a dog exploring the park.',
  ]) assert.match(editor.editorialIssues(line,topic,'general').join(' '),/production instructions/,line);
  assert.deepEqual(editor.editorialIssues('A curious dog pauses to sniff the leaves before moving on.',topic,'general'),[]);
  assert.deepEqual(editor.editorialIssues('The camera pans slowly to keep the dog in view.','How to film a dog exploring the park','general'),[]);
  assert.deepEqual(editor.editorialIssues('The camera pans across two friends.','Two friends share a ball','children-story'),[]);
});
test('local camera guard blocks generated narration even when the model review passes',async()=>{
  const cameraScript=script.replace('Replace a vague task with a small action you can actually finish.','The video opens with a close-up of a dog exploring the park.');
  const count=responses([verdict(),{script:cameraScript},verdict()]);
  await assert.rejects(editor.editStockNarration({...brief,topic:'A dog exploring the park',creationType:'general',script:cameraScript}),/production instructions/);
  assert.equal(count(),3,'One rewrite and re-review, without accepting the repeated camera script');
});
test('explicit owner camera narration is retained without automatic editorial requests',async()=>{
  const ownerScript=script.replace('Replace a vague task with a small action you can actually finish.','The video opens with a close-up of a dog exploring the park.');
  global.fetch=async()=>assert.fail('Owner text must not be sent to a provider');
  const input={...brief,topic:'A dog exploring the park',creationType:'general',script:ownerScript,scriptOrigin:'owner'};
  assert.equal(await createStockScript(input),ownerScript);assert.equal(input.editorialAttempts,undefined);
});

test('quota waits resume each editorial phase without repeating completed provider work', async () => {
  const writer = require('../src/lib/writingModel.ts'), original = writer.generateWritingModel;
  const { WritingWaitError } = require('../src/lib/groqWriter.ts');
  const bad = verdict({ specificTakeaway: { passed: false, evidence: '', reason: 'The promised ending is missing.' } });
  const oversized = script + ' ' + Array(35).fill('extra').join(' ') + '.';
  try {
    for (const phase of ['rewrite', 'length-correction', 'final-review']) {
      const input = { ...brief }, calls = [], history = [];
      let outputs = phase === 'rewrite' ? [bad, new WritingWaitError('quota', 60000)]
        : phase === 'length-correction' ? [bad, {script: oversized}, new WritingWaitError('quota', 60000)]
        : [bad, {script}, new WritingWaitError('quota', 60000)];
      writer.generateWritingModel = async body => {
        calls.push(body.prompt);
        assert.ok(outputs.length, 'No unplanned repeated stage is allowed');
        const value = outputs.shift(); if(value instanceof Error) throw value;
        return Response.json({response:JSON.stringify(value)});
      };
      const attempt = async value => {history.push(value); input.editorialAttempts = [...history];};
      const checkpoint = async value => {input.editorialCheckpoint = value; if(value) input.script = value.script;};
      await assert.rejects(editor.editStockNarration(input, async()=>{}, attempt, checkpoint), WritingWaitError);
      assert.equal(input.editorialCheckpoint.phase, phase);
      const before = calls.length;
      outputs = phase === 'rewrite' ? [{script}, verdict()] : phase === 'length-correction' ? [{script}, verdict()] : [verdict()];
      const result = await editor.editStockNarration(input, async()=>{}, attempt, checkpoint);
      assert.equal(result.script, script); assert.equal(result.editorial.revised, true);
      assert.equal(calls.length - before, phase === 'final-review' ? 1 : 2);
      assert.equal(input.editorialCheckpoint, undefined);
      if(phase==='length-correction') assert.match(calls[before], /Correct only the length/);
      if(phase==='final-review') assert.match(calls[before], /Act as a careful script editor/);
    }
  } finally { writer.generateWritingModel = original; }
});

test('retained preliminary findings require exact context, six real findings and current local guards', async () => {
  const history=[]; responses([verdict()]);
  await editor.editStockNarration(brief, async()=>{}, async attempt=>history.push(attempt));
  const saved=structuredClone(history[0]);
  const cached=responses([]);
  assert.equal((await editor.editStockNarration({...brief,editorialAttempts:[saved]})).script,script);assert.equal(cached(),0);
  for(const mutate of [
    input=>{input.duration=46;}, input=>{input.feedbackRevision='new';},input=>{input.guidanceRules=['Different rule'];},
    input=>{input.script=script+' Read the result aloud.';},input=>{input.editorialAttempts[0].error='failed';},
    input=>{input.editorialAttempts[0].findings=[];},input=>{input.editorialAttempts[0].findings[0].evidence='Invented quotation';},
    input=>{input.editorialAttempts[0].findings[0].severity='warning';},
    input=>{input.editorialAttempts[0].findings=[null];},
    input=>{input.editorialAttempts=[null];},
  ]) {
    const input={...brief,editorialAttempts:[structuredClone(saved)]}; mutate(input);
    const count=responses([verdict()]); await editor.editStockNarration(input); assert.equal(count(),1);
  }
  const short='Name a small task and stop. '+script.split(' ').slice(0,40).join(' ')+'.';
  const input={...brief,script:short};
  const forged={...saved,script:short,fingerprint:editor.editorialFingerprint(input)};
  forged.findings=forged.findings.map(item=>({...item,evidence:'Name a small task'}));
  const count=responses([{script},verdict()]);
  assert.equal((await editor.editStockNarration({...input,editorialAttempts:[forged]})).script,script);
  assert.equal(count(),2,'local length failure is recomputed even with matching saved model findings');
});

test('malformed review correction survives quota without starting another initial review', async () => {
  const writer=require('../src/lib/writingModel.ts'),original=writer.generateWritingModel;
  const {WritingWaitError,WritingOutputValidationError}=require('../src/lib/groqWriter.ts');
  try {
    for(const invalid of [verdict({causalOrder:{evidence:''}}),new WritingOutputValidationError('fixed category')]){
      const input={...brief},history=[],prompts=[];
      let values=[invalid,new WritingWaitError('quota',60000)];
      writer.generateWritingModel=async body=>{
        prompts.push(body.prompt);assert.ok(values.length);const value=values.shift();
        if(value instanceof Error)throw value;return Response.json({response:JSON.stringify(value)});
      };
      const save=async checkpoint=>{input.editorialCheckpoint=checkpoint;};
      const attempt=async value=>{history.push(value);input.editorialAttempts=history;};
      await assert.rejects(editor.editStockNarration(input,async()=>{},attempt,save),WritingWaitError);
      assert.equal(input.editorialCheckpoint.phase,'initial-review');assert.ok(input.editorialCheckpoint.reviewCorrection);
      values=[verdict()];
      const result=await editor.editStockNarration(input,async()=>{},attempt,save);
      assert.equal(result.script,script);assert.equal(prompts.length,3);assert.match(prompts[2],/Correct the REVIEW only/);
    }
  } finally {writer.generateWritingModel=original;}
});

test('generation saves revised narration and invalidates stale visuals before a quota wait', async () => {
  const writer=require('../src/lib/writingModel.ts'),original=writer.generateWritingModel;
  const {WritingWaitError}=require('../src/lib/groqWriter.ts');
  const revised=script.replace('loose spoons','clean spoons'), snapshots=[];
  const input={...brief,scriptOrigin:'local-model',creationType:'general',storyboard:[{marker:'old'}],stockPreparation:{marker:'old'},visualTerms:['old'],visualTermsOrigin:'local-model'};
  const bad=verdict({topicAnswer:{passed:false,evidence:'',reason:'The topic needs a clearer action.'}});
  let values=[bad,{script:revised},new WritingWaitError('quota',60000)];
  writer.generateWritingModel=async()=>{assert.ok(values.length);const value=values.shift();if(value instanceof Error)throw value;return Response.json({response:JSON.stringify(value)});};
  try {
    await assert.rejects(createStockScript(input,async()=>snapshots.push(structuredClone(input))),WritingWaitError);
    assert.equal(input.script,revised);assert.equal(input.editorialCheckpoint.phase,'final-review');
    assert.equal(input.storyboard,undefined);assert.equal(input.stockPreparation,undefined);assert.equal(input.visualTerms,undefined);
    assert.ok(snapshots.some(snapshot=>snapshot.script===revised&&snapshot.editorialCheckpoint?.phase==='length-correction'));
    values=[verdict()];assert.equal(await createStockScript(input,async()=>snapshots.push(structuredClone(input))),revised);assert.equal(input.editorialCheckpoint,undefined);
    assert.ok(snapshots.some(snapshot=>snapshot.editorial?.revised===true&&!snapshot.editorialCheckpoint),'phase removal and approved verdict are persisted together');
  } finally {writer.generateWritingModel=original;}
});

test('a completed final review survives an interrupted final checkpoint write', async()=>{
  const history=[],input={...brief};
  responses([verdict({topicAnswer:{passed:false,evidence:'',reason:'A clearer action is required.'}}),{script},verdict()]);
  await assert.rejects(editor.editStockNarration(input,async()=>{},async attempt=>{
    history.push(attempt);input.editorialAttempts=[...history];
  },async checkpoint=>{
    if(!checkpoint)throw new Error('Disk interrupted');
    input.editorialCheckpoint=checkpoint;input.script=checkpoint.script;
  }),/Disk interrupted/);
  assert.equal(input.editorialCheckpoint.phase,'final-review');
  const count=responses([]);
  const resumed=await editor.editStockNarration(input);
  assert.equal(resumed.editorial.revised,true);assert.equal(count(),0,'validated final evidence is retained, not requested again');
});

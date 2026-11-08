const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-approval-test-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
require('./mock-model-admission.cjs');
process.chdir(temporary);
const drafts = require(path.join(project, 'src/lib/creationDrafts.ts'));
const generation = require(path.join(project, 'src/lib/generation.ts'));
const api = require(path.join(project, 'src/app/api/creation-drafts/route.ts'));
const singing = require(path.join(project, 'src/lib/localSinging.ts'));
const catalog = require(path.join(project, 'src/lib/stockCatalog.ts'));
const { createContent } = require(path.join(project, 'src/lib/kidsRenderer.ts'));
const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
const file = path.join(root, 'creation-drafts.json');
const realFetch = global.fetch;

test('news mode rejects custom-script bypass and children workflows before provider calls', async () => {
  const route = require(path.join(project, 'src/app/api/generations/route.ts'));
  for (const data of [{ creationType: 'children-story' }, { creationType: 'general', script: 'Custom narration' }, { creationType: 'general', visualTerms: ['random beach'] }]) {
    const response = await route.POST(new Request('http://localhost:3000/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ topic: 'A report', newsId: 'a'.repeat(32), ...data }) }));
    assert.equal(response.status, 400);
  }
});
const script = Array(12).fill('Open the curtains and let daylight into your room before you reach for your phone.').join(' ');
const input = () => ({ reviewMode: 'storyboard', requestId: crypto.randomUUID(), topic: 'Calm morning', script, visualTerms: ['opening curtains', 'writing morning plan'], language: 'English', duration: 75, aspect: '9:16', voice: 'local-windows-voice', subtitleStyle: 'clear', visualSource: 'stock', targetPlatform: 'YouTube', publishingFormat: 'youtube-short', creationType: 'general' });
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = value => fs.writeFileSync(file, JSON.stringify(value));
const fixture = id => ({ id, duration: 120, image: 'https://images.pexels.com/videos/123/preview.jpeg', url: `https://www.pexels.com/video/${id}/`, user: { name: 'Fixture creator' }, video_files: [{ file_type: 'video/mp4', width: 720, height: 1280, link: `https://videos.pexels.com/video-files/${id}/720.mp4` }] });
beforeEach(() => { fs.mkdirSync(root, { recursive: true }); write([]); fs.writeFileSync(path.join(root, 'ai-creation-jobs.json'), '[]'); global.fetch = async () => { throw new Error('Unexpected network call'); }; });
afterEach(() => { global.fetch = realFetch; delete process.env.PHOENIX_ACE_URL; });
after(() => { process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

async function ready() { const [draft] = await drafts.createCreationDrafts([input()]); await drafts.processNextCreationDraft(); return read().find(d => d.id === draft.id); }
async function withFootage() {
  process.env.PEXELS_API_KEY = 'fixture-not-a-real-key';
  global.fetch = async url => Response.json(fixture(Number(String(url).split('/').pop())));
  let draft = await ready();
  for (let index = 0; index < draft.scenes.length; index++) draft = await drafts.chooseDraftFootage(draft.id, draft.version, index, index + 100);
  return draft;
}

test('planning persists a complete editable draft without rendering or submitting provider jobs', async () => {
  const draft = await ready();
  assert.equal(draft.status, 'READY');
  assert.equal(draft.scenes.map(s => s.narration).join(' '), script);
  assert.equal((await generation.listGenerationJobs()).length, 0);
});

test('final-review stock creation selects distinct exact assets and queues without human scene approval', async () => {
  process.env.PEXELS_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  global.fetch = async url => {
    assert.equal(new URL(url).hostname, 'api.pexels.com');
    calls++;
    return Response.json({ videos: [fixture(101), fixture(102)] });
  };
  await drafts.createCreationDrafts([{ ...input(), reviewMode: 'final' }]);
  await drafts.processNextCreationDraft();
  const item = read()[0];
  assert.equal(item.status, 'APPROVED');
  assert.match(item.stage, /Automatically/);
  const jobs = await generation.listGenerationJobs();
  assert.equal(jobs.length, 1);
  const request = JSON.parse(jobs[0].requestJson);
  assert.equal(request.script, script);
  assert.equal(request.scriptApproved, false);
  assert.equal(request.scriptLocked, true);
  assert.deepEqual(request.storyboard.map(beat => beat.assetId), [101, 102]);
  assert.equal(calls, 2);
  assert.equal(request.stockPreparation.scenes[0].footage.id,101);
  const {prepareStockCreation}=require('../src/lib/stockPreparation.ts');
  global.fetch=async()=>{throw new Error('Completed preparation must not search again');};
  const reentered=await prepareStockCreation(request,request.stockPreparation.scenes);
  assert.deepEqual(reentered.input.storyboard.map(beat=>beat.assetId),[101,102]);
  await drafts.processNextCreationDraft();
  assert.equal((await generation.listGenerationJobs()).length, 1);
});
test('generation entry point shares exact-asset preparation and persists before an interrupted search', async () => {
  process.env.PEXELS_API_KEY='fixture-not-a-real-key';
  const {prepareStockCreation}=require('../src/lib/stockPreparation.ts');
  let calls=0, checkpoint;
  global.fetch=async()=>{if(++calls===2)throw new Error('Interrupted');return Response.json({videos:[fixture(401),fixture(402)]});};
  await assert.rejects(prepareStockCreation(input(),[],async(saved,scenes)=>{checkpoint=structuredClone({saved,scenes});}),/Interrupted/);
  assert.equal(checkpoint.saved.script,script);assert.equal(checkpoint.scenes[0].footage.id,401);
  global.fetch=async()=>Response.json({videos:[fixture(401),fixture(402)]});
  const resumed=await prepareStockCreation(checkpoint.saved,checkpoint.saved.stockPreparation.scenes);
  assert.deepEqual(resumed.input.storyboard.map(beat=>beat.assetId),[401,402]);
});
test('legacy owner-selected asset IDs are restored without substitution searches', async () => {
  process.env.PEXELS_API_KEY='fixture-not-a-real-key';
  const {prepareStockCreation}=require('../src/lib/stockPreparation.ts');
  const supplied={...input(),storyboard:[{narration:script,query:'opening curtains',assetId:501}]};
  global.fetch=async url=>{assert.ok(String(url).endsWith('/501'));return Response.json(fixture(501));};
  const prepared=await prepareStockCreation(supplied);
  assert.equal(prepared.input.storyboard[0].assetId,501);assert.equal(prepared.input.script,script);
});

test('a cached automatic shot mismatch cannot bypass validation or silently replace selected assets',async()=>{
  const {prepareStockCreation}=require('../src/lib/stockPreparation.ts'),originalScript=generation.createStockScript;
  const narration='Use a scale to measure the coffee beans.',scenes=[{narration,query:'Grinding coffee beans',footage:{id:501}}];
  const request={...input(),script:narration,scriptOrigin:'local-model',visualTermsOrigin:'local-model'};
  const before=structuredClone({request,scenes});generation.createStockScript=async()=>narration;
  try{await assert.rejects(prepareStockCreation(request,scenes,async()=>{},false),/Saved section 1.*different narrated action/);assert.deepEqual({request,scenes},before);}
  finally{generation.createStockScript=originalScript;}
});

test('failed automatic selection retains earlier scenes and retry resumes without duplicate exports', async () => {
  process.env.PEXELS_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  global.fetch = async () => { if (++calls === 2) throw new Error('Search interrupted'); return Response.json({ videos: [fixture(101), fixture(102)] }); };
  await drafts.createCreationDrafts([{ ...input(), reviewMode: 'final' }]);
  await drafts.processNextCreationDraft();
  let item = read()[0];
  assert.equal(item.status, 'FAILED');
  assert.equal(item.scenes[0].footage.id, 101);
  assert.match(item.error, /Search interrupted/);
  assert.equal((await generation.listGenerationJobs()).length, 0);
  await drafts.changeDraftStatus(item.id, item.version, 'retry');
  await drafts.processNextCreationDraft();
  item = read()[0];
  assert.equal(item.status, 'APPROVED');
  assert.equal(calls, 3);
  // Simulate the process stopping between creating the render job and saving its ID.
  write([{ ...item, status: 'APPROVING', approvedJobId: undefined }]);
  await drafts.processNextCreationDraft();
  assert.equal(read()[0].approvedJobId, item.approvedJobId);
  assert.equal((await generation.listGenerationJobs()).length, 1);
});

test('explicit recovery invalidates passing initial and rejected final stock reviews before adapting concise narration', async () => {
  const editor = require('../src/lib/stockEditorial.ts');
  const savedScript = 'Start with one small task you can finish before moving to the next. Suppose a kitchen drawer holds loose spoons beside cups and folded towels. Choose that drawer rather than promising to organize the whole room. Place the spoons in a tray and leave the towels together on the other side. Move only the objects needed for this task, so the work does not expand into every cupboard. When the drawer closes without catching, check what still needs a home. Write that as a separate task for another day. You now have a clear result and a sensible stopping point.';
  const [draft] = await drafts.createCreationDrafts([{ ...input(), topic: 'Organize one kitchen drawer', duration: 75, script: savedScript, scriptOrigin: 'local-model' }]);
  assert.match(require('../src/lib/stockBrief.ts').stockNarrationError(savedScript, 75), /words/);
  const criteria = ['topicAnswer', 'directOpening', 'consistentFacts', 'causalOrder', 'specificTakeaway', 'filmableActions'];
  const verdict = passed => Object.fromEntries(criteria.map(criterion => [criterion, { passed: passed || criterion !== 'causalOrder', evidence: passed || criterion !== 'causalOrder' ? 'E1' : '', reason: passed || criterion !== 'causalOrder' ? 'The narration gives one useful action and a complete payoff.' : 'The prerequisite for this action is missing.' }]));
  const fingerprint = editor.editorialFingerprint(draft.input);
  const failedFindings = criteria.map(criterion => ({ criterion, passed: criterion !== 'causalOrder', severity: ['directOpening', 'filmableActions'].includes(criterion) ? 'warning' : 'blocker', evidence: criterion !== 'causalOrder' ? 'Start with one small task' : '', reason: criterion !== 'causalOrder' ? 'The narration gives one useful action and a complete payoff.' : 'The prerequisite for this action is missing.' }));
  const initialAttempt = { at: draft.createdAt, fingerprint, script: savedScript, phase: 'initial-review', findings: failedFindings.map(finding => ({ ...finding, passed: true, evidence: 'Start with one small task', reason: 'The narration gives one useful action and a complete payoff.' })) };
  const attempt = { at: draft.createdAt, fingerprint, script: savedScript, phase: 'final-review', findings: failedFindings };
  const rejected = { ...draft, status: 'FAILED', error: 'The prerequisite for this action is missing.', input: { ...draft.input, editorialAttempts: [initialAttempt, attempt], editorialCheckpoint: { version: 1, fingerprint, script: savedScript, phase: 'final-review', revised: true } } };
  write([rejected]);
  await assert.rejects(editor.editStockNarration(rejected.input), /prerequisite/);
  const response = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'http://localhost' }, body: JSON.stringify({ id: draft.id, version: draft.version, action: 'retry' }) }));
  assert.equal(response.status, 200);
  const recovered = read()[0];
  assert.equal(recovered.status, 'QUEUED'); assert.equal(recovered.input.script, savedScript);
  assert.equal(recovered.input.editorialCheckpoint, undefined);
  assert.deepEqual(recovered.input.editorialAttempts.slice(0, 2), [initialAttempt, attempt]);
  assert.equal(recovered.input.editorialAttempts.length, 4);
  assert.deepEqual(recovered.input.editorialAttempts.slice(2).map(attempt => attempt.phase), ['initial-review', 'final-review']);
  assert.ok(recovered.input.editorialAttempts.slice(2).every(attempt => /Explicit retry invalidated/.test(attempt.error)));
  let calls = 0, completed;
  global.fetch = async (_url, init) => {
    calls++;
    if (calls === 2) { assert.match(JSON.parse(init.body).prompt, /Rewrite this narration/); return Response.json({ response: JSON.stringify({ script: savedScript }) }); }
    if (calls === 3) { assert.match(JSON.parse(init.body).prompt, /Correct only the length/); return Response.json({ response: JSON.stringify({ script: savedScript }) }); }
    return Response.json({ response: JSON.stringify(verdict(calls === 4)) });
  };
  const result = await editor.editStockNarration(recovered.input, async () => {}, async () => {}, async (_checkpoint, result) => { if (result) completed = result; });
  assert.equal(result.script, savedScript); assert.equal(calls, 4, 'Old passing initial evidence must not bypass a later final blocker or the fresh final check');
  assert.ok(completed.duration >= 20 && completed.duration < 75);
  assert.equal(result.editorial.findings.find(finding => finding.criterion === 'causalOrder').passed, true);
  assert.equal((await generation.listGenerationJobs()).length, 0, 'Recovery alone never starts a render');
});

test('recovery preserves owner scripts, earlier editorial phases, waiting and active checkpoints', async () => {
  const [draft] = await drafts.createCreationDrafts([input()]);
  const checkpoint = { version: 1, fingerprint: 'fixture', script, phase: 'final-review', revised: true };
  const attempt = { at: draft.createdAt, fingerprint: 'fixture', script, phase: 'final-review', findings: [], error: 'Fixture rejection' };
  for (const extra of [{ scriptOrigin: 'owner' }, { scriptOrigin: 'local-model', scriptApproved: true }, { scriptOrigin: 'local-model', creationType: 'children-story' }, { scriptOrigin: 'local-model', editorialCheckpoint: { ...checkpoint, phase: 'rewrite', issues: ['Needs correction'] } }, { scriptOrigin: 'local-model', editorialCheckpoint: { ...checkpoint, phase: 'length-correction' } }]) {
    write([{ ...draft, status: 'FAILED', input: { ...draft.input, editorialCheckpoint: checkpoint, editorialAttempts: [attempt], ...extra } }]);
    const result = await drafts.changeDraftStatus(draft.id, draft.version, 'retry');
    assert.equal(result.input.script, script);
    assert.deepEqual(result.input.editorialCheckpoint, extra.editorialCheckpoint || checkpoint);
    assert.deepEqual(result.input.editorialAttempts, [attempt]);
  }
  for (const status of ['QUEUED', 'PLANNING']) {
    const waiting = { ...draft, status, nextAttemptAt: new Date(Date.now() + 60_000).toISOString(), input: { ...draft.input, scriptOrigin: 'local-model', editorialCheckpoint: checkpoint, editorialAttempts: [attempt] } };
    write([waiting]);
    await assert.rejects(drafts.changeDraftStatus(draft.id, draft.version, 'retry'), /Only failed|Wait for/);
    assert.deepEqual(read()[0], waiting);
  }
});

test('manually saved generated searches become an owner brief and cannot receive automatic query correction', async () => {
  const item = await ready();
  const generated = { ...item, input: { ...item.input, scriptOrigin: 'local-model', visualTerms: undefined } };
  write([generated]);
  const changed = generated.scenes.map(scene => ({ ...scene, query: 'opening bedroom curtains' }));
  const saved = await drafts.saveCreationDraft(generated.id, generated.version, changed);
  assert.deepEqual(saved.input.visualTerms, changed.map(scene => scene.query));
  assert.deepEqual(read()[0].input.visualTerms, saved.input.visualTerms);
  assert.equal(saved.input.script, generated.input.script);
});

test('metadata selection rejects too-short, repeated, and clearly off-topic clips and prefers continuity', () => {
  const { rankFootage } = require(path.join(project, 'src/lib/automaticFootage.ts'));
  const choice = id => ({ ...catalog.footageChoice(fixture(id)), sourcePage: `https://www.pexels.com/video/opening-bedroom-curtains-${id}/` });
  const options = [{ ...choice(1), duration: 1 }, choice(2), { ...choice(3), sourcePage: 'https://www.pexels.com/video/drinking-coffee-3/' }, choice(4), { ...choice(5), creator: 'Other contributor' }];
  const ranked = rankFootage(options, 'opening bedroom curtains', 20, '9:16', new Set([2]), choice(99));
  assert.deepEqual(ranked.map(result => result.choice.id), [4, 5]);
  assert.match(ranked[0].reason, /Metadata checks only/);
});

test('automatic selection expands the same query before failing on the first short portrait results', async () => {
  process.env.PEXELS_API_KEY = 'fixture-not-a-real-key'; let calls = 0;
  global.fetch = async url => {
    const query = new URL(url).searchParams;
    assert.equal(query.get('query'), 'opening curtains');
    calls++;
    if (calls === 1) return Response.json({ videos: [{ ...fixture(101), duration: 1 }] });
    assert.equal(query.has('orientation'), false);
    assert.equal(query.get('per_page'), '30');
    return Response.json({ videos: [fixture(102)] });
  };
  const { selectAutomaticFootage } = require('../src/lib/automaticFootage');
  const result = await selectAutomaticFootage([{ narration: 'Open the curtains.', query: 'opening curtains' }], 60, '9:16', async () => {});
  assert.equal(result[0].footage.id, 102); assert.equal(calls, 2);
});

test('waiting legacy draft can opt into automatic completion without requiring a scene checkbox', async () => {
  const item = await ready();
  const response = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'http://localhost' }, body: JSON.stringify({ id: item.id, version: item.version, action: 'finish' }) }));
  assert.equal(response.status, 200);
  assert.equal(read()[0].input.reviewMode, 'final');
  assert.equal(read()[0].status, 'QUEUED');
});

test('explicit story draft recovery dispatches retained scenes at a natural narration length', async () => {
  const scenes = [
    { narration: 'Bram the bear found a kite resting beside the garden gate. He called to his friend and pointed to its string.', query: '' },
    { narration: 'They carried it carefully into the dry shed, placed it on a shelf, and closed the door together before the rain.', query: '' },
  ];
  for (const [index, action] of ['retry', 'finish'].entries()) {
    const supplied = { ...input(), reviewMode: 'final', creationType: 'children-story', topic: 'Bram the bear brings a kite home',
      visualSource: 'local-ai', script: scenes.map(scene => scene.narration).join(' '), scriptLocked: true,
      sceneNarration: scenes.map(scene => scene.narration),
      kidsStoryAttempt: { repairAttempted: false, script: 'Retained rejected attempt' },
      creativeBriefAttempt: { repairAttempted: false, source: 'Retained outline' } };
    const [draft] = await drafts.createCreationDrafts([supplied]);
    const failed = { ...draft, status: 'FAILED', scenes, error: 'Previous preparation was interrupted.' };
    write([...read().filter(item => item.id !== draft.id), failed]);
    await drafts.enableAutomaticCreation();
    assert.deepEqual(read().find(item => item.id === draft.id), failed, 'Startup cannot silently retry or change a failed final-mode draft');
    const response = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'http://localhost' }, body: JSON.stringify({ id: draft.id, version: draft.version, action }) }));
    assert.equal(response.status, 200);
    const recovered = await response.json();
    assert.equal(recovered.status, 'QUEUED');
    assert.deepEqual(recovered.input, { ...draft.input, autoDuration: true });
    assert.deepEqual(recovered.scenes, scenes);
    assert.equal((await generation.listGenerationJobs()).length, index, 'Recover alone does not run or dispatch a render');
    await drafts.processNextCreationDraft();
    const approved = read().find(item => item.id === draft.id);
    assert.equal(approved.status, 'APPROVED');
    const jobs = await generation.listGenerationJobs(), request = JSON.parse(jobs.find(job => job.id === approved.approvedJobId).requestJson);
    assert.equal(jobs.length, index + 1);
    assert.equal(request.autoDuration, true);
    assert.equal(request.script, supplied.script);
    assert.deepEqual(request.sceneNarration, supplied.sceneNarration);
    assert.deepEqual(request.kidsStoryAttempt, supplied.kidsStoryAttempt);
    assert.deepEqual(request.creativeBriefAttempt, supplied.creativeBriefAttempt);
    await drafts.processNextCreationDraft();
    assert.equal((await generation.listGenerationJobs()).length, index + 1, 'Repeated polling retains the existing dispatched job');
  }
});

test('explicit draft recovery keeps fixed duration choices, other workflows and archived inputs', async () => {
  for (const action of ['retry', 'finish', 'archive']) {
    for (const extra of [{ creationType: 'children-story', autoDuration: false }, { creationType: 'children-story', autoDuration: true }, { creationType: 'children-song' }, { creationType: 'general' }, { creationType: 'business' }, ...(action === 'archive' ? [{ creationType: 'children-story' }] : [])]) {
      const [draft] = await drafts.createCreationDrafts([{ ...input(), ...extra }]);
      const failed = { ...draft, status: 'FAILED' }; write([failed]);
      const recovered = await drafts.changeDraftStatus(draft.id, draft.version, action);
      assert.deepEqual(recovered.input, { ...draft.input, ...(action === 'archive' ? {} : { reviewMode: 'final' }) });
      assert.equal(recovered.status, action === 'archive' ? 'ARCHIVED' : 'QUEUED');
      assert.equal((await generation.listGenerationJobs()).length, 0);
    }
  }
});

test('generation API always finishes automatically, including older plan-only submissions', async () => {
  const kids = require(path.join(project, 'src/lib/kidsRenderer.ts'));
  const original = kids.kidsRendererAvailable;
  kids.kidsRendererAvailable = async () => true;
  try {
    const route = require(path.join(project, 'src/app/api/generations/route.ts'));
    for (const planOnly of [false, true]) {
      const response = await route.POST(new Request('http://localhost/api/generations', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ ...input(), creationType: 'children-story', planOnly }) }));
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.planOnly, false);
      assert.equal(read().find(d => d.id === body.draftIds[0]).input.reviewMode, 'final');
    }
    await drafts.processNextCreationDraft();
    const request = JSON.parse((await generation.listGenerationJobs())[0].requestJson);
    assert.equal(request.scriptLocked, true);
    assert.equal(request.scriptApproved, false);
    assert.equal(request.sceneNarration.join(' '), script);
  } finally { kids.kidsRendererAvailable = original; }
});

test('Krishna starter routes both languages to an authored final-review render without a writing provider', async () => {
  const kids = require('../src/lib/kidsRenderer');
  const { creationIntent } = require('../src/lib/creationIntent');
  const { krishnaStoryPreset, KRISHNA_STORY_TITLE, HINDI_KRISHNA_STORY_TITLE } = require('../src/lib/krishnaStory');
  const original = kids.kidsRendererAvailable;
  kids.kidsRendererAvailable = async requireModel => { assert.equal(requireModel, false); return true; };
  try {
    const route = require('../src/app/api/generations/route');
    for (const [topic, title] of [['Krishna 2D', KRISHNA_STORY_TITLE], [HINDI_KRISHNA_STORY_TITLE, HINDI_KRISHNA_STORY_TITLE]]) {
      assert.equal(creationIntent(topic), "Children's short story");
      const preset = krishnaStoryPreset(topic);
      const response = await route.POST(new Request('http://localhost/api/generations', { method: 'POST', headers: { origin: 'http://localhost' },
        body: JSON.stringify({ ...input(), topic, creationType: 'children-story', script: undefined }) }));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).title, title);
      await drafts.processNextCreationDraft();
      const saved = read().find(draft => draft.input.topic === title);
      assert.equal(saved.status, 'APPROVED');
      const job = (await generation.listGenerationJobs()).find(item => item.id === saved.approvedJobId);
      const request = JSON.parse(job.requestJson);
      assert.equal(request.language, preset.language);
      assert.equal(request.autoDuration, true);
      assert.equal(request.scriptLocked, true);
      assert.equal(request.scriptApproved, false);
      assert.deepEqual(request.sceneNarration, preset.scenes);
      const ass = kids.makeKidsCaptionAss([{ text: preset.scenes[0], start: 0, end: 3, duration: 3 }], 720, 1280);
      const font = preset.language === 'Hindi' ? (process.platform === 'win32' ? 'Nirmala UI' : 'Noto Sans Devanagari') : 'Arial';
      assert.ok(ass.includes(`Style: Caption,${font},`));
      assert.ok(ass.includes(preset.scenes[0]));
    }
  } finally { kids.kidsRendererAvailable = original; }
});

test('automatic creation estimates owner narration length and retains the same vertical file for both posting targets', async () => {
  const route = require('../src/app/api/generations/route.ts');
  const reachable=generation.generatorReachable, requireRenderer=generation.requireStockStoryboardRenderer;
  generation.generatorReachable=async()=>true; generation.requireStockStoryboardRenderer=async()=>{};
  try {
    const ownerScript=Array(10).fill('Open the kitchen drawer and place loose spoons in a tray.').join(' ');
    const response=await route.POST(new Request('http://localhost/api/generations',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({...input(),requestId:crypto.randomUUID(),autoDuration:true,duration:75,publishingFormat:'instagram-reel',script:ownerScript})}));
    assert.equal(response.status,201);const body=await response.json(), saved=read().find(item=>item.id===body.draftIds[0]).input;
    const words=ownerScript.match(/\b[\p{L}\p{N}'-]+\b/gu).length;
    assert.equal(saved.duration,Math.floor(words/2.7));assert.ok(saved.duration<60);
    assert.equal(saved.aspect,'9:16'); assert.equal(saved.publishingFormat,'youtube-short');
    assert.equal(saved.script,ownerScript); assert.equal(saved.reviewMode,'final');
    const generated=await route.POST(new Request('http://localhost/api/generations',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({...input(),requestId:crypto.randomUUID(),autoDuration:true,script:undefined,duration:90})}));
    assert.equal(generated.status,201);const generatedBody=await generated.json();
    assert.equal(read().find(item=>item.id===generatedBody.draftIds[0]).input.duration,60);
    assert.equal((await generation.listGenerationJobs()).length,0,'Admission never renders or posts by itself');
  } finally { generation.generatorReachable=reachable;generation.requireStockStoryboardRenderer=requireRenderer; }
});

test('automatic length never loosens children, manual caller or complete-owner-text guards', async () => {
  const route=require('../src/app/api/generations/route.ts');
  for(const extra of [
    {autoDuration:true,creationType:'children-story',duration:45,publishingFormat:'youtube-short'},
    {autoDuration:false,duration:45,publishingFormat:'youtube-short'},
    {autoDuration:true,script:'Too little narration.'},
    {autoDuration:true,script:script.replace(/\.$/,'')},
    {autoDuration:true,script:Array(40).fill('Open the curtains and look outside before starting the day.').join(' ')},
  ]) {
    const response=await route.POST(new Request('http://localhost/api/generations',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({...input(),...extra})}));
    assert.equal(response.status,400);
  }
  assert.equal(read().length,0);assert.equal((await generation.listGenerationJobs()).length,0);
});

test('worker migration resumes legacy approval gates once, retaining scenes and final-mode failures', async () => {
  const draft = await ready();
  const failed = { ...draft, id: crypto.randomUUID(), status: 'FAILED', input: { ...draft.input, reviewMode: 'final' }, error: 'Provider unavailable' };
  const archived = { ...draft, id: crypto.randomUUID(), status: 'ARCHIVED' };
  write([draft, failed, archived]);
  assert.equal(await drafts.enableAutomaticCreation(), 1);
  assert.equal(read()[0].status, 'QUEUED');
  assert.equal(read()[0].input.reviewMode, 'final');
  assert.deepEqual(read()[0].scenes, draft.scenes);
  assert.equal(read()[1].status, 'FAILED');
  assert.equal(read()[2].status, 'ARCHIVED');
  assert.equal(await drafts.enableAutomaticCreation(), 0);
});

test('new internal submissions default to final-video review', async () => {
  const value = input(); delete value.reviewMode;
  const [draft] = await drafts.createCreationDrafts([value]);
  assert.equal(draft.input.reviewMode, 'final');
});
test('duplicate plan clicks reuse drafts and archive tombstones prevent revival', async () => {
  const item = input();
  const [a] = await drafts.createCreationDrafts([item]);
  const [b] = await drafts.createCreationDrafts([item]);
  assert.equal(a.id, b.id);
  await drafts.changeDraftStatus(a.id, a.version, 'archive');
  await assert.rejects(drafts.createCreationDrafts([item]), /removed/);
  assert.equal(read().length, 1);
});

test('a saved creation key cannot return a different selected topic or workflow',async()=>{
  const original={...input(),requestTopic:'Otters',topic:'Explain otter swimming'};
  const [created]=await drafts.createCreationDrafts([original]);
  const before=fs.readFileSync(file,'utf8');
  for(const change of [{requestTopic:'Castles',topic:'Explain castles'},{creationType:'business'},{language:'Hindi'}]){
    await assert.rejects(drafts.createCreationDrafts([{...original,...change}]),/different idea/);
    assert.equal(fs.readFileSync(file,'utf8'),before,'A conflicting selection must not mutate or replace saved work');
  }
  assert.equal((await drafts.createCreationDrafts([original]))[0].id,created.id);
});

test('explicit automatic ideas reuse their original request even when a new provider draft was invented',async()=>{
  const original={...input(),requestTopic:'',creationType:'children-story',topic:'A bunny follows a little bell'};
  const [created]=await drafts.createCreationDrafts([original]);
  const [retry]=await drafts.createCreationDrafts([{...original,topic:'An owl carries a small letter'}]);
  assert.equal(retry.id,created.id);assert.equal(retry.input.topic,original.topic);assert.equal(read().length,1);
});
test('stock approval requires every actual asset and rejects insufficient duration', async () => {
  let draft = await ready();
  await assert.rejects(drafts.approveCreationDraft(draft.id, draft.version), /every section/);
  draft = await withFootage();
  const tooShort = draft.scenes.map(scene => ({ ...scene, footage: { ...scene.footage, duration: 1 } }));
  assert.throws(() => drafts.validateDraftScenes(draft, tooShort, true), /needs footage/);
});
test('edits normalize whitespace, invalidate changed visual choices, and reject stale versions', async () => {
  const draft = await withFootage();
  const scenes = draft.scenes.map(s => ({ ...s }));
  scenes[0].narration = scenes[0].narration.replace(' ', '\n  ');
  scenes[0].query = 'curtains blowing in window';
  const saved = await drafts.saveCreationDraft(draft.id, draft.version, scenes);
  assert.ok(!saved.scenes[0].footage);
  assert.ok(saved.scenes[1].footage);
  assert.ok(!saved.scenes[0].narration.includes('\n'));
  await assert.rejects(drafts.saveCreationDraft(draft.id, draft.version, scenes), /changed/);
  await assert.rejects(drafts.approveCreationDraft(draft.id, draft.version), /changed/);
});
test('concurrent approvals create exactly one immutable render request with exact asset IDs', async () => {
  const draft = await withFootage();
  const results = await Promise.all([drafts.approveCreationDraft(draft.id, draft.version), drafts.approveCreationDraft(draft.id, draft.version)]);
  assert.equal(results[0].approvedJobId, results[1].approvedJobId);
  const jobs = await generation.listGenerationJobs();
  assert.equal(jobs.length, 1);
  const request = JSON.parse(jobs[0].requestJson);
  assert.deepEqual(request.storyboard.map(b => b.assetId), [100, 101]);
  assert.equal(request.script, script);
  assert.equal(request.scriptApproved, true);
  await assert.rejects(drafts.saveCreationDraft(draft.id, results[0].version, draft.scenes), /cannot be changed/);
});
test('interrupted approval resumes without duplicating an already-created job', async () => {
  const draft = await withFootage();
  const approved = await drafts.approveCreationDraft(draft.id, draft.version);
  const store = read(); store[0].status = 'APPROVING'; write(store);
  await drafts.processNextCreationDraft();
  assert.equal(read()[0].approvedJobId, approved.approvedJobId);
  assert.equal((await generation.listGenerationJobs()).length, 1);
});
test('expired planning lease resumes while a live lease prevents concurrent planning', async () => {
  const [draft] = await drafts.createCreationDrafts([input()]);
  write([{ ...draft, status: 'PLANNING', leaseOwner: 'other-worker', leaseUntil: Date.now() + 60_000 }]);
  await drafts.processNextCreationDraft(); assert.equal(read()[0].status, 'PLANNING');
  write([{ ...read()[0], leaseUntil: Date.now() - 1 }]);
  await drafts.processNextCreationDraft(); assert.equal(read()[0].status, 'READY');
});
test('failed planning shows its cause and retains the script without fabricating footage', async () => {
  const item = input(); delete item.visualTerms;
  await drafts.createCreationDrafts([item]); await drafts.processNextCreationDraft();
  assert.equal(read()[0].status, 'FAILED'); assert.match(read()[0].error, /Unexpected network/);
  assert.equal(read()[0].input.script, script); assert.equal((await generation.listGenerationJobs()).length, 0);
});
test('API rejects cross-site mutations and approval without explicit review confirmation', async () => {
  const draft = await withFootage();
  const body = { id: draft.id, version: draft.version, action: 'approve' };
  let result = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'https://untrusted.example' }, body: JSON.stringify({ ...body, reviewConfirmed: true }) }));
  assert.equal(result.status, 400);
  result = await api.PATCH(new Request('http://localhost/api/creation-drafts', { method: 'PATCH', headers: { origin: 'http://localhost' }, body: JSON.stringify(body) }));
  assert.equal(result.status, 400);
});
test('approved children narration is used exactly, never silently replaced by the model', async () => {
  const supplied = 'Pip paused. Coco listened. Together they untangled the kite.';
  assert.equal(await createContent({ topic: 'A kite', duration: 60, creationType: 'children-story', script: supplied, scriptApproved: true }, {}), supplied);
});
test('singing uses local-only endpoints, single audio output, explicit lyrics and no speech fallback', () => {
  const body = singing.songPayload('Original lyrics here', 150, 'Piano and handclaps');
  assert.equal(body.audio_duration, 150); assert.equal(body.batch_size, 1); assert.equal(body.thinking, false); assert.equal(body.lyrics, 'Original lyrics here');
  assert.match(singing.singingMemoryBlocker(8 * 1024 ** 3, 5 * 1024 ** 3), /less than 12 GB/);
  assert.equal(singing.singingMemoryBlocker(16 * 1024 ** 3, 5 * 1024 ** 3), undefined);
  assert.throws(() => singing.localSongDownload('https://paid.example/song.mp3'), /unsafe/);
  assert.equal(singing.localSongDownload('/v1/audio?path=generated.mp3').hostname, '127.0.0.1');
  process.env.PHOENIX_ACE_URL = 'https://paid.example'; assert.throws(() => singing.singingBase(), /hosted or paid/);
});
test('singing respects explicit English/Hindi and detects Hindi only when language is absent', () => {
  const payload = (lyrics, language) => singing.songPayload(lyrics, 150, 'Piano and handclaps', language);
  for (const language of ['Hindi', ' hi ', 'hi-IN']) assert.equal(payload('Chanda mama door ke', language).vocal_language, 'hi');
  for (const language of ['English', 'EN', 'en-US']) assert.equal(payload('चंदा मामा दूर के', language).vocal_language, 'en');
  assert.equal(payload('चंदा मामा दूर के').vocal_language, 'hi');
  assert.equal(payload('Sunshine in the morning', '  ').vocal_language, 'en');
  assert.throws(() => payload('Hola', 'Spanish'), /supports English or Hindi/);
});
test('new hosted song requests require explicit lyrics transmission consent before any provider call', async () => {
  const route = require(path.join(project, 'src/app/api/generations/route.ts'));
  for (const extra of [{ hostedSongConsent: false }, { hostedSongConsent: true, language: 'Hindi', script: '' }]) {
    const response = await route.POST(new Request('http://localhost:3000/api/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ topic: 'Original star song', creationType: 'children-song', songMode: 'hosted-ace', ...extra }) }));
    assert.equal(response.status, 400); assert.match((await response.json()).error, /Allow sending|original Hindi lyrics/);
  }
});
test('explicit generated-song lyrics remain verbatim instead of being replaced by the English lyric bank', async () => {
  const lyrics = 'नन्हा तारा चमके आज। मीठी धुन में झूमे साज।';
  assert.equal(await createContent({ topic: 'A gentle star song', duration: 150, creationType: 'children-song', songMode: 'hosted-ace', language: 'Hindi', script: lyrics }, {}), lyrics);
});
test('explicit retry replaces only confirmed failed hosted song tasks, retaining uncertain tasks and completed audio', async () => {
  for (const extra of [{ songTaskFailed: true }, {}, { songTaskFailed: true, songOutput: { path: '/tmp/retained.mp3', url: 'retained' } }, { songTaskFailed: true, audioId: '12345678-1234-4234-8234-123456789abc' }]) {
    write([]);
    const [created] = await drafts.createCreationDrafts([{ ...input(), creationType: 'children-song', songMode: 'hosted-ace' }]);
    const stored = read(); Object.assign(stored[0], { status: 'FAILED', songTaskId: 'a'.repeat(32), songSubmissionStarted: true, songRequestFingerprint: 'b'.repeat(64), ...extra });
    if (extra.audioId) stored[0].input.songAudioId = extra.audioId;
    write(stored);
    const retried = await drafts.changeDraftStatus(created.id, created.version, 'retry');
    const replaceable = extra.songTaskFailed === true && !extra.songOutput && !extra.audioId;
    assert.equal(retried.songTaskId, replaceable ? undefined : 'a'.repeat(32));
    assert.equal(retried.songSubmissionStarted, !replaceable);
    assert.equal(retried.songRequestFingerprint, replaceable ? undefined : 'b'.repeat(64));
    assert.equal(retried.input.songAudioId, extra.audioId);
  }
});
test('stock catalog verifies CDN URLs and chooses a laptop-sized MP4 rendition', () => {
  const video = fixture(123); video.video_files.unshift({ file_type: 'video/mp4', width: 2160, height: 3840, link: 'https://videos.pexels.com/4k.mp4' });
  assert.equal(catalog.footageChoice(video).width, 720);
  assert.throws(() => catalog.footageChoice({ ...video, image: 'http://localhost/private' }), /untrusted/);
});

test('singing adapter follows the documented local protocol and stages real audio bytes (mock engine)', async () => {
  const total = os.totalmem, free = os.freemem;
  const audio = require(path.join(project, 'src/lib/songAudio.ts'));
  const originalStage = audio.stageSongAudio;
  const stages = [], calls = [];
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 5 * 1024 ** 3;
  audio.stageSongAudio = async (stream, filename, origin) => { assert.equal(await new Response(stream).text(), 'audio-fixture'); assert.equal(origin, 'local-ace'); assert.match(filename, /mp3$/); return { id: 'fixture-audio', duration: 150 }; };
  global.fetch = async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'http://127.0.0.1:8001'); calls.push(parsed.pathname); assert.equal(init.redirect, 'error');
    if (parsed.pathname === '/health') return Response.json({ data: { status: 'ok', service: 'ACE-Step API' } });
    if (parsed.pathname === '/v1/models') return Response.json({ data: { models: [{ name: 'acestep-v15-turbo', is_default: true }] } });
    if (parsed.pathname === '/release_task') { const body = JSON.parse(init.body); assert.equal(body.batch_size, 1); assert.equal(body.vocal_language, 'hi'); return Response.json({ data: { task_id: 'song-fixture-123' } }); }
    if (parsed.pathname === '/query_result') { assert.deepEqual(JSON.parse(init.body).task_id_list, ['song-fixture-123']); return Response.json({ data: [{ task_id: 'song-fixture-123', status: 1, result: JSON.stringify([{ file: '/v1/audio?path=fixture.mp3' }]) }] }); }
    if (parsed.pathname === '/v1/audio') return new Response('audio-fixture');
    throw new Error('Unknown endpoint');
  };
  try {
    const result = await singing.prepareLocalSong({ lyrics: 'Chanda mama door ke', language: 'Hindi', duration: 150 }, async change => stages.push(change));
    assert.equal(result.id, 'fixture-audio');
    assert.deepEqual(calls, ['/health', '/v1/models', '/release_task', '/query_result', '/v1/audio']);
    assert.equal(stages[0].songSubmissionStarted, true);
    assert.equal(stages[1].songTaskId, 'song-fixture-123');
    await assert.rejects(singing.prepareLocalSong({ lyrics: 'Hola', language: 'Spanish', duration: 150 }, async () => assert.fail('Invalid language must not mark submission started')), /supports English or Hindi/);
    await assert.rejects(singing.prepareLocalSong({ lyrics: 'Original words', duration: 150, submissionStarted: true }, async () => undefined), /could not be confirmed/);
    assert.equal(calls.filter(call => call === '/release_task').length, 1);
  } finally { os.totalmem = total; os.freemem = free; audio.stageSongAudio = originalStage; }
});

test('unknown model readiness and explicit engine failures are not presented as finished songs', async () => {
  const total = os.totalmem, free = os.freemem;
  os.totalmem = () => 16 * 1024 ** 3; os.freemem = () => 5 * 1024 ** 3;
  global.fetch = async url => Response.json({ data: new URL(url).pathname === '/health' ? { status: 'ok', service: 'ACE-Step API' } : { models: [{ name: 'acestep-v15-turbo', is_loaded: false }] } });
  try {
    const status = await singing.localSingingStatus(); assert.equal(status.available, false); assert.match(status.reason, /loaded model/);
    global.fetch = async url => {
      const route = new URL(url).pathname;
      if (route === '/health') return Response.json({ data: { status: 'ok', service: 'ACE-Step API' } });
      if (route === '/v1/models') return Response.json({ data: { models: [{ name: 'acestep-v15-turbo' }] } });
      assert.equal(route, '/query_result');
      return Response.json({ data: [{ task_id: 'existing-song', status: 2, error: 'out of memory' }] });
    };
    await assert.rejects(singing.prepareLocalSong({ lyrics: 'Lyrics', duration: 150, taskId: 'existing-song' }, async () => undefined), /out of memory/);
  } finally { os.totalmem = total; os.freemem = free; }
});

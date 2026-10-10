const { test, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const previousDirectory = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-kids-direction-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
// App stores bind their paths on import. No owner's queue/settings are read.
process.chdir(temporary);
const settings = require('../src/lib/writingSettings.ts');
const writer = require('../src/lib/writingModel.ts');
const local = require('../src/lib/localModelSession.ts');
const resources = require('../src/lib/renderResources.ts');
const generation = require('../src/lib/generation.ts');
const drafts = require('../src/lib/creationDrafts.ts');
const { createContent } = require('../src/lib/kidsRenderer.ts');
const { guidanceFromFeedback } = require('../src/lib/qualityManager.ts');
const groqWriter = require('../src/lib/groqWriter.ts');
const cloudflareWriter = require('../src/lib/cloudflareWriter.ts');
const { WritingWaitError, WritingConfigurationError, WritingOutputValidationError } = groqWriter;
const { kidsVoicePlan } = require('../src/lib/kidsSpeechTiming.ts');
const reviewRoot = require('../src/lib/reviewFiles.ts').reviewRoot();
const expectedRoot = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
assert.equal(path.resolve(reviewRoot), path.resolve(expectedRoot), 'Refusing to place fixtures in the live review store');
const store = path.join(reviewRoot, 'creation-drafts.json');
const originalFetch = global.fetch;
const originalGenerateWritingModel = writer.generateWritingModel;
const originalFixtureMethods = [
  [settings, 'readWritingSettings'], [writer, 'generateWritingModel'],
  [local, 'withLocalWritingSession'], [resources, 'withLocalRenderSlot'],
  [generation, 'createGenerationJobs'], [groqWriter, 'generateGroqText'],
  [cloudflareWriter, 'generateCloudflareText'],
].map(([target, method]) => [target, method, target[method]]);

function resetFixtureMocks() {
  mock.reset();
  // Remocking one export can restore an older stub. Every fixture starts from
  // the original module exports, including the real provider dispatcher.
  for (const [target, method, original] of originalFixtureMethods) target[method] = original;
  global.fetch = originalFetch;
}

const script = 'Benny held a rainbow kite with its string tangled around a little branch. Tika watched the kite wobble while Benny pulled too quickly. Benny said, “I want our kite to fly above the flowers!” The string tightened and Benny stopped pulling before the branch bent. Tika said, “Let us loosen one loop at a time.” Benny held the kite steady while Tika reached for the loose loop. They carefully untangled the string and placed its small spool beside the flowers. Tika watched as Benny slowly lifted the kite again. This time the rainbow kite rose smoothly and its ribbon followed the wind. Benny said, “Your careful plan worked!” Tika waved while Benny held the straight string, and both friends smiled at their flying kite.';
const outline = {
  viewerQuestion: 'How can Benny and Tika get their tangled rainbow kite flying?', audience: 'Children ages 3–6',
  angles: [
    { angle: 'Pulling too quickly makes the knot tighter', value: 'The friends notice a visible consequence and change their approach.' },
    { angle: 'One friend holds while the other loosens a loop', value: 'Different roles help the two friends make a careful attempt.' },
    { angle: 'A loose ribbon reveals where the knot starts', value: 'A small visible clue leads to a supported untangling action.' },
  ], selectedAngle: 0, structure: 'story', opening: 'Benny pulls too quickly and the rainbow kite wobbles.',
  beats: [
    { point: 'Benny pulls the tangled string and notices it tightening.', visual: 'Wide view: Benny reaches toward a visibly tangled kite; Tika watches.' },
    { point: 'Tika reacts and proposes loosening one loop while Benny holds.', visual: 'Reaction view: Tika notices the knot; Benny holds the kite still.' },
    { point: 'They change their approach and release the straight string.', visual: 'Prop-detail view: the knot becomes untangled before the kite flies.' },
  ], payoff: 'The same rainbow kite flies after their slower attempt works.', avoid: ['Do not add extra speaking helpers or resolve the knot off screen.'],
};
const childInput = () => ({ topic: 'Benny Bunny and Tika Bird fly a rainbow kite', duration: 60, aspect: '9:16', publishingFormat: 'youtube-short', creationType: 'children-story', reviewMode: 'final' });
const read = () => JSON.parse(fs.readFileSync(store, 'utf8'));
let submitted;

beforeEach(() => {
  resetFixtureMocks();
  const storage = path.join(temporary, 'storage');
  assert.equal(path.dirname(path.resolve(storage)), path.resolve(temporary));
  fs.rmSync(storage, { recursive: true, force: true });
  fs.mkdirSync(reviewRoot, { recursive: true });
  submitted = [];
  mock.method(settings, 'readWritingSettings', () => ({ provider: 'groq', model: settings.WRITING_GROQ_MODEL, apiKey: 'gsk_fixture_never_sent_1234567890', freePlanConfirmed: true }));
  mock.method(local, 'withLocalWritingSession', async () => assert.fail('A mocked remote draft must never load a local model'));
  mock.method(resources, 'withLocalRenderSlot', async () => assert.fail('Text planning must never enter a local render'));
  mock.method(generation, 'createGenerationJobs', async (_owner, inputs) => {
    submitted.push(...structuredClone(inputs));
    return [{ id: 'fixture-queued-render-id' }];
  });
  global.fetch = async () => assert.fail('No actual provider, network or media call is allowed');
});
afterEach(resetFixtureMocks);
after(() => {
  process.chdir(previousDirectory);
  assert.match(path.basename(temporary), /^phoenix-kids-direction-/);
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('automatic child planning saves its exact cast and visual plan before quota wait, then resumes without replanning', async () => {
  const prompts = [];
  mock.method(writer, 'generateWritingModel', async body => {
    prompts.push(body.prompt);
    if (prompts.length === 1) {
      assert.match(body.prompt, /original limited 2D/);
      assert.match(body.prompt, /Benny the bunny and Tika the bird/);
      return Response.json({ response: JSON.stringify(outline) });
    }
    const [checkpoint] = read();
    assert.equal(checkpoint.input.creativeBrief.version, 2, 'The outline must be durable before narration dispatch');
    assert.deepEqual(checkpoint.input.creativeBrief.beats, outline.beats);
    assert.match(body.prompt, /Benny the bunny and Tika the bird/);
    assert.match(body.prompt, /visualConstraints/);
    assert.ok(body.prompt.includes(outline.beats[0].visual));
    assert.match(body.prompt, /consequence → reaction → changed attempt → payoff/);
    if (prompts.length === 2) throw new WritingWaitError('Fixture writer quota wait', 60000);
    return Response.json({ response: script });
  });
  await drafts.createCreationDrafts([childInput()]);
  await drafts.processNextCreationDraft();
  const [waiting] = read();
  assert.equal(waiting.status, 'QUEUED');
  assert.equal(waiting.error, undefined);
  assert.equal(waiting.input.script, undefined);
  assert.ok(Date.parse(waiting.nextAttemptAt) > Date.now());
  assert.equal(submitted.length, 0);
  const fingerprint = waiting.input.creativeBrief.fingerprint;
  // Advance only this isolated fixture's scheduled time; no real queue is used.
  waiting.nextAttemptAt = new Date(0).toISOString();
  fs.writeFileSync(store, JSON.stringify([waiting]));
  await drafts.processNextCreationDraft();
  const [finished] = read();
  assert.equal(finished.status, 'APPROVED', finished.error);
  assert.equal(finished.input.creativeBrief.fingerprint, fingerprint);
  assert.equal(finished.input.script, script);
  assert.equal(prompts.length, 3, 'Resume should write narration from the saved plan, not plan another angle');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].scriptLocked, true);
  assert.equal(submitted[0].scriptApproved, false, 'Automatic dispatch is not owner approval');
  assert.equal(submitted[0].scriptOrigin, 'local-model');
  assert.equal(submitted[0].creativeBrief.fingerprint, fingerprint);
  assert.equal(submitted[0].sceneNarration.join(' '), script, 'Whole scene grouping must preserve every spoken word');
  assert.deepEqual(kidsVoicePlan(submitted[0].script, ['Benny', 'Tika']).utterances.filter(part => part.speaker >= 0).map(part => part.speaker), [0, 1, 0]);
});

test('remote configuration errors preserve the saved child plan and fail without an offline replacement or render', async () => {
  let calls = 0;
  mock.method(writer, 'generateWritingModel', async () => {
    if (++calls === 1) return Response.json({ response: JSON.stringify(outline) });
    throw new WritingConfigurationError('Fixture writing configuration changed');
  });
  await drafts.createCreationDrafts([childInput()]);
  await drafts.processNextCreationDraft();
  const [failed] = read();
  assert.equal(failed.status, 'FAILED');
  assert.match(failed.error, /configuration changed/);
  assert.equal(failed.input.creativeBrief.version, 2);
  assert.equal(failed.input.script, undefined);
  assert.equal(submitted.length, 0);
  assert.equal(calls, 2);
});

test('owner-locked names and dialogue remain verbatim without entering creative planning', async () => {
  mock.method(writer, 'generateWritingModel', async () => assert.fail('Owner-locked narration must never be rewritten'));
  const exact = 'Maru said, “I want to keep my own name.” Sora answered, “So do I.”';
  let checkpoints = 0;
  const actual = await createContent({ ...childInput(), script: exact, scriptLocked: true }, guidanceFromFeedback([], 'children-story'), async () => { checkpoints++; });
  assert.equal(actual, exact);
  assert.equal(checkpoints, 0);
});

test('rejected dialogue is durably saved before quota wait; resume corrects only narration once', async () => {
  const invalid=script.replace('Tika said,','Tika chirps,');
  let calls=0;
  mock.method(writer,'generateWritingModel',async body=>{
    calls++;
    if(calls===1) return Response.json({response:JSON.stringify(outline)});
    if(calls===2) return Response.json({response:invalid});
    assert.match(body.prompt,/Correct the previous narration ONCE/);
    assert.ok(body.prompt.includes('dialogue-identity'));
    const [saved]=read();
    assert.equal(saved.input.script,undefined,'An invalid candidate cannot be locked or dispatched');
    assert.equal(saved.input.kidsStoryAttempt.candidate,invalid);
    assert.equal(saved.input.kidsStoryAttempt.repairAttempted,false,'Quota must not consume a content repair');
    if(calls===3) throw new WritingWaitError('Fixture correction quota wait',60000);
    return Response.json({response:script});
  });
  await drafts.createCreationDrafts([childInput()]);
  await drafts.processNextCreationDraft();
  const [waiting]=read();
  assert.equal(waiting.status,'QUEUED');
  assert.equal(submitted.length,0);
  waiting.nextAttemptAt=new Date(0).toISOString(); fs.writeFileSync(store,JSON.stringify([waiting]));
  await drafts.processNextCreationDraft();
  const [finished]=read();
  assert.equal(finished.status,'APPROVED',finished.error);
  assert.equal(finished.input.script,script);
  assert.equal(finished.input.kidsStoryAttempt,undefined);
  assert.equal(calls,4,'No second outline or unrelated provider is requested');
  assert.equal(submitted.length,1);
});

test('a still-invalid automatic correction fails before rendering and retains its exact candidate',async()=>{
  const invalid=script.replace('Tika said,','Tika chirps,');
  let calls=0;
  mock.method(writer,'generateWritingModel',async()=>Response.json({response:++calls===1?JSON.stringify(outline):invalid}));
  await drafts.createCreationDrafts([childInput()]);
  await drafts.processNextCreationDraft();
  const [failed]=read();
  assert.equal(failed.status,'FAILED');
  assert.match(failed.error,/one automatic attempt/);
  assert.equal(failed.input.kidsStoryAttempt.candidate,invalid);
  assert.equal(failed.input.kidsStoryAttempt.repairAttempted,true);
  assert.equal(failed.input.script,undefined);
  assert.equal(submitted.length,0);
  assert.equal(calls,3);
  // Only an explicit owner retry authorizes another correction; idle polling cannot.
  await drafts.processNextCreationDraft(); assert.equal(calls,3);
  await drafts.changeDraftStatus(failed.id,failed.version,'retry');
  assert.equal(read()[0].input.kidsStoryAttempt.repairAttempted,false);
});

test('an interrupted outline correction is checkpointed and resumes that correction, not fresh planning',async()=>{
  const invalid={...outline,audience:'Children ages 4–7'};
  let calls=0;
  mock.method(writer,'generateWritingModel',async body=>{
    calls++;
    if(calls===1) return Response.json({response:JSON.stringify(invalid)});
    if(calls<=3){
      assert.match(body.prompt,/Repair the previous outline once/);
      assert.match(body.prompt,/Target children ages 3–6/);
      const [saved]=read();
      assert.equal(saved.input.creativeBrief,undefined);
      assert.equal(saved.input.creativeBriefAttempt.candidate,JSON.stringify(invalid));
      if(calls===2) throw new WritingWaitError('Fixture outline correction quota wait',60000);
      return Response.json({response:JSON.stringify(outline)});
    }
    return Response.json({response:script});
  });
  await drafts.createCreationDrafts([childInput()]); await drafts.processNextCreationDraft();
  const [waiting]=read(); assert.equal(waiting.status,'QUEUED');
  waiting.nextAttemptAt=new Date(0).toISOString();fs.writeFileSync(store,JSON.stringify([waiting]));
  await drafts.processNextCreationDraft();
  const [finished]=read();assert.equal(finished.status,'APPROVED',finished.error);
  assert.equal(finished.input.creativeBriefAttempt,undefined);assert.equal(calls,4);assert.equal(submitted.length,1);
});

function fixtureWriterSettings(provider) {
  return provider === 'cloudflare'
    ? { provider, model: settings.WRITING_CLOUDFLARE_MODEL, apiKey: 'fixture_cloudflare_key_never_sent_123456', accountId: 'a'.repeat(32), freePlanConfirmed: true }
    : provider === 'groq'
      ? { provider, model: settings.WRITING_GROQ_MODEL, apiKey: 'gsk_fixture_never_sent_1234567890', freePlanConfirmed: true }
      : { provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false };
}

function selectFixtureWriter(provider) {
  mock.method(settings, 'readWritingSettings', () => fixtureWriterSettings(provider));
}

for (const provider of ['groq', 'cloudflare']) for (const stage of ['outline', 'narration']) {
  test(`${provider} ${stage} transport, output, quota and configuration failures never return a template story`, async () => {
    selectFixtureWriter(provider);
    let failure, calls = 0;
    mock.method(writer, 'generateWritingModel', async () => {
      calls++;
      if (stage === 'narration' && calls === 1) return Response.json({ response: JSON.stringify(outline) });
      throw failure;
    });
    for (const currentFailure of [new Error('Fixture transport interrupted'), new WritingOutputValidationError('Fixture structured response invalid'),
      new WritingWaitError('Fixture quota wait', 60_000), new WritingConfigurationError('Fixture writer configuration rejected')]) {
      failure = currentFailure; calls = 0;
      const input = childInput(); let saved = 0;
      await assert.rejects(createContent(input, guidanceFromFeedback([], 'children-story'), async () => { saved++; }), caught => caught === failure);
      assert.equal(calls, stage === 'outline' ? 1 : 2, 'A provider error is not authorization to regenerate or repair content');
      assert.equal(input.script, undefined); assert.equal(submitted.length, 0);
      if (stage === 'narration') { assert.equal(input.creativeBrief.version, 2); assert.ok(saved >= 1, 'The exact outline survives a later provider failure'); }
      else assert.equal(input.creativeBrief, undefined);
    }
  });
}

for (const provider of ['groq', 'cloudflare']) test(`${provider} exhausted malformed-outline repair retains its rejected candidate instead of returning a template`, async () => {
  selectFixtureWriter(provider);
  const input = childInput(); let calls = 0;
  mock.method(writer, 'generateWritingModel', async () => { calls++; return Response.json({ response: '{"unfinished":' }); });
  await assert.rejects(createContent(input, guidanceFromFeedback([], 'children-story')), /one automatic attempt.*no generic topic template/s);
  assert.equal(calls, 2); assert.equal(input.creativeBriefAttempt.candidate, '{"unfinished":');
  assert.equal(input.creativeBriefAttempt.repairAttempted, true); assert.equal(input.script, undefined); assert.equal(submitted.length, 0);
});

for (const provider of ['groq', 'cloudflare']) for (const stage of ['outline', 'narration']) {
  test(`direct ${provider} ${stage} transport failure remains visible after settings switch to Ollama`, async () => {
    assert.equal(writer.generateWritingModel, originalGenerateWritingModel, 'Direct fixtures must exercise the real provider dispatcher');
    let active = fixtureWriterSettings(provider), calls = 0;
    mock.method(settings, 'readWritingSettings', () => ({ ...active }));
    const transport = provider === 'groq' ? groqWriter : cloudflareWriter;
    const method = provider === 'groq' ? 'generateGroqText' : 'generateCloudflareText';
    const failure = new Error('Fixture remote transport interrupted while settings changed');
    mock.method(transport, method, async () => {
      calls++;
      if (stage === 'narration' && calls === 1) return Response.json({ response: JSON.stringify(outline) });
      active = fixtureWriterSettings('ollama');
      throw failure;
    });
    const input = childInput();
    await assert.rejects(createContent(input, guidanceFromFeedback([], 'children-story')), caught => caught === failure);
    assert.equal(calls, stage === 'outline' ? 1 : 2);
    assert.equal(input.script, undefined); assert.equal(submitted.length, 0);
    if (stage === 'narration') assert.equal(input.creativeBrief.model, `${provider}:${fixtureWriterSettings(provider).model}`);
    else assert.equal(input.creativeBrief, undefined);
  });
}

for (const provider of ['groq', 'cloudflare']) for (const nextProvider of ['ollama', provider === 'groq' ? 'cloudflare' : 'groq']) {
  test(`direct ${provider} story stops before narration after switching to ${nextProvider}`, async () => {
    assert.equal(writer.generateWritingModel, originalGenerateWritingModel, 'Direct fixtures must exercise the real provider dispatcher');
    let active = fixtureWriterSettings(provider), switched = false;
    const calls = [];
    mock.method(settings, 'readWritingSettings', () => ({ ...active }));
    for (const [selected, transport, method] of [
      ['groq', groqWriter, 'generateGroqText'], ['cloudflare', cloudflareWriter, 'generateCloudflareText'],
    ]) mock.method(transport, method, async () => {
      calls.push(selected);
      return Response.json({ response: JSON.stringify(outline) });
    });
    const input = childInput();
    await assert.rejects(createContent(input, guidanceFromFeedback([], 'children-story'), async saved => {
      if (saved.creativeBrief && !switched) {
        switched = true;
        active = fixtureWriterSettings(nextProvider);
      }
    }), error => error instanceof WritingConfigurationError && /settings changed during this job/.test(error.message));
    assert.equal(switched, true, 'The provider changes after the exact outline is saved');
    assert.deepEqual(calls, [provider], 'Changed settings cannot dispatch narration to another writer');
    assert.equal(input.creativeBrief.model, `${provider}:${fixtureWriterSettings(provider).model}`);
    assert.deepEqual(input.creativeBrief.beats, outline.beats);
    assert.equal(input.script, undefined); assert.equal(submitted.length, 0);
  });
}

for (const stage of ['outline', 'narration']) test(`Ollama keeps its explicit local topic fallback after a ${stage} transport failure`, async () => {
  selectFixtureWriter('ollama');
  mock.method(local, 'withLocalWritingSession', async work => work());
  let calls = 0;
  mock.method(writer, 'generateWritingModel', async () => {
    calls++;
    if (stage === 'narration' && calls === 1) return Response.json({ response: JSON.stringify(outline) });
    throw new Error('Fixture offline local writer');
  });
  const result = await createContent(childInput(), guidanceFromFeedback([], 'children-story'));
  assert.match(result, /Benny/); assert.match(result, /Tika/); assert.match(result, /kite/);
  assert.equal(calls, stage === 'outline' ? 1 : 2); assert.equal(submitted.length, 0);
});

test('Cloudflare selection does not rewrite uploaded song lyrics or change the original local song composer', async () => {
  selectFixtureWriter('cloudflare');
  mock.method(writer, 'generateWritingModel', async () => assert.fail('The unchanged song paths must not call a story writer'));
  const supplied = 'Exact uploaded song lyrics remain unchanged.';
  const input = { ...childInput(), creationType: 'children-song' };
  const guidance = guidanceFromFeedback([], 'children-song');
  assert.equal(await createContent({ ...input, songAudioId: 'fixture-song-not-read', script: supplied }, guidance), supplied);
  const originalSong = await createContent(input, guidance);
  assert.match(originalSong, /Benny/); assert.match(originalSong, /Tika/); assert.ok(originalSong.split('\n').length > 8);
  assert.equal(submitted.length, 0);
});

const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('./mock-model-admission.cjs');
const settings = require('../src/lib/writingSettings.ts');
// Tests must never read the owner's configured provider or real API key.
mock.method(settings, 'readWritingSettings', () => ({ provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false }));
const writer = require('../src/lib/writingModel.ts');
const { WritingWaitError, WritingConfigurationError } = require('../src/lib/groqWriter.ts');
const { planCreativeBrief, validateCreativeBrief, creativeBriefInstructions } = require('../src/lib/creativeBrief.ts');
const originalFetch = global.fetch;
const input = { topic: 'Why do shadows change during the day?', duration: 75, creationType: 'general', feedbackRevision: 'one', guidance: [] };
const outline = {
  viewerQuestion: 'Why does the same object cast a different shadow later?', audience: 'Curious general viewers',
  angles: [
    { angle: 'Compare one tree shadow at two times', value: 'Make the changing direction visible through a familiar observation.' },
    { angle: 'Explain relative light direction with a lamp', value: 'Connect the shadow direction to the light direction.' },
    { angle: 'Describe a sundial as an everyday example', value: 'Show how people can notice the repeating pattern.' },
  ], selectedAngle: 0, structure: 'explanation', opening: 'The tree has not moved, but its shadow has.',
  beats: [
    { point: 'Notice the same object and ground in both views.', visual: 'Tree and its shadow on open ground.' },
    { point: 'Describe the change in light direction.', visual: 'Sunlight coming from a different direction.' },
    { point: 'Connect that difference to the position of the shadow.', visual: 'A second tree shadow view, labelled as illustrative.' },
  ], payoff: 'Look at the same shadow later and compare its direction.', avoid: ['Do not claim unrelated stock shots document the same tree.'],
};
after(() => { global.fetch = originalFetch; });
test('broader planner saves three angles and an appropriate structure, without a compulsory shop story', async () => {
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    const request = JSON.parse(init.body);
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(request.options.num_ctx, 4096); assert.equal(request.options.num_thread, 2);
    assert.match(request.prompt, /nature, everyday science, food, crafts/);
    assert.match(request.prompt, /Do not force unrelated business advice/);
    return Response.json({ response: JSON.stringify(outline) });
  };
  const brief = await planCreativeBrief(input);
  assert.equal(brief.structure, 'explanation'); assert.equal(brief.angles.length, 3);
  const narrationData = JSON.parse(creativeBriefInstructions(brief));
  assert.deepEqual(narrationData.beats, outline.beats.map(beat => beat.point));
  assert.deepEqual(narrationData.visualConstraints, outline.beats.map(beat => beat.visual), 'visual feasibility survives the handoff to narration');
  assert.equal(narrationData.visual, undefined);
  assert.equal((await planCreativeBrief({ ...input, saved: brief })).fingerprint, brief.fingerprint);
  assert.equal(calls, 1);
  await planCreativeBrief({ ...input, feedbackRevision: 'two', saved: brief }); assert.equal(calls, 2);
});
test('repeated alternatives, repeated beats and unsupported structures cannot become a valid plan', () => {
  assert.throws(() => validateCreativeBrief({ ...outline, angles: Array(3).fill(outline.angles[0]) }), /repeated its angles/);
  assert.throws(() => validateCreativeBrief({ ...outline, beats: Array(3).fill(outline.beats[0]) }), /repeats a beat/);
  assert.throws(() => validateCreativeBrief({ ...outline, structure: 'unrelated-montage' }));
});
test('a dog exploration topic cannot become a filming lesson, while explicit filmmaking and visual plans remain valid', () => {
  const filming={...outline,viewerQuestion:'How can I capture a dog exploring a park in a short, engaging video?',payoff:'You will learn how to film a dog adventure from a first-person view.'};
  assert.throws(()=>validateCreativeBrief(filming,'general','A dog exploring the park'),/lesson about filming/);
  assert.equal(validateCreativeBrief(filming,'general','How to film a dog exploring a park').viewerQuestion,filming.viewerQuestion);
  const subject={...outline,viewerQuestion:'What catches a curious dog on a walk?',payoff:'A small pause gives the dog time to investigate a new scent.',beats:outline.beats.map(beat=>({...beat,visual:'The camera pans across a dog exploring a park.'}))};
  assert.equal(validateCreativeBrief(subject,'general','A dog exploring the park').viewerQuestion,subject.viewerQuestion,'Separate visual instructions can still describe camera work');
});
test('one bounded repair restores the supplied dog subject after a filming-question drift',async()=>{
  const dogInput={...input,topic:'A dog exploring the park'};
  const drift={...outline,viewerQuestion:'How can I capture a dog exploring a park in a short, engaging video?'};
  const corrected={...outline,viewerQuestion:'What catches a curious dog on a walk?',payoff:'A pause gives the dog time to investigate a new scent.'};
  const prompts=[];
  global.fetch=async(_url,init)=>{prompts.push(JSON.parse(init.body).prompt);return Response.json({response:JSON.stringify(prompts.length===1?drift:corrected)});};
  const saved=[];
  const brief=await planCreativeBrief({...dogInput,onAttemptSaved:async value=>saved.push(value)});
  assert.equal(brief.viewerQuestion,corrected.viewerQuestion);assert.equal(prompts.length,2);
  assert.match(prompts[0],/not a lesson in filming a dog/);
  assert.match(prompts[1],/answer the supplied subject, not how to film it/);
  assert.ok(saved[0].feedback.includes('spoken beats'));assert.equal(saved.at(-1),undefined);
});
test('malformed model output fails without substituting a generic business script', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ response: '{"unfinished":' }); };
  await assert.rejects(planCreativeBrief(input), /no generic topic template/);
  assert.equal(calls, 2, 'only one repair is allowed');
});

test('short audience categories are accepted, while empty and oversized audiences are rejected', () => {
  for (const audience of ['general', 'kids', '  general  ']) {
    assert.equal(validateCreativeBrief({ ...outline, audience }).audience, audience.trim());
  }
  for (const audience of ['', '   ', 'a'.repeat(351), undefined, 42]) {
    assert.throws(() => validateCreativeBrief({ ...outline, audience }));
  }
  assert.throws(() => validateCreativeBrief({ ...outline, payoff: 'short' }), 'other descriptive fields retain quality bounds');
});

test('general audience completes planning in one request and remains reusable', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ response: JSON.stringify({ ...outline, audience: 'general' }) }); };
  const brief = await planCreativeBrief(input);
  assert.equal(brief.audience, 'general');
  await planCreativeBrief({ ...input, saved: brief });
  assert.equal(calls, 1);
});

test('one validation-guided repair recovers invalid audience without replacing the topic', async () => {
  const prompts = [];
  global.fetch = async (_url, init) => {
    const request = JSON.parse(init.body); prompts.push(request.prompt);
    return Response.json({ response: JSON.stringify({ ...outline, audience: prompts.length === 1 ? '' : 'Curious viewers' }) });
  };
  const brief = await planCreativeBrief(input);
  assert.equal(brief.audience, 'Curious viewers'); assert.equal(prompts.length, 2);
  assert.match(prompts[1], /audience/i);
  assert.ok(prompts[1].includes(input.topic));
});

test('invalid JSON and repeated angle output each get only one targeted repair', async () => {
  for (const bad of ['{"unfinished":', JSON.stringify({ ...outline, angles: Array(3).fill(outline.angles[0]) })]) {
    let calls = 0;
    global.fetch = async () => Response.json({ response: ++calls === 1 ? bad : JSON.stringify(outline) });
    const brief = await planCreativeBrief(input);
    assert.equal(brief.structure, 'explanation'); assert.equal(calls, 2);
  }
});

test('repair exhaustion reports actionable field details without a raw Zod dump', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ response: JSON.stringify({ ...outline, audience: ' ' }) }); };
  await assert.rejects(planCreativeBrief(input), error => {
    assert.match(error.message, /audience/i);
    assert.doesNotMatch(error.message, /"origin"|"code"|"inclusive"/);
    assert.ok(error.message.length < 1500);
    return true;
  });
  assert.equal(calls, 2);
});

test('provider quota, configuration and transport errors escape unchanged without a repair or fallback', async () => {
  const originalGenerate = writer.generateWritingModel;
  try {
    for (const error of [new WritingWaitError('Quota wait', 60000), new WritingConfigurationError('Check writer setup'), new Error('Connection unavailable')]) {
      let calls = 0;
      writer.generateWritingModel = async () => { calls++; throw error; };
      await assert.rejects(planCreativeBrief(input), caught => caught === error);
      assert.equal(calls, 1);
    }
  } finally { writer.generateWritingModel = originalGenerate; }
});

test('quota encountered during repair remains a resumable quota wait', async () => {
  const originalGenerate = writer.generateWritingModel;
  const wait = new WritingWaitError('Quota wait', 60000);
  let calls = 0;
  writer.generateWritingModel = async () => {
    if (++calls === 1) return Response.json({ response: JSON.stringify({ ...outline, audience: '' }) });
    throw wait;
  };
  try { await assert.rejects(planCreativeBrief(input), error => error === wait); assert.equal(calls, 2); }
  finally { writer.generateWritingModel = originalGenerate; }
});

test('children planning uses supported original 2D and keeps action/reaction visual constraints', async () => {
  const children = { ...outline, structure: 'story', audience: 'Children ages 3–6', viewerQuestion: 'How can the two friends pass the garden ball safely?',
    opening: 'The ball rolled away while Pip reached too quickly.',
    beats: [
      { point: 'Pip reaches for the ball and it rolls past him.', visual: 'Wide view: Pip reaches; the ball stays grounded.' },
      { point: 'Coco notices the mistake and offers a slower turn.', visual: 'Reaction view: Coco listens, then holds the ball.' },
      { point: 'Pip waits, and Coco hands the ball to him.', visual: 'Prop-detail view: the ball transfers from Coco to Pip.' },
    ], payoff: 'They pass the ball safely instead of rushing together.', avoid: ['Do not add a third speaking character or duplicate the ball.'] };
  global.fetch = async (_url, init) => {
    const prompt = JSON.parse(init.body).prompt;
    assert.match(prompt, /original limited 2D/);
    assert.match(prompt, /attempt, consequence, reaction and revised action/);
    assert.match(prompt, /give\/pass\/hand should visibly transfer/);
    assert.doesNotMatch(prompt, /For each give a literal visual the current renderer can obtain: actual stock/);
    return Response.json({ response: JSON.stringify(children) });
  };
  const brief = await planCreativeBrief({ ...input, topic: 'Pip and Coco pass a ball', creationType: 'children-story' });
  assert.equal(brief.structure, 'story');
  assert.deepEqual(JSON.parse(creativeBriefInstructions(brief)).visualConstraints, children.beats.map(beat => beat.visual));
});

test('changed planning policy does not reuse an older saved outline', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ response: JSON.stringify(outline) }); };
  const current = await planCreativeBrief(input);
  const renewed = await planCreativeBrief({ ...input, saved: { ...current, version: 1 } });
  assert.equal(calls, 2);
  assert.equal(renewed.version, 2);
});

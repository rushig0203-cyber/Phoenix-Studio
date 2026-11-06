const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { planKidsAnimationScene, planKidsPerformance, kidsAnimationSvg } = require('../src/lib/kidsAnimation');
const cast = ['bunny', 'bear'], names = ['Bunny', 'Bear'];
const drawing = caption => kidsAnimationSvg({ topic: 'Garden friends', caption, index: 0, cast, castNames: names, aspect: '16:9', frame: 0, sceneProgress: .5 });

test('a quoted collective proposal does not make the other actor perform it', () => {
  const caption = 'Bunny said, “Both friends should clap.” Bear waved.';
  assert.deepEqual(planKidsPerformance(caption, cast, names).active, [false, true]);
  const svg = drawing(caption);
  assert.match(svg, /data-actor="0" data-action="listen"/);
  assert.match(svg, /data-actor="1" data-action="wave"/);
});

test('a wish is not an action while the other character actually moves', () => {
  const caption = 'Bunny wanted to hop while Bear waved.';
  assert.equal(planKidsAnimationScene('Garden friends', caption).action, 'wave');
  assert.deepEqual(planKidsPerformance(caption, cast, names).active, [false, true]);
  assert.doesNotMatch(drawing(caption), /data-action="hop"/);
});

test('a negated action and a future handoff do not change the visible object state', () => {
  const caption = 'Bunny never held the ball. Bear waved.';
  assert.notEqual(planKidsAnimationScene('Garden friends', caption).prop, 'ball');
  const held = planKidsAnimationScene('Garden friends', 'Bunny held the letter.');
  for (const proposal of ['Bunny will give Bear the letter.', 'Bunny tried to give Bear the letter.', 'Bunny did not give Bear the letter.']) {
    const scene = planKidsAnimationScene('Garden friends', proposal, 1, held);
    assert.notEqual(scene.intent, 'offer', proposal);
    assert.equal(scene.objectState, 'held', proposal);
    assert.equal(scene.objectOwner, 0, proposal);
  }
});

test('actual shared actions and a real handoff still animate both participants', () => {
  for (const caption of ['Both friends clapped.', 'Together they clapped.', 'Bunny and Bear clapped.', 'Bear and Bunny clapped.']) {
    assert.deepEqual(planKidsPerformance(caption, cast, names).active, [true, true], caption);
    const svg = drawing(caption);
    assert.match(svg, /data-actor="0" data-action="clap"/, caption);
    assert.match(svg, /data-actor="1" data-action="clap"/, caption);
  }
  const caption = 'Bear gave Bunny the letter.';
  assert.equal(planKidsPerformance(caption, cast, names).subject, 1);
  const svg = drawing(caption);
  assert.match(svg, /data-actor="0" data-action="reach"/);
  assert.match(svg, /data-actor="1" data-action="reach"/);
});

test('mentioning friends as the audience does not turn one action into a group action', () => {
  const caption = 'Bunny clapped for their friends while Bear smiled.';
  assert.deepEqual(planKidsPerformance(caption, cast, names).active, [true, false]);
  assert.match(drawing(caption), /data-actor="1" data-action="listen"/);
});

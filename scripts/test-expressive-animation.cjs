const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const sharp = require('sharp');
const { kidsAnimationSvg, kidsAnimationContact, planKidsAnimationScene, planKidsPerformance } = require('../src/lib/kidsAnimation');
const { kidsStoryBeat, kidsPoseBudgets, kidsMouthState, quantizeKidsProgress, KIDS_MAX_UNIQUE_FRAMES } = require('../src/lib/kidsAnimationTimeline');
const { kidsRigMotion } = require('../src/lib/kidsCharacterRig');
sharp.concurrency(1); sharp.cache({ memory: 16, files: 0, items: 16 });
const base = { topic: 'Bunny and Bear share a letter', caption: 'Bunny hands the letter to Bear.', index: 1, cast: ['bunny', 'bear'], castNames: ['Bunny', 'Bear'], aspect: '16:9', frame: 0 };

test('finite anticipation, action, reaction and settled holds never restart at four seconds', () => {
  assert.deepEqual([0, .3, .7, 1].map(p => kidsStoryBeat(p).stage), ['anticipation', 'action', 'reaction', 'settle']);
  assert.notEqual(kidsAnimationSvg({ ...base, frame: 0 }), kidsAnimationSvg({ ...base, frame: 48 }));
  assert.equal(kidsAnimationSvg({ ...base, frame: 48 }), kidsAnimationSvg({ ...base, frame: 240 }));
  assert.equal(quantizeKidsProgress(12, 24), 1);
});

test('measured silence closes both faces and a measured turn opens only its speaker', () => {
  const silent = kidsAnimationSvg({ ...base, performance: { speaker: 1, mouthOpen: 0 }, sceneProgress: .6 });
  assert.equal((silent.match(/data-speaking="false"/g) || []).length, 2);
  assert.doesNotMatch(silent, /data-mouth="(?:0\.4|1)"/);
  const speaking = kidsAnimationSvg({ ...base, performance: { speaker: 1, mouthOpen: .82 }, sceneProgress: .6 });
  assert.match(speaking, /data-actor="0" data-action="reach" data-speaking="false"/);
  assert.match(speaking, /data-actor="1" data-action="reach" data-speaking="true"/);
  assert.equal((speaking.match(/data-mouth="1"/g) || []).length, 1);
  assert.deepEqual(kidsMouthState({ speaker: -1, mouthOpen: .9 }, -1), { speaker: -1, mouthOpen: 1 });
});

test('object transfer has a finite contact path and retains recipient ownership on reaction lines', () => {
  const held = planKidsAnimationScene(base.topic, 'Bunny held the letter.');
  const give = planKidsAnimationScene(base.topic, base.caption, 1, held);
  const response = planKidsAnimationScene(base.topic, 'Bear smiled and thanked her.', 2, give);
  assert.equal(give.intent, 'offer'); assert.equal(give.objectFrom, 0); assert.equal(give.objectOwner, 1);
  assert.equal(response.prop, 'letter'); assert.equal(response.objectOwner, 1);
  const early = kidsAnimationContact('16:9', 0, 0, true), late = kidsAnimationContact('16:9', 1, 0, true);
  assert.ok(late.x > early.x); assert.equal(early.transfer, 0); assert.equal(late.transfer, 1);
  assert.match(kidsAnimationSvg({ ...base, scene: give, sceneProgress: 1 }), /data-contact="hands" data-transfer="1"/);
  assert.equal(planKidsPerformance('Bear gently hands Bunny the letter.', ['bunny', 'bear'], ['Bunny', 'Bear']).subject, 1);
  assert.equal(planKidsPerformance('Bunny gives Bear the ball.', ['bunny', 'bear'], ['Bunny', 'Bear']).subject, 0);
});

test('shots follow action, object detail and a listener reaction rather than an index zoom cycle', () => {
  assert.equal(planKidsAnimationScene('Garden kite', 'They untangled the kite.', 1).shot, 'detail');
  assert.equal(planKidsAnimationScene('Bear and Bunny', 'Bear wondered what to do.', 1).shot, 'reaction');
  assert.equal(planKidsAnimationScene('Bear and Bunny', 'They walked home.', 1).shot, 'wide');
  assert.match(kidsAnimationSvg({ ...base, speaker: 1, mouthOpen: .7, sceneProgress: .5 }), /data-shot="speaker"/);
});

test('a kite rescue shows the knot during the attempt and removes it for the relieved reaction', () => {
  const stuck = planKidsAnimationScene('Garden kite', 'The kite was tangled in a tree branch.');
  const released = planKidsAnimationScene('Garden kite', 'They untangled the kite and smiled.', 1, stuck);
  const options = { ...base, topic: 'Garden kite', caption: 'They untangled the kite and smiled.', scene: released };
  assert.match(kidsAnimationSvg({ ...options, sceneProgress: .3 }), /data-kite-knot="true"/);
  assert.doesNotMatch(kidsAnimationSvg({ ...options, sceneProgress: .8 }), /data-kite-knot="true"/);
  assert.match(kidsAnimationSvg({ ...options, sceneProgress: .3 }), /data-expression="worried"/);
  assert.match(kidsAnimationSvg({ ...options, sceneProgress: .8 }), /data-expression="happy"/);
});

test('the rendered ribbon-holding and attempted-untangle cues preserve the existing knot', () => {
  const topic = 'Benny and Tika untangle a garden kite';
  const stuck = planKidsAnimationScene(topic, "Benny's bright kite snagged in a low tree.");
  for (const text of [
    'Tika held the ribbon steady while Benny rested his paws.',
    'They tried to untangle the ribbon.',
    'They had not yet untangled the ribbon.',
    'Benny said, “I want to fly it now!”',
    'We will fly it later.',
  ]) {
    const scene = planKidsAnimationScene(topic, text, 1, stuck);
    assert.equal(scene.kiteState, 'tangled', text); assert.equal(scene.kiteCaughtHigh, true, text);
    const svg = kidsAnimationSvg({ ...base, topic, caption: text, scene, sceneProgress: .9, cast: ['bunny', 'bird'], castNames: ['Benny', 'Tika'] });
    assert.match(svg, /data-kite-knot="true"/, text);
  }
});

test('actual kite ascent and observed flight are distinct from hopes, other flyers and lifted spools', () => {
  const topic = 'Benny and Tika untangle a garden kite';
  const stuck = planKidsAnimationScene(topic, 'The kite was tangled in a tree branch.');
  const free = planKidsAnimationScene(topic, 'Together they untangled the ribbon, one gentle loop at a time.', 1, stuck);
  const ascent = planKidsAnimationScene(topic, 'The kite lifted above the flowers without another tug.', 2, free);
  const final = planKidsAnimationScene(topic, 'Benny waved with a happy smile, and the two friends watched their kite fly.', 3, ascent);
  assert.equal(free.action, 'reach'); assert.equal(ascent.kiteState, 'flying'); assert.equal(final.kiteState, 'flying');
  assert.equal(planKidsAnimationScene(topic, 'Tika held the straight kite string.', 4, final).kiteState, 'flying');
  assert.equal(planKidsAnimationScene(topic, 'Tika held the kite string steady.', 4, final).kiteState, 'flying');
  for (const text of ['I want to fly it now.', 'We hope the kite flies.', 'If the kite rises, we will cheer.', 'Benny lifted the spool.', 'They watched a bird fly beside the kite.']) {
    assert.equal(planKidsAnimationScene(topic, text, 2, free).kiteState, 'held', text);
  }
});

test('kite holders use their own reachable hand while the partner listens, and cooperative untangling has two bounded reaches', () => {
  const topic = 'Benny and Tika untangle a garden kite';
  for (const owner of [0, 1]) {
    const caption = `${owner ? 'Tika' : 'Benny'} held the kite string while ${owner ? 'Benny' : 'Tika'} watched the kite fly.`;
    const scene = planKidsAnimationScene(topic, caption, 3);
    scene.objectOwner = owner; scene.objectState = 'held';
    const svg = kidsAnimationSvg({ ...base, topic, caption, scene, sceneProgress: .85, cast: ['bunny', 'bird'], castNames: ['Benny', 'Tika'] });
    assert.match(svg, new RegExp(`data-actor="${owner}" data-action="reach"`));
    assert.match(svg, new RegExp(`data-actor="${1 - owner}" data-action="listen"`));
    const targets = [...svg.matchAll(/data-hand-target="([^,]+),([^"]+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
    assert.equal(targets.length, 1); assert.ok(Math.abs(targets[0][0]) <= 86.01);
  }
  const stuck = planKidsAnimationScene(topic, 'The kite was tangled in a tree branch.');
  const cooperation = planKidsAnimationScene(topic, 'Together they untangled the ribbon, one gentle loop at a time.', 1, stuck);
  const svg = kidsAnimationSvg({ ...base, topic, caption: 'Together they untangled the ribbon, one gentle loop at a time.', scene: cooperation, sceneProgress: .45, cast: ['bunny', 'bird'], castNames: ['Benny', 'Tika'] });
  assert.match(svg, /data-actor="0" data-action="reach"/); assert.match(svg, /data-actor="1" data-action="reach"/);
  const targets = [...svg.matchAll(/data-hand-target="([^,]+),([^"]+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.equal(targets.length, 2); assert.ok(targets.every(([x]) => Math.abs(x) <= 86.01));
  assert.ok(targets[0][0] > 0 && targets[1][0] < 0); assert.match(svg, /data-kite-knot="true"/);
});

test('tiny native vector proof shows holding, cooperation, ascent and the final flight without a crossed arm', async () => {
  const topic = 'Benny and Tika untangle a garden kite';
  const lines = [
    "Benny's bright kite snagged in a low tree.",
    'Tika held the ribbon steady while Benny rested his paws.',
    'Together they untangled the ribbon, one gentle loop at a time.',
    'The kite lifted above the flowers without another tug.',
    'Benny waved with a happy smile, and the two friends watched their kite fly.',
  ];
  const scenes = [];
  for (const [index, caption] of lines.entries()) {
    const scene = planKidsAnimationScene(topic, caption, index, scenes[index - 1]);
    if (index > 0) scene.objectOwner = 1;
    scenes.push(scene);
  }
  const panels = [];
  for (const [panel, index] of [1, 2, 3, 4].entries()) {
    const progress = index === 2 ? .45 : .9;
    const svg = kidsAnimationSvg({ ...base, topic, caption: lines[index], index, scene: scenes[index], sceneProgress: progress, aspect: '9:16', cast: ['bunny', 'bird'], castNames: ['Benny', 'Tika'] });
    assert.doesNotMatch(svg, /NaN|undefined/);
    const input = await sharp(Buffer.from(svg)).resize(270, 480).png().toBuffer();
    panels.push({ input, left: panel * 270, top: 0 });
  }
  const result = sharp({ create: { width: 1080, height: 480, channels: 4, background: '#fff5e4' } }).composite(panels).png();
  if (process.env.PHOENIX_KITE_PROOF_FILE) await result.toFile(process.env.PHOENIX_KITE_PROOF_FILE);
  else assert.ok((await result.toBuffer()).length > 20000);
});

test('all pose allocations have a fixed raster ceiling across long narration and dialogue', () => {
  for (const signatures of [Array(20).fill(1), Array(28).fill(3), Array(60).fill(7), [1, 3, 7, 2, 1]]) {
    const budget = kidsPoseBudgets(signatures);
    assert.ok(budget.every(value => value >= 1 && value <= 36));
    assert.ok(budget.reduce((sum, value, i) => sum + value * signatures[i], 0) <= KIDS_MAX_UNIQUE_FRAMES);
  }
  assert.throws(() => kidsPoseBudgets(Array(129).fill(1)), /128/);
  assert.throws(() => kidsPoseBudgets(Array(120).fill(7)), /drawing budget/);
});

test('original profiles have complete articulated limbs and grounded one-shot jumps', () => {
  const pose = { action: 'hop', progress: .45, emotion: 'happy', facing: 1, mouthOpen: 0, speaking: false, second: false };
  const launch = kidsRigMotion({ ...pose, progress: .1 }), flight = kidsRigMotion(pose), end = kidsRigMotion({ ...pose, progress: 1 });
  assert.equal(launch.lift, 0); assert.ok(launch.scaleY < 1); assert.ok(flight.lift > 40); assert.equal(end.lift, 0);
  assert.ok(Math.abs(flight.scaleX * flight.scaleY - 1) < .001);
  const svg = kidsAnimationSvg({ ...base, sceneProgress: .6 });
  assert.match(svg, /data-facing="1"/); assert.match(svg, /data-facing="-1"/);
  assert.equal((svg.match(/data-limb="leg"/g) || []).length, 4);
  assert.equal((svg.match(/data-limb="near-arm"/g) || []).length, 2);
  assert.equal((svg.match(/data-limb="far-arm"/g) || []).length, 2);
});

test('action/reaction staging changes visible pixels in small real raster samples', async () => {
  const images = [];
  for (const progress of [.08, .48, .9]) {
    const svg = kidsAnimationSvg({ ...base, sceneProgress: progress, performance: { speaker: 1, mouthOpen: progress === .48 ? .8 : 0 } });
    assert.doesNotMatch(svg, /NaN|undefined|<image/);
    images.push(await sharp(Buffer.from(svg)).resize(360, 203).removeAlpha().raw().toBuffer());
  }
  assert.notDeepEqual(images[0], images[1]); assert.notDeepEqual(images[1], images[2]);
});

test('visual alignment: train, started and balloon never invent rain, stars or a ball', () => {
  const topic = 'A train started a balloon search';
  const caption = 'The train started beside a balloon.';
  const scene = planKidsAnimationScene(topic, caption);
  assert.equal(scene.prop, 'none'); assert.equal(scene.theme, 'garden'); assert.equal(scene.action, 'sway');
  const svg = kidsAnimationSvg({ ...base, topic, caption, scene });
  assert.doesNotMatch(svg, /fill="#eab674"|fill="#f9dd83"|stroke="#72bdda"/);
  assert.equal(planKidsAnimationScene('Friends', 'Bunny hopped beside the flowers.').action, 'hop');
  assert.equal(planKidsAnimationScene('Friends', 'Bird flapped its wings.').action, 'flap');
});

test('visual alignment: an explicit ball persists across pronouns despite the kite topic', () => {
  const topic = 'Garden kite';
  const held = planKidsAnimationScene(topic, 'Bunny held the ball.');
  const reaction = planKidsAnimationScene(topic, 'He smiled at it.', 1, held);
  assert.equal(held.prop, 'ball'); assert.equal(reaction.prop, 'ball');
  const svg = kidsAnimationSvg({ ...base, topic, caption: 'He smiled at it.', scene: reaction });
  assert.match(svg, /<ellipse cx="0" cy="0" rx="28" ry="28" fill="#eab674"/);
  assert.doesNotMatch(svg, /data-kite-state/);
  assert.equal(planKidsAnimationScene(topic, 'Bunny picked up the letter.', 2, reaction).prop, 'letter');
});

test('visual alignment: the first textual giver wins over cast ordering and a later holder', () => {
  const caption = 'Bear hands Bunny the letter. Bunny holds it carefully.';
  const planned = planKidsPerformance(caption, ['bunny', 'bear'], ['Bunny', 'Bear']);
  assert.equal(planned.subject, 1);
  const scene = planKidsAnimationScene(base.topic, caption, 1);
  const early = kidsAnimationSvg({ ...base, caption, scene, sceneProgress: .1 });
  const late = kidsAnimationSvg({ ...base, caption, scene, sceneProgress: 1 });
  const letterX = svg => Number(svg.match(/data-object-state="offered" transform="translate\(([^ ]+) /)[1]);
  assert.ok(letterX(late) < letterX(early), 'The letter moves from Bear on the right to Bunny on the left in the actual preview SVG');
});

test('visual alignment: later object actions retain the actual giver and holder after an earlier wave', () => {
  for (const caption of [
    'Bear waves. Bear hands Bunny the letter. Bunny holds it.',
    'Bunny holds the letter. Bear waves, then Bear hands Bunny the letter.',
  ]) {
    const planned = planKidsPerformance(caption, ['bunny', 'bear'], ['Bunny', 'Bear']);
    assert.equal(planned.actions[1], 'wave'); assert.equal(planned.subject, 1);
    const scene = planKidsAnimationScene(base.topic, caption, 1);
    const early = kidsAnimationSvg({ ...base, caption, scene, sceneProgress: .1 });
    const late = kidsAnimationSvg({ ...base, caption, scene, sceneProgress: 1 });
    assert.match(early, /data-actor="1" data-action="reach"/);
    assert.match(late, /data-actor="0" data-action="reach"/);
    const letterX = svg => Number(svg.match(/data-object-state="offered" transform="translate\(([^ ]+) /)[1]);
    assert.ok(letterX(late) < letterX(early), 'The later narrated handoff still travels from Bear to Bunny');
  }
  const caption = 'Bear waves, then Bear held the ball.';
  const planned = planKidsPerformance(caption, ['bunny', 'bear'], ['Bunny', 'Bear']);
  assert.equal(planned.subject, 1); assert.equal(planned.actions[1], 'wave');
  const scene = planKidsAnimationScene('Friends', caption, 1);
  const svg = kidsAnimationSvg({ ...base, topic: 'Friends', caption, scene, sceneProgress: .45 });
  assert.match(svg, /data-actor="1" data-action="wave"/);
  const ballX = Number(svg.match(/data-object-state="held" transform="translate\(([^ ]+) /)[1]);
  assert.ok(ballX > 480, 'The ball is attached to Bear on the right, not the default first actor');
});

test('visual alignment: a kite string follows its actual waving or hopping holder without a duplicate kite', () => {
  const endpoint = svg => svg.match(/data-contact="kite-string" d="M[-\d.]+ [-\d.]+ Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)"/).slice(1).map(Number);
  for (const owner of [0, 1]) {
    const holder = owner ? 'Bear' : 'Bunny', listener = owner ? 'Bunny' : 'Bear';
    const held = planKidsAnimationScene('Garden kite', `${holder} held the kite string.`);
    held.objectOwner = owner;
    for (const verb of ['waves', 'hops']) {
      const caption = `${holder} ${verb} while ${listener} watches.`;
      const scene = planKidsAnimationScene('Garden kite', caption, 1, held);
      const options = { ...base, topic: 'Garden kite', caption, scene };
      const rest = kidsAnimationSvg({ ...options, sceneProgress: .1 });
      const active = kidsAnimationSvg({ ...options, sceneProgress: .45 });
      assert.match(active, new RegExp(`data-actor="${owner}" data-action="${verb === 'waves' ? 'wave' : 'hop'}"`));
      assert.ok(endpoint(active)[1] < endpoint(rest)[1] - (verb === 'waves' ? 50 : 20), 'The actual string endpoint rises with its holder hand');
      assert.equal((active.match(/data-kite-state=/g) || []).length, 1);
      assert.doesNotMatch(active, /data-contact="hands"/);
    }
  }
});

test('visual alignment: named actions remain distinct while a held ball follows its owner', async () => {
  const caption = 'Bunny hops while Bear watches.';
  const held = planKidsAnimationScene('Garden kite', 'Bunny held the ball.');
  const scene = planKidsAnimationScene('Garden kite', caption, 1, held);
  const options = { ...base, topic: 'Garden kite', caption, scene };
  const rest = kidsAnimationSvg({ ...options, sceneProgress: .1 });
  const hop = kidsAnimationSvg({ ...options, sceneProgress: .45 });
  assert.match(hop, /data-actor="0" data-action="hop"/);
  assert.match(hop, /data-actor="1" data-action="listen"/);
  const ballY = svg => Number(svg.match(/data-object-state="held" transform="translate\([^ ]+ ([^)]+)\)/)[1]);
  assert.ok(ballY(hop) < ballY(rest) - 20, 'The actual ball geometry rises with the hopping hand');
  const raster = await sharp(Buffer.from(hop)).resize(160, 90).png().toBuffer({ resolveWithObject: true });
  assert.equal(raster.info.width, 160); assert.ok(raster.data.length > 1000);
  const waveCaption = 'Bunny waves while Bear watches.';
  const waveScene = planKidsAnimationScene('Garden kite', waveCaption, 1, held);
  const wave = kidsAnimationSvg({ ...options, caption: waveCaption, scene: waveScene, sceneProgress: .45 });
  assert.match(wave, /data-actor="0" data-action="wave"/);
  assert.ok(ballY(wave) < ballY(rest) - 50, 'A retained ball follows the actual raised waving hand');
  const separate = kidsAnimationSvg({ ...base, topic: 'Friends', caption: 'Bunny hops while Bear waves.', sceneProgress: .45 });
  assert.match(separate, /data-actor="0" data-action="hop"/);
  assert.match(separate, /data-actor="1" data-action="wave"/);
});

test('visual alignment: supported explicit settings persist through reaction lines', () => {
  const topic = 'Garden kite';
  const room = planKidsAnimationScene(topic, 'Bunny walked inside the playroom.');
  const reaction = planKidsAnimationScene(topic, 'Bear held a star and smiled.', 1, room);
  assert.equal(room.theme, 'room'); assert.equal(reaction.theme, 'room');
  const svg = kidsAnimationSvg({ ...base, topic, caption: 'Bear held a star and smiled.', scene: reaction });
  assert.match(svg, /fill="#fff0d9"/); assert.doesNotMatch(svg, /data-layer="garden-detail"/);
  const garden = planKidsAnimationScene(topic, 'They walked into the garden.', 2, reaction);
  const night = planKidsAnimationScene(topic, 'They rested at night.', 3, garden);
  const ocean = planKidsAnimationScene(topic, 'The friends met underwater.', 4, night);
  assert.equal(garden.theme, 'garden'); assert.equal(night.theme, 'night'); assert.equal(ocean.theme, 'ocean');
});

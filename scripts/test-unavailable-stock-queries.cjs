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
const semantics = load('src/lib/footageSemantics.ts', { './stockBrief': brief });
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
    './writingModel': writing, './newsVisualPolicy': news, './footageSemantics': semantics });
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

test('a mini-doc scene with no supported action keeps the exact footage, narration and spent repair for retry', async () => {
  const start = { narration: 'The jellyfish drifts in the water.', query: 'jellyfish drifting', footage: footage(901, 'jellyfish drifting') };
  const ending = { narration: 'Watch the jellyfish pulse to move forward.', query: 'jellyfish pulsing' };
  const input = { ...base, topic: 'How a jellyfish moves', script: start.narration + ' ' + ending.narration,
    narrationPresentation: 'measured-speech-v1', recommendation: { id: 'jellyfish-pulse:adaptation', visualSubject: 'jellyfish' } };
  const search = async () => [footage(7, 'quiet waves'), footage(8, 'jellyfish in water')];
  const h = harness({ reply: [start.query, 'jellyfish contracting'], search });
  await assert.rejects(h.preparation.prepareStockCreation(input, [start, ending], h.checkpoint), /Scene 2.*planned subject and action/);
  assert.equal(h.calls.writer.length, 1);
  const saved = h.calls.checkpoints.at(-1).input;
  assert.equal(saved.stockPreparation.repairUsed, true);
  assert.equal(saved.stockPreparation.scenes[0].footage.id, 901);
  assert.equal(saved.stockPreparation.scenes[1].query, 'jellyfish contracting');
  const resumed = harness({ search });
  await assert.rejects(resumed.preparation.prepareStockCreation(saved, saved.stockPreparation.scenes, resumed.checkpoint), /Scene 2/);
  assert.equal(resumed.calls.writer.length, 0);
  assert.ok(resumed.calls.search.every(([query]) => query === 'jellyfish contracting'));
});

const snailPlan = [
  { narration: 'A snail moves slowly across a leaf.', query: 'snail moving on leaf', footage: footage(32245168, 'slow moving snail on fresh green leaf', { duration: 13 }) },
  { narration: 'Its muscular foot plays a key role, producing mucus to reduce friction and help it glide.', query: 'snail gliding', footage: footage(8225194, 'a snail gliding on a wet surface', { duration: 31 }) },
  { narration: 'The foot muscles contract and relax, creating a wave-like motion that allows the snail to move forward without legs.', query: 'snail foot muscles contracting' },
  { narration: "The snail's unique muscular foot and mucus production enable it to move without legs.", query: 'snail foot gliding forward' },
];
const duckPlan = [
  { narration: "A duck's feathers are its most valuable asset, but how does it keep them clean and waterproof?", query: 'duck preening its feathers', footage: footage(40246009, 'duck on river rocks preening feathers', { duration: 37 }) },
  { narration: 'A duck uses its beak to preen its feathers, and its oil glands produce a special oil that helps to waterproof them, which it spreads evenly to keep them dry and healthy.', query: 'duck preening its feathers with beak' },
];
const natureInput = (plan, subject, duration) => ({ ...base, topic: `How a ${subject} moves and cares for itself`, duration,
  script: plan.map(scene => scene.narration).join(' '), narrationPresentation: 'measured-speech-v1', autoDuration: true,
  recommendation: { id: `${subject}:adaptation`, visualSubject: subject } });

test('exact failed snail anatomy plan continues selected gliding footage without another search or model repair', async () => {
  const before = plain(snailPlan), h = harness();
  const input = { ...natureInput(snailPlan, 'snail', 26), stockPreparation: { version: 1, scenes: snailPlan, repairUsed: true } };
  const result = await h.preparation.prepareStockCreation(input, snailPlan, h.checkpoint);
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(plain(result.scenes.map(scene => scene.footage.id)), [32245168, 8225194]);
  assert.equal(result.scenes[1].query, 'snail gliding');
  assert.equal(result.scenes.map(scene => scene.narration).join(' '), input.script);
  assert.match(result.scenes[1].footageReason, /Continuous snail gliding.*No replay or slowdown/);
  assert.equal(result.input.stockPreparation.repairUsed, true);
  assert.equal(h.calls.search.length, 0); assert.equal(h.calls.writer.length, 0);
  assert.deepEqual(snailPlan, before, 'Saved/caller narration and selected footage are not mutated');
  const retry = harness();
  const resumed = await retry.preparation.prepareStockCreation(result.input, result.scenes, retry.checkpoint);
  assert.deepEqual(plain(resumed.scenes), plain(result.scenes));
  assert.equal(retry.calls.search.length, 0); assert.equal(retry.calls.writer.length, 0);
});

test('new generated snail plans normalize invisible anatomy before search and retain every sentence', async () => {
  const h = harness({ reply: snailPlan.map(scene => scene.query), search: async query => query === snailPlan[0].query
    ? [snailPlan[0].footage] : query === 'snail gliding' ? [snailPlan[1].footage] : [] });
  const input = natureInput(snailPlan, 'snail', 26);
  const result = await h.preparation.prepareStockCreation(input, [], h.checkpoint);
  assert.equal(h.calls.writer.length, 1); assert.equal(h.calls.search.length, 2);
  assert.match(h.calls.writer[0].prompt, /Do not claim stock proves muscle contractions/);
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes.map(scene => scene.narration).join(' '), input.script);
  assert.ok(h.calls.search.every(([query]) => !/muscles|foot/.test(query)));
});

test('exact failed duck plan keeps a single continuous 37-second preening asset for its 23-second narration', async () => {
  const h = harness(), input = natureInput(duckPlan, 'duck', 23);
  const result = await h.preparation.prepareStockCreation(input, duckPlan, h.checkpoint);
  assert.equal(result.scenes.length, 1); assert.equal(result.scenes[0].footage.id, 40246009);
  assert.equal(result.scenes[0].narration, input.script);
  assert.equal(result.scenes[0].query, duckPlan[0].query);
  assert.match(result.scenes[0].footageReason, /28\.6s.*No replay or slowdown/);
  assert.equal(h.calls.search.length, 0); assert.equal(h.calls.writer.length, 0);
});

test('continuing narration cannot overrun a short source or replay it; a distinct suitable source is selected', async () => {
  const plan = [{ ...duckPlan[0], footage: { ...duckPlan[0].footage, duration: 20 } }, duckPlan[1]];
  const h = harness({ search: async () => [plan[0].footage, footage(81, 'duck preening feathers', { duration: 25 })] });
  const result = await h.preparation.prepareStockCreation(natureInput(plan, 'duck', 23), plan, h.checkpoint);
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(plain(result.scenes.map(scene => scene.footage.id)), [40246009, 81]);
  assert.equal(h.calls.search.length, 1); assert.equal(h.calls.writer.length, 0);
  const unavailable = harness({ search: async () => [plan[0].footage] });
  await assert.rejects(unavailable.preparation.prepareStockCreation({ ...natureInput(plan, 'duck', 23), stockPreparation: { version: 1, scenes: plan, repairUsed: true } }, plan, unavailable.checkpoint), /Scene 2.*no distinct clip/);
  assert.equal(unavailable.calls.checkpoints.at(-1).selected.length, 2);
});

test('visible action evidence supports snail crawling without requiring anatomy, while rejecting still or different animals', () => {
  const h = harness(), options = { subject: 'snail' };
  assert.equal(h.storyboard.stockQueryMismatch(snailPlan[2].narration, 'snail crawling', 'snail'), undefined);
  assert.equal(h.storyboard.stockQueryMismatch(snailPlan[2].narration, 'snail resting', 'snail'), 'the visible gliding action');
  assert.equal(h.storyboard.stockQueryMismatch('The jellyfish contracts its bell.', 'jellyfish drifting', 'jellyfish'), 'the visible pulsing action');
  const choices = [footage(1, 'snail resting on a leaf'), footage(2, 'slug crawling on wet surface'), footage(3, 'snail crawling on wet surface'), footage(4, 'robotic snail crawling')];
  assert.deepEqual(plain(h.automatic.rankFootage(choices, 'snail gliding', 10, '9:16', new Set(), undefined, undefined, options).map(item => item.choice.id)), [3]);
  assert.equal(semantics.natureIllustrativeQuery(snailPlan[2].narration, 'snail foot muscles contracting underwater', 'snail'), 'snail foot muscles contracting underwater', 'Specific settings are not silently discarded');
});

test('same action in a different setting is not merged, and owner or approved plans are never rewritten', async () => {
  const plan = [duckPlan[0], { ...duckPlan[1], query: 'duck preening feathers pond' }];
  const h = harness({ search: async () => [footage(82, 'duck preening feathers pond')] });
  const result = await h.preparation.prepareStockCreation(natureInput(plan, 'duck', 23), plan, h.checkpoint);
  assert.equal(result.scenes.length, 2); assert.equal(result.scenes[1].footage.id, 82);
  for (const extra of [{ scriptOrigin: 'owner' }, { scriptApproved: true }, { visualTerms: ['duck preening feathers'], visualTermsOrigin: 'owner' }]) {
    const locked = harness();
    await assert.rejects(locked.preparation.prepareStockCreation({ ...natureInput(duckPlan, 'duck', 23), ...extra }, duckPlan, locked.checkpoint), /no distinct/);
    assert.deepEqual(locked.calls.checkpoints.at(-1).selected, plain(duckPlan));
    assert.equal(locked.calls.writer.length, 0);
  }
});

test('typed animal preparation rejects saved human detail and animal-shaped objects without replacing media', async () => {
  for (const [topic, narration, query, title] of [
    ['How an octopus explores with its arms', 'An octopus explores with its arms.', 'octopus arms', 'colorful octopus kites with long arms'],
    ["Watch how a deer's ears turn", 'A deer turns its ears.', 'ears close up', 'close up video of a human ear'],
  ]) {
    const h = harness();
    const saved = [{ narration, query, footage: footage(701, title) }];
    const before = plain(saved);
    await assert.rejects(h.preparation.prepareStockCreation({ ...base, topic, script: narration }, saved, h.checkpoint), /different narrated action|saved footage does not support/);
    assert.deepEqual(saved, before);
    assert.equal(h.calls.search.length, 0);
    assert.equal(h.calls.writer.length, 0);
  }
});

test('typed nature preparation uses real subject evidence even without recommendation metadata', async () => {
  const h = harness({ search: async query => [footage(1, 'octopus arms painted on a human arm'), footage(2, 'octopus arms moving underwater')] });
  const narration = 'An octopus moves its arms underwater.';
  const result = await h.preparation.prepareStockCreation({ ...base, duration: 20, topic: 'How an octopus explores with its arms', script: narration }, [{ narration, query: 'octopus arms' }], h.checkpoint);
  assert.equal(result.scenes[0].footage.id, 2);
  assert.equal(h.calls.writer.length, 0);
});

test('generated nature narration must name its subject before footage selection while owner words stay authoritative', async () => {
  const narration = 'Its arms move along the seabed.';
  const scene = { narration, query: 'octopus arms' };
  const input = { ...base, duration: 20, topic: 'How an octopus explores with its arms', script: narration };
  const generated = harness();
  await assert.rejects(generated.preparation.prepareStockCreation(input, [scene], generated.checkpoint), /narration does not name its octopus subject/);
  assert.equal(generated.calls.checkpoints.at(-1).input.script, narration);
  assert.equal(generated.calls.writer.length, 0); assert.equal(generated.calls.search.length, 0);
  const owner = harness({ search: async () => [footage(2, 'octopus arms moving underwater')] });
  const result = await owner.preparation.prepareStockCreation({ ...input, scriptOrigin: 'owner' }, [scene], owner.checkpoint);
  assert.equal(result.input.script, narration); assert.equal(result.scenes[0].footage.id, 2);
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

test('missing news stock tries related alternatives before another writer request, preserving saved shots', async () => {
  const research = { title: 'How America voted in maps and charts', summary: 'US midterm elections explained.', text: 'The report concerns election outcomes.' };
  const earlier = { narration: 'Here are the election results.', query: 'government building', footage: footage(50, 'government building') };
  const plan = [earlier, { narration: 'The results for Congress are projected.', query: 'political map' }];
  const h = harness({ search: async query => query === 'government building'
    ? [earlier.footage, footage(51, 'government building with crowds')]
    : query === 'parliament building' ? [footage(52, 'parliament building'), footage(53, 'parliament building', { duration: 2 })] : [] });
  const input = { ...base, topic: research.title, script: plan.map(beat => beat.narration).join(' '), research };
  const result = await h.preparation.prepareStockCreation(input, plan, h.checkpoint);
  assert.deepEqual(plain(result.scenes[0]), earlier);
  assert.equal(result.scenes[1].footage.id, 52);
  assert.equal(result.scenes[1].query, 'parliament building');
  assert.equal(h.calls.writer.length, 0);
  assert.equal(h.calls.search.length, 5, 'Three initial lookups and two bounded alternatives');
  const owner = harness();
  await assert.rejects(owner.preparation.prepareStockCreation({ ...input, scriptApproved: true }, plan, owner.checkpoint), /Section 2.*no distinct/);
  assert.equal(owner.calls.writer.length, 0);
  assert.equal(owner.calls.search.length, 3);
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

const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const {
  CREATION_KINDS, RECOMMENDATION_GROUPS, RECOMMENDATION_HISTORY_LIMIT,
  recommendationPool, canonicalRecommendationKey, creationRecommendations,
  emptyRecommendationMemory, parseRecommendationMemory, nextStoredRecommendations, applyRecommendationToForm,
  personalizedCreationRecommendations, parsePersonalizedRecommendationMemory,
} = require('../src/lib/creationRecommendations');
const { publishingProfile } = require('../src/lib/publishingFormats');

test('one mixed catalogue covers all eight subject groups and only supported creation types', () => {
  const pool = recommendationPool();
  assert.ok(pool.length > 60);
  assert.ok(pool.length >= 97, 'A larger finite bank adds genuinely different visual subjects');
  assert.ok(RECOMMENDATION_HISTORY_LIMIT >= pool.length, 'History must cover the full bank, not forget old topics before new ones are explored');
  assert.ok(pool.filter(idea => idea.title.includes(' — ')).length >= 70, 'Rich visible premises contain an angle/ending rather than only a headline');
  assert.ok(pool.every(idea => idea.title.length <= 400));
  assert.equal(new Set(pool.map(idea => idea.id)).size, pool.length);
  assert.deepEqual(new Set(pool.map(idea => idea.category)), new Set(RECOMMENDATION_GROUPS));
  for (const idea of pool) {
    assert.ok(CREATION_KINDS.includes(idea.kind));
    assert.ok(idea.topicKey && idea.angleKey && idea.title);
    if (idea.kind.startsWith('Children')) assert.equal(idea.audience, 'Ages 3–6');
  }
  let state = emptyRecommendationMemory();
  const groups = new Set();
  for (let i = 0; i < 2; i++) {
    const batch = creationRecommendations(state);
    assert.equal(new Set(batch.ideas.map(idea => idea.category)).size, 6);
    batch.ideas.forEach(idea => groups.add(idea.category));
    state = batch.memory;
  }
  assert.deepEqual(groups, new Set(RECOMMENDATION_GROUPS));
});

test('persisted history avoids canonical subjects across visits until the catalogue is explored', () => {
  let stored = null;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  const seen = new Set();
  const subjectCount = new Set(recommendationPool().map(idea => idea.topicKey)).size;
  for (let visit = 0; visit < Math.floor(subjectCount / 6); visit++) {
    const batch = nextStoredRecommendations(storage);
    assert.equal(batch.ideas.length, 6);
    assert.equal(batch.remembered, true);
    for (const idea of batch.ideas) {
      assert.equal(seen.has(idea.topicKey), false, `repeated subject ${idea.topicKey}`);
      seen.add(idea.topicKey);
    }
  }
  assert.equal(canonicalRecommendationKey('  Bird NEST!! '), canonicalRecommendationKey('bird-nest'));
  assert.equal(canonicalRecommendationKey('Ｂｉｒｄ nest'), 'bird-nest');
  const versions = recommendationPool().filter(idea => idea.topicKey === 'bird-nest');
  assert.ok(versions.length >= 2, 'different headlines share one subject key');
});

test('cycling remains bounded, diversifies angles and never repeats a subject inside a batch', () => {
  let memory = emptyRecommendationMemory();
  let previous = [];
  const ids = new Set();
  for (let i = 0; i < 80; i++) {
    const batch = creationRecommendations(memory);
    assert.equal(batch.ideas.length, 6);
    assert.equal(new Set(batch.ideas.map(idea => idea.topicKey)).size, 6);
    assert.ok(batch.ideas.every(idea => !previous.includes(idea.topicKey)));
    assert.ok(batch.memory.shown.length <= RECOMMENDATION_HISTORY_LIMIT);
    batch.ideas.forEach(idea => ids.add(idea.id));
    previous = batch.ideas.map(idea => idea.topicKey);
    memory = parseRecommendationMemory(JSON.stringify(batch.memory));
  }
  assert.equal(ids.size, recommendationPool().length, 'alternative angles eventually appear');
});

test('malformed, stale and hostile browser history is discarded without crashing', () => {
  for (const raw of [null, '{bad', 'null', '[]', '"text"', JSON.stringify({ version: 9, shown: [] }), 'x'.repeat(32769)]) {
    assert.deepEqual(parseRecommendationMemory(raw), emptyRecommendationMemory());
  }
  const id = recommendationPool()[0].id;
  assert.deepEqual(parseRecommendationMemory(JSON.stringify({ version: 1, shown: [null, {}, 'unknown', id, id], cursor: -9 })), { version: 1, shown: [id], cursor: 0 });
  assert.deepEqual(parseRecommendationMemory(JSON.stringify({ version: 1, shown: ['unknown'], cursor: '999' })), emptyRecommendationMemory());
});

test('storage denied or quota exhausted still rotates suggestions within the current screen', () => {
  for (const storage of [
    { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } },
    { getItem: () => null, setItem: () => { throw new Error('quota'); } },
  ]) {
    const first = nextStoredRecommendations(storage);
    const second = nextStoredRecommendations(storage, first.memory);
    assert.equal(first.remembered, false);
    assert.equal(second.remembered, false);
    assert.ok(second.ideas.every(idea => !first.ideas.some(prior => prior.topicKey === idea.topicKey)));
  }
});

test('choosing a mixed idea changes its supported type, not song source, owner writing or recording', () => {
  const songAudio = { id: 'owner-audio', filename: 'our-original-song.wav' };
  const current = { kind: 'General video', topic: 'Earlier idea', autoIdea: true, publishingFormat: 'instagram-reel', duration: 90, batchCount: 1, narration: 'Owner supplied narration', lyrics: 'Owner exact sung words', songMode: 'recording', songAudio, visualBrief: 'Owner footage request' };
  for (const kind of CREATION_KINDS) {
    const idea = recommendationPool().find(item => item.kind === kind);
    const next = applyRecommendationToForm(current, idea);
    assert.equal(next.kind, kind);
    assert.equal(next.topic, idea.title);
    assert.equal(next.autoIdea, false);
    assert.equal(next.songMode, 'recording');
    assert.equal(next.songAudio, songAudio);
    assert.equal(next.lyrics, current.lyrics);
    assert.equal(next.narration, current.narration);
    assert.equal(next.visualBrief, current.visualBrief);
    assert.equal(next.batchCount, 1, 'owner narration remains a standalone video');
    if (kind === 'General video') {
      assert.equal(next.duration, 90);
      assert.equal(next.publishingFormat, current.publishingFormat);
    } else if (kind === "Children's song") {
      assert.equal(next.publishingFormat, 'youtube-full');
      assert.equal(next.duration, publishingProfile('youtube-full').defaultDuration);
      assert.ok(next.duration >= 150);
    } else assert.equal(next.publishingFormat, 'youtube-short');
  }
  const idea = recommendationPool()[0];
  assert.equal(applyRecommendationToForm(current, { ...idea, id: 'unknown' }), current);
  assert.equal(applyRecommendationToForm(current, { ...idea, kind: 'Unsupported type' }).kind, idea.kind);
  const child = recommendationPool().find(item => item.kind === "Children's short story");
  assert.equal(applyRecommendationToForm({ ...current, narration: '' }, child).batchCount, 1);
  assert.equal(applyRecommendationToForm({ ...current, kind: child.kind, batchCount: 10, narration: '' }, child).batchCount, 10);
});

test('every displayed card inserts its exact title throughout repeated recommendation rotations', () => {
  const current = { kind: 'General video', topic: 'Earlier idea', autoIdea: true, publishingFormat: 'instagram-reel', duration: 90, batchCount: 1, narration: '' };
  let memory = emptyRecommendationMemory();
  const selectedIds = new Set();
  for (let rotation = 0; rotation < 80; rotation++) {
    const batch = creationRecommendations(memory);
    for (const displayed of batch.ideas) {
      const next = applyRecommendationToForm(current, displayed);
      assert.equal(next.topic, displayed.title, `wrong sentence for ${displayed.id} at rotation ${rotation}`);
      assert.equal(next.kind, displayed.kind);
      selectedIds.add(displayed.id);
    }
    memory = parseRecommendationMemory(JSON.stringify(batch.memory));
  }
  assert.equal(selectedIds.size, recommendationPool().length, 'all catalogue cards were selected');
});

test('a displayed sentence overrides the registry title while the known ID controls its workflow', () => {
  const current = { kind: 'General video', topic: 'Earlier idea', autoIdea: true, publishingFormat: 'instagram-reel', duration: 90, batchCount: 1, narration: '' };
  for (const canonical of recommendationPool()) {
    const displayed = { ...canonical, title: `  The exact visible sentence for ${canonical.id}.  `, kind: canonical.kind === 'General video' ? "Children's song" : 'General video' };
    const next = applyRecommendationToForm(current, displayed);
    const expectedWorkflow = applyRecommendationToForm(current, canonical);
    assert.notEqual(displayed.title, canonical.title);
    assert.equal(next.topic, displayed.title, 'preserve the visible sentence including its surrounding spaces');
    for (const field of ['kind', 'publishingFormat', 'duration', 'batchCount']) {
      assert.equal(next[field], expectedWorkflow[field], `spoofed kind changed ${field} for ${canonical.id}`);
    }
  }
  const displayed = { ...recommendationPool()[0], title: 'x'.repeat(400) };
  assert.equal(applyRecommendationToForm(current, displayed).topic, displayed.title, '400 characters is valid');
});

test('invalid displayed titles leave the form unchanged even for a known recommendation ID', () => {
  const current = { kind: 'General video', topic: 'Earlier idea', autoIdea: true, publishingFormat: 'instagram-reel', duration: 90, batchCount: 1, narration: '' };
  const known = recommendationPool().find(idea => idea.kind === "Children's song");
  const invalidTitles = [undefined, null, false, 42, {}, [], '', '   ', '\u00a0', 'x'.repeat(401),
    ...Array.from({ length: 32 }, (_, code) => `Visible${String.fromCharCode(code)}sentence`),
    `Visible${String.fromCharCode(127)}sentence`];
  for (const title of invalidTitles) {
    assert.equal(applyRecommendationToForm(current, { ...known, title }), current, `accepted invalid title ${JSON.stringify(title)}`);
  }
});

const suggestionContext = (recent = [], feedback = [], strongerTopics = []) => ({ now: Date.parse('2026-11-15T12:00:00Z'), recent, feedback, strongerTopics });
const recentItem = (reviewId, title, workflow = 'stock-reel', extra = {}) => ({ reviewId, title, workflow, createdAt: '2026-11-15T10:00:00Z', observations: [], ...extra });

test('posted nature subjects guide general explainers, exclude finished topics and allow one nearby exploration', () => {
  const context = suggestionContext([
    recentItem('panda', 'Pandas eating bamboo', 'stock-reel', { posted: true }),
    recentItem('rabbit', 'A rabbit in a meadow', 'stock-reel', { posted: true }),
    recentItem('waterfall', 'A quiet minute beside a waterfall', 'stock-reel', { posted: true }),
    ...Array.from({ length: 30 }, (_, index) => recentItem('draft-' + index, 'Customer order update', 'business')),
  ]);
  const first = personalizedCreationRecommendations(context);
  assert.equal(first.ideas.length, 6); assert.ok(first.ideas.every(idea => idea.kind === 'General video'));
  assert.ok(first.ideas.slice(0, 5).every(idea => idea.basis === 'recent-content'));
  assert.ok(/nature|science/.test(first.ideas.at(-1).reason), 'The sixth idea may explore an adjacent nature/science subject');
  assert.ok(first.ideas.every(idea => !/panda|rabbit|waterfall|bamboo/i.test(idea.title)));
  const second = personalizedCreationRecommendations(context, first.nextCursor, first.ideas.map(idea => idea.id));
  assert.ok(second.ideas.every(idea => !first.ideas.some(prior => prior.topicKey === idea.topicKey)));
});

test('story feedback changes topic relevance while a visual revision does not reject the subject', () => {
  const recent = [recentItem('nature', 'An otter by the river'), recentItem('food', 'Making bread by hand', 'general')];
  const visualRevision = personalizedCreationRecommendations(suggestionContext(recent, [
    { reviewId: 'nature', decision: 'revise', storyRating: 5, visualRating: 1 },
    { reviewId: 'food', decision: 'keep', storyRating: 3, visualRating: 5 },
  ]));
  assert.ok(visualRevision.ideas.slice(0, 4).every(idea => idea.basis === 'owner-feedback' && /wildlife/.test(idea.reason)));
  const rejectedStory = personalizedCreationRecommendations(suggestionContext(recent, [
    { reviewId: 'nature', decision: 'revise', storyRating: 1, visualRating: 5 },
    { reviewId: 'food', decision: 'keep', storyRating: 5, visualRating: 5 },
  ]));
  assert.ok(rejectedStory.ideas.slice(0, 4).every(idea => /food and craft/.test(idea.reason)));
});

test('foreground wildlife outranks incidental green backgrounds and does not imply rabbit-specific evidence', () => {
  const context = suggestionContext([
    recentItem('rabbits', 'Rabbits', 'stock-reel', { posted: true, observations: ['White rabbits nibble leaves beside grass and small plants.', 'Green garden foliage fills the background.'] }),
    recentItem('panda', 'Panda', 'stock-reel', { posted: true, observations: ['A panda eats bamboo leaves.', 'Trees, green foliage and plants surround the animal.'] }),
    recentItem('parrots', 'Parrots', 'stock-reel', { posted: true, observations: ['Colorful parrots sit on branches in a garden.', 'Green leaves form the background.'] }),
    recentItem('flamingos', 'Flamingos', 'stock-reel', { posted: true, observations: ['Flamingos stand beside water, grass and plants.'] }),
  ]);
  const animals = /otter|penguin|bee|bird|butterfly|elephant|giraffe|turtle|squirrel|deer|zebra|duck|frog|hummingbird|dragonfly|ladybird|snail|crab|jellyfish|octopus|seal|chameleon|hedgehog|horse|cat|dog/i;
  const practical = /herb|windowsill|laundry|desk|drawer|bookshelf|entryway|tidy|leftovers/i;
  const seen = [];
  for (let batch = 0, cursor = 0; batch < 3; batch++) {
    const result = personalizedCreationRecommendations(context, cursor, seen);
    assert.equal(result.ideas.length, 6);
    assert.ok(result.ideas.slice(0, 5).every(idea => animals.test(idea.title)), result.ideas.map(idea => idea.title).join('\n'));
    assert.ok(result.ideas.every(idea => !practical.test(idea.title)), 'A nearby nature subject must not become a windowsill, gardening or housework task');
    assert.ok(['Nature & places', 'Science & curiosity'].includes(result.ideas.at(-1).category));
    assert.ok(result.ideas.slice(0, 5).every(idea => /posted wildlife videos/.test(idea.reason)));
    assert.ok(result.ideas.every(idea => !/rabbit|panda|parrot|flamingo/i.test(idea.reason)), 'Family evidence must not imply an exact rabbit-to-herb or rabbit-to-other-species match');
    assert.ok(result.ideas.every(idea => idea.kind === 'General video'));
    seen.push(...result.ideas.map(idea => idea.id)); cursor = result.nextCursor;
  }
});

test('saved response evidence is used only with enough matching workflow evidence and never called popular', () => {
  for (const [workflow, count, expected] of [['general', 2, true], ['general', 1, false], ['children-story', 8, false]]) {
    const result = personalizedCreationRecommendations(suggestionContext([], [], [{ topic: 'Wildlife panda videos', workflow, evidenceCount: count }]));
    assert.equal(result.ideas.some(idea => idea.basis === 'observed-response'), expected);
    assert.ok(result.ideas.every(idea => !/popular|trending|viral/i.test(idea.reason)));
  }
});

test('personalized history accepts only 48 registered IDs, bounds cursors and retains latest duplicates', () => {
  const pool = recommendationPool();
  const parsed = parsePersonalizedRecommendationMemory(JSON.stringify({ shown: [...pool.map(idea => idea.id), 'unknown', null, pool.at(-2).id], cursor: Number.MAX_SAFE_INTEGER }));
  assert.ok(parsed.shown.length <= 48); assert.equal(parsed.shown.at(-1), pool.at(-2).id);
  assert.ok(parsed.shown.every(id => pool.some(idea => idea.id === id)));
  assert.ok(parsed.cursor >= 0 && parsed.cursor < pool.length);
  for (const invalid of [null, '{bad', '[]', 'null', 'x'.repeat(16385)]) assert.deepEqual(parsePersonalizedRecommendationMemory(invalid), { shown: [], cursor: 0 });
  const noNews = personalizedCreationRecommendations(suggestionContext([recentItem('news', 'Panda news', 'stock-reel', { news: true })]));
  assert.ok(noNews.ideas.every(idea => idea.basis === 'explore'));
});

test('children story and song ideas keep rotating after their recent suggestion history fills',()=>{
  for(const kind of ["Children's short story","Children's song"]){
    let seen=[],cursor=0;let previous=[];const all=new Set();
    for(let rotation=0;rotation<12;rotation++){
      const batch=personalizedCreationRecommendations(suggestionContext(),cursor,seen,kind);
      assert.equal(batch.ideas.length,6);assert.ok(batch.ideas.every(idea=>idea.kind===kind));
      const ids=batch.ideas.map(idea=>idea.id);assert.equal(new Set(ids).size,6);
      assert.notDeepEqual(ids,previous);previous=ids;ids.forEach(id=>all.add(id));
      seen=[...seen.filter(id=>!ids.includes(id)),...ids].slice(-48);cursor=batch.nextCursor;
    }
    assert.ok(all.size>6);
  }
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const {
  CREATION_KINDS, RECOMMENDATION_GROUPS, RECOMMENDATION_HISTORY_LIMIT,
  recommendationPool, canonicalRecommendationKey, creationRecommendations,
  emptyRecommendationMemory, parseRecommendationMemory, nextStoredRecommendations, applyRecommendationToForm,
} = require('../src/lib/creationRecommendations');
const { publishingProfile } = require('../src/lib/publishingFormats');

test('one mixed catalogue covers all eight subject groups and only supported creation types', () => {
  const pool = recommendationPool();
  assert.ok(pool.length > 60);
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
  assert.equal(applyRecommendationToForm({ ...current, narration: '' }, child).batchCount, 10);
});

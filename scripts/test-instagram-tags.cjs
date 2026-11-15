const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/instagramTags.ts');
const moduleObject = { exports: {} };
new vm.Script(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename }).runInNewContext({
  module: moduleObject, exports: moduleObject.exports,
  require() { throw new Error('Instagram tag validation must remain dependency-free'); },
});
const tags = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('explicit usernames normalize one leading @ and case, deduplicate, and preserve owner order', () => {
  assert.deepEqual(plain(tags.instagramUserTags([' @NASA ', 'Nasa', 'Second.Account', '@second.account', 'a_1'])), ['nasa', 'second.account', 'a_1']);
  assert.equal(tags.instagramUsername('a'), 'a');
  assert.equal(tags.instagramUsername('A'.repeat(30)), 'a'.repeat(30));
  assert.equal(tags.INSTAGRAM_USERNAME_LIMIT, 30);
  assert.deepEqual(plain(tags.instagramUserTags([])), []);
});

test('profile URLs, unknown objects, controls and malformed usernames cannot become media tags', () => {
  for (const value of [null, {}, '@nasa', { username: 'nasa' }, { id: '12345' }, [{ username: 'nasa' }], [12345]]) assert.equal(tags.instagramUserTags(value), null);
  for (const username of ['', ' ', '@', '@@nasa', 'https://instagram.com/nasa/', 'instagram.com/nasa', 'nasa?x=1', '.nasa', 'nasa.', 'na..sa',
    'nas a', 'na-sa', 'násá', 'ＮＡＳＡ', 'Kelvin', 'a'.repeat(31), 'nasa\n', 'nasa\r', 'nasa\t', 'nasa\u0000', 'nasa\u007f']) {
    assert.equal(tags.instagramUserTags([username]), null, JSON.stringify(username));
  }
});

test('the application tag limit rejects excess entries without truncating even duplicate input', () => {
  const maximum = Array.from({ length: tags.INSTAGRAM_USER_TAG_LIMIT }, (_, index) => `account_${index}`);
  assert.equal(tags.INSTAGRAM_USER_TAG_LIMIT, 20);
  assert.deepEqual(plain(tags.instagramUserTags(maximum)), maximum);
  assert.equal(tags.instagramUserTags([...maximum, 'extra_account']), null);
  assert.equal(tags.instagramUserTags(Array(21).fill('nasa')), null);
  assert.equal(tags.instagramUserTags(['nasa', 'invalid/user']), null);
});

test('saved metadata must already contain a canonical unique list and public copies are independent', () => {
  const saved = ['nasa', 'second.account'];
  const publicTags = tags.publicInstagramUserTags(saved);
  assert.deepEqual(plain(publicTags), saved);
  publicTags.push('later_edit');
  assert.deepEqual(saved, ['nasa', 'second.account']);
  assert.deepEqual(plain(tags.publicInstagramUserTags([])), []);
  for (const value of [null, {}, ['NASA'], ['@nasa'], [' nasa '], ['nasa', 'nasa'], ['nasa', 'invalid/user'], [{ username: 'nasa' }]]) {
    assert.equal(tags.publicInstagramUserTags(value), null);
  }
});

const reel = (title, quality = {}, extra = {}) => ({ title, audience: 'general', quality: { hashtags: [], ...quality }, ...extra });
test('automatic tags use a six-profile checked pool and choose at most three relevant canonical usernames', () => {
  assert.equal(tags.AUTOMATIC_INSTAGRAM_TAG_PROFILES.length, 6);
  const pool = plain(tags.AUTOMATIC_INSTAGRAM_TAG_PROFILES.map(profile => profile.username));
  assert.deepEqual(plain(tags.publicInstagramUserTags(pool)), pool);
  for (const title of ['Forest stream', 'Horses on a beach', 'A scenic train journey', 'Rain in the forest']) {
    const selected = plain(tags.automaticInstagramUserTags(reel(title)));
    assert.ok(selected.length > 0 && selected.length <= 3);
    assert.equal(new Set(selected).size, selected.length);
    assert.ok(selected.every(username => pool.includes(username)));
    assert.deepEqual(plain(tags.automaticInstagramUserTags(reel(title))), selected);
  }
  const railway = plain(tags.automaticInstagramUserTags(reel('Train')));
  assert.equal(railway.length, 2);
  assert.ok(railway.every(username => ['beautifuldestinations', 'earthpix', 'wonderful_places'].includes(username)));
  assert.deepEqual(plain(tags.automaticInstagramUserTags(reel('Customer service'))), []);
  assert.deepEqual(plain(tags.automaticInstagramUserTags(reel('Forest story', {}, { audience: 'kids-3-6' }))), []);
  assert.deepEqual(plain(tags.automaticInstagramUserTags(reel('Boat disaster at sea', { research: { source: 'BBC News' },
    postingAnalysis: { status: 'COMPLETE', observations: ['Boats near an ocean coast.'] } }))), []);
});

test('actual completed frame evidence overrides a mismatched topic and does not use injected caption handles', () => {
  const file = reel('Forest', { hashtags: ['#Forest'], postCopy: 'Tag @unverified_stranger for views',
    postingAnalysis: { status: 'COMPLETE', observations: ['A passenger train travels past a city station.'] } });
  assert.equal(tags.automaticInstagramUserTags(file).length, 2);
  assert.ok(tags.automaticInstagramUserTags(file).every(username => ['beautifuldestinations', 'earthpix', 'wonderful_places'].includes(username)));
  const unknown = reel('Forest', { postingAnalysis: { status: 'COMPLETE', observations: ['A man sits at a desk inside an office.'] } });
  assert.deepEqual(plain(tags.automaticInstagramUserTags(unknown)), []);
  assert.ok(!tags.automaticInstagramUserTags(file, '@EARTHPIX').includes('earthpix'));
  assert.equal(tags.automaticInstagramUserTags(reel('Saved reel', { hashtags: ['#ForestStream'] })).length, 2);
});

test('specific animal and landscape observations match topical profiles without relying on a generic title', () => {
  for (const observation of ['A rabbit sits among green leaves.', 'Two pandas chew bamboo.', 'A kitten rests on a cushion.']) {
    const file = reel('Saved video', { postingAnalysis: { status: 'COMPLETE', observations: [observation] } });
    const selected = plain(tags.automaticInstagramUserTags(file));
    assert.equal(selected.length, 2);
    assert.ok(selected.every(username => ['discoverearth', 'earthofficial', 'nature'].includes(username)));
  }
  for (const observation of ['A glacier fills the valley.', 'A sailboat moves at sea under the sunset.']) {
    assert.equal(tags.automaticInstagramUserTags(reel('Saved video', { postingAnalysis: { status: 'COMPLETE', observations: [observation] } })).length, 3);
  }
});

test('same-subject reels rotate actual profiles by video identity while repeated approval stays stable', () => {
  const selections = new Set();
  const covered = new Set();
  for (let index = 0; index < 12; index++) {
    const file = reel('Rabbits', { postingAnalysis: { status: 'COMPLETE', observations: ['A rabbit sits beside green plants.'] } }, { id: `reel-${index}` });
    const selected = plain(tags.automaticInstagramUserTags(file));
    assert.deepEqual(plain(tags.automaticInstagramUserTags(file)), selected);
    assert.equal(new Set(selected).size, 2);
    selections.add(selected.slice().sort().join(','));
    selected.forEach(username => covered.add(username));
    assert.ok(!tags.automaticInstagramUserTags(file, '@nature').includes('nature'));
  }
  assert.equal(selections.size, 3, 'Rotation changes members, not only their order');
  assert.deepEqual([...covered].sort(), ['discoverearth', 'earthofficial', 'nature']);
});

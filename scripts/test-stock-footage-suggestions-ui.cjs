const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Reuse only the real-handler/inert-JSX harness, never its registered tests.
// Timers and endpoint responses are fixtures; no browser, server or provider.
const existing = fs.readFileSync(path.join(__dirname, 'test-stock-reels-ui.cjs'), 'utf8');
const boundary = existing.indexOf('\ntest(');
assert.ok(boundary > 0, 'Existing UI harness has an explicit test-registration boundary');
const isolatedModule = { exports: {} };
const allowed = new Set(['node:assert/strict', 'node:fs', 'node:path', 'node:vm', 'node:test', 'typescript']);
new vm.Script(existing.slice(0, boundary) +
  '\nmodule.exports = { harness, text, nodes, compile, response, deferred, fixtures, successfulSearch, memoryStorage };',
{ filename: 'isolated-stock-suggestions-harness.cjs' }).runInNewContext({
  module: isolatedModule, exports: isolatedModule.exports, __dirname, AbortController, AbortSignal,
  require(name) { assert.ok(allowed.has(name), 'Only local test dependencies are allowed'); return require(name); },
}, { timeout: 5000 });
const { harness, text, nodes, compile, response, memoryStorage } = isolatedModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const ideas = h => nodes(h.tree).filter(node => node.type === 'button' && node.props['aria-label']?.startsWith('Use topic: '));
const ideaKeys = h => ideas(h).map(node => node.key);
const queryOf = idea => helper.stockFootageSuggestions(Number(ideaCursor(idea))).find(entry => entry.id === idea.key)?.query;
const ideaCursor = idea => catalog.CONTENT_IDEAS.filter(entry => entry.workflow === 'stock-reel').findIndex(entry => entry.id === idea.key);
async function clickIdea(h, index = 0) {
  ideas(h)[index].props.onClick(); h.render(); await h.flush();
  if (!h.gets.length) await h.advance(600);
}
function loadPure(relative, dependencies = {}) {
  const source = compile(relative), mod = { exports: {} };
  new vm.Script(source.source, { filename: source.filename }).runInNewContext({
    module: mod, exports: mod.exports,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Suggestions cannot import provider/model code'); return dependencies[name]; },
    fetch() { assert.fail('Suggestions must not use network/model calls'); },
  }, { timeout: 1000 });
  return mod.exports;
}
const catalog = loadPure('src/lib/contentIdeas.ts');
const helper = loadPure('src/lib/stockFootageSuggestions.ts', { './contentIdeas': catalog });
const storageKey = helper.FOOTAGE_SUGGESTION_STORAGE_KEY;

test('catalogue returns six distinct stock-only ideas and rejects malformed saved cursors', () => {
  const expected = catalog.CONTENT_IDEAS.filter(idea => idea.workflow === 'stock-reel'), first = helper.stockFootageSuggestions();
  assert.equal(first.length, 6); assert.equal(new Set(first.map(idea => idea.id)).size, 6);
  assert.ok(first.every(idea => idea.workflow === 'stock-reel' && idea.query.length >= 2 && idea.query.length <= 100));
  const seen = new Set();
  for (let cursor = 0; cursor < expected.length; cursor += 6) helper.stockFootageSuggestions(cursor).forEach(idea => seen.add(idea.id));
  assert.deepEqual([...seen].sort(), plain(expected.map(idea => idea.id)).sort());
  for (const cursor of [-1, NaN, 999999, 1.1, '6']) assert.deepEqual(plain(helper.stockFootageSuggestions(cursor)), plain(first));
  for (const raw of ['{broken', JSON.stringify({ version: 1, cursor: -1 }), 'x'.repeat(257)]) {
    assert.deepEqual(plain(helper.nextStoredFootageSuggestions(memoryStorage({ [storageKey]: raw })).ideas), plain(first));
  }
});

test('footage recommendations are short broad topics while the rich creation catalogue remains unchanged', () => {
  const original = plain(catalog.CONTENT_IDEAS), all = catalog.CONTENT_IDEAS.filter(idea => idea.workflow === 'stock-reel').map((_, index) => helper.stockFootageSuggestions(index)[0]);
  assert.equal(all.length, 22);
  assert.ok(all.every(idea => idea.title.split(/\s+/).length <= 2 && idea.query.split(/\s+/).length <= 2));
  assert.ok(all.every(idea => idea.query === idea.title), 'Selected input uses the exact displayed label, not a hidden alias');
  for (const title of ['Nature', 'Train', 'Mountains', 'Forest']) assert.ok(all.some(idea => idea.title === title));
  assert.deepEqual(plain(all.map(idea => idea.id)), original.filter(idea => idea.workflow === 'stock-reel').map(idea => idea.id));
  assert.deepEqual(plain(catalog.CONTENT_IDEAS), original);
  assert.equal(catalog.CONTENT_IDEAS.find(idea => idea.id === '1-3').query, 'train countryside');
  assert.ok(catalog.CONTENT_IDEAS.filter(idea => idea.workflow !== 'stock-reel').some(idea => idea.title.split(/\s+/).length > 2));
});

test('mount, More ideas and reopening rotate locally without searching or creating a video', async () => {
  const storage = memoryStorage(), h = harness({ storage }); await h.advance(1000);
  assert.match(text(h.tree), /Topic suggestions/); assert.match(text(h.tree), /not live trends/);
  assert.equal(nodes(h.tree).find(node => node.type === 'details').props.open, undefined, 'Topic suggestions are collapsed by default');
  assert.equal(ideas(h).length, 6); assert.ok(ideas(h).every(node => node.props.type === 'button'));
  assert.equal(h.button('More ideas').props.type, 'button');
  const first = ideaKeys(h); h.click('More ideas'); assert.notDeepEqual(ideaKeys(h), first);
  assert.equal(h.input().props.value, '');
  assert.equal(h.requests.length, 0); assert.equal(h.started.length, 0);
  const reopened = harness({ storage }); await reopened.advance(1000);
  assert.notDeepEqual(ideaKeys(reopened), ideaKeys(h)); assert.equal(reopened.requests.length, 0);
});

test('unavailable and readable-but-write-blocked storage rotate honestly during this visit', () => {
  const stored = JSON.stringify({ version: 1, cursor: 6 });
  for (const storage of [
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    { getItem() { return stored; }, setItem() { throw new Error('write blocked'); } },
  ]) {
    const h = harness({ storage });
    assert.match(text(h.tree), /Browser storage is unavailable; ideas still rotate here but may repeat next visit/);
    const first = ideaKeys(h); h.click('More ideas'); const second = ideaKeys(h);
    assert.notDeepEqual(second, first); h.click('More ideas'); assert.notDeepEqual(ideaKeys(h), second);
    assert.equal(h.requests.length, 0);
  }
});

test('clicking an idea searches its exact topic in both free libraries but never selects footage automatically', async () => {
  const h = harness(), query = queryOf(ideas(h)[1]);
  await clickIdea(h, 1); await h.advance(600);
  assert.equal(h.input().props.value, query); assert.equal(h.gets.length, 1);
  assert.equal(h.gets[0].url, '/api/stock-reels?q=' + encodeURIComponent(query) + '&provider=all&automatic=true&browse=true');
  assert.equal(h.candidates().length, 3); assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
  assert.equal(nodes(h.tree).filter(node => node.type === 'video' || node.type === 'audio').length, 0);
});

test('every displayed chip inserts its exact label after repeated More ideas rotations', async () => {
  const h = harness(); const seen = new Set();
  for(let batch = 0; batch < 5; batch++) {
    for(const idea of ideas(h)) {
      const title = text(nodes(idea).filter(node => node.type === 'span').at(-1));
      idea.props.onClick(); h.render();
      assert.equal(h.input().props.value, title);
      seen.add(idea.key);
    }
    h.click('More ideas'); h.render();
  }
  assert.equal(seen.size, 22);
  assert.equal(h.posts.length, 0);
  assert.equal(h.started.length, 0);
});

test('an idea replaces a pending typed-topic debounce without requesting the previous query', async () => {
  const h = harness(); h.changeTopic('my unsent previous query');
  const query = queryOf(ideas(h)[0]); await clickIdea(h); await h.advance(600);
  assert.equal(h.input().props.value, query);
  assert.equal(h.gets.length, 1); assert.ok(h.gets[0].url.includes('q=' + encodeURIComponent(query) + '&provider=all&automatic=true'));
  assert.equal(h.posts.length, 0);
});

test('repeated same-topic chip clicks do not cancel the only scheduled lookup', async () => {
  const h = harness(), idea = ideas(h)[0], query = queryOf(idea);
  idea.props.onClick(); h.render();
  ideas(h)[0].props.onClick(); h.render();
  await h.advance(600);
  assert.equal(h.input().props.value, query);
  assert.equal(h.gets.length, 1, 'Same topic remains one scheduled/in-flight lookup, not zero');
  assert.equal(h.candidates().length, 3); assert.equal(h.posts.length, 0);
});

test('More ideas does not clear current candidates or change the topic; selecting a candidate remains explicit', async () => {
  const h = harness(); h.changeTopic('forest stream'); await h.advance(600);
  const query = h.input().props.value, keys = h.candidates().map(node => node.key), requestCount = h.requests.length;
  h.click('More ideas'); await h.advance(600);
  assert.equal(h.input().props.value, query);
  assert.deepEqual(plain(h.candidates().map(node => node.key)), plain(keys));
  assert.equal(h.requests.length, requestCount); assert.equal(h.posts.length, 0);
  h.choose(1); await h.flush();
  assert.equal(h.posts.length, 1); assert.equal(h.payload.automatic, true);
  assert.equal(h.payload.id, 1); assert.equal(h.payload.query, query);
});

test('a failed idea search reports its cause, never queues work and still allows local rotation', async () => {
  const h = harness({ search: () => response({ error: 'The free stock library is temporarily unavailable.' }, 503) });
  await clickIdea(h);
  assert.match(text(h.tree), /free stock library is temporarily unavailable/);
  assert.equal(h.candidates().length, 0); assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
  const batch = ideaKeys(h); h.click('More ideas'); assert.notDeepEqual(ideaKeys(h), batch);
  assert.equal(h.gets.length, 1);
});

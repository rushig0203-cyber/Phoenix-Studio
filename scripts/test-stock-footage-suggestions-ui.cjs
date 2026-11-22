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
  module: isolatedModule, exports: isolatedModule.exports, __dirname, AbortController, AbortSignal, URLSearchParams,
  require(name) { assert.ok(allowed.has(name), 'Only local test dependencies are allowed'); return require(name); },
}, { timeout: 5000 });
const { harness, text, nodes, compile, response, deferred, memoryStorage } = isolatedModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const ideas = h => nodes(h.tree).filter(node => node.type === 'button' && node.props['aria-label']?.startsWith('Use topic: '));
const ideaKeys = h => ideas(h).map(node => node.key);
const queryOf = idea => allTopics.find(entry => entry.id === idea.key)?.query;
async function clickIdea(h, index = 0) {
  await h.flush();
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
const allTopics = helper.stockTopicPool();
const fallbackTopics = new Map();
for (let cursor = 0; cursor < allTopics.length * 6; cursor += 6) {
  for (const idea of helper.stockFootageSuggestions(cursor)) fallbackTopics.set(idea.id, idea);
}

test('fallback returns six distinct supported ideas and rejects malformed saved cursors', () => {
  const expected = [...fallbackTopics.values()], first = helper.stockFootageSuggestions();
  assert.equal(first.length, 6); assert.equal(new Set(first.map(idea => idea.id)).size, 6);
  assert.ok(first.every(idea => idea.workflow === 'stock-reel' && idea.query.length >= 2 && idea.query.length <= 100));
  const seen = new Set();
  for (let cursor = 0; cursor < expected.length * 6; cursor += 6) helper.stockFootageSuggestions(cursor).forEach(idea => seen.add(idea.id));
  assert.deepEqual([...seen].sort(), plain(expected.map(idea => idea.id)).sort());
  for (const cursor of [-1, NaN, Number.MAX_SAFE_INTEGER, 1.1, '6']) assert.deepEqual(plain(helper.stockFootageSuggestions(cursor)), plain(first));
  for (const raw of ['{broken', JSON.stringify({ version: 1, cursor: -1 }), 'x'.repeat(257)]) {
    assert.deepEqual(plain(helper.nextStoredFootageSuggestions(memoryStorage({ [storageKey]: raw })).ideas), plain(first));
  }
});

test('footage recommendations are short broad topics while the rich creation catalogue remains unchanged', () => {
  const original = plain(catalog.CONTENT_IDEAS), all = allTopics;
  assert.ok(all.length >= 60, 'The scenic catalogue should not repeat after only a few small batches');
  assert.ok(all.length >= 240, 'The complete catalogue retains countries, wildlife and architecture IDs for legacy history');
  assert.ok(all.every(idea => idea.title.split(/\s+/).length <= 2 && idea.query.split(/\s+/).length <= 2));
  assert.ok(all.every(idea => idea.query === idea.title), 'Selected input uses the exact displayed label, not a hidden alias');
  for (const title of ['Nature', 'Train', 'Mountains', 'Forest', 'City streets', 'City traffic', 'Switzerland', 'Waterfall', 'Steam train', 'Dolphins', 'Coastal road']) assert.ok(all.some(idea => idea.title === title));
  assert.equal(all.some(idea => ['A city waking up', 'City lights'].includes(idea.title)), false, 'Urban prompts stay concrete and filmable');
  for (const title of ['Switzerland lakes', 'Norway fjords', 'Japan trains', 'Chile glaciers', 'Netherlands tulips']) assert.ok(all.some(idea => idea.title === title));
  for (const title of ['Switzerland coast', 'Nepal beaches', 'Austria coast']) assert.equal(all.some(idea => idea.title === title), false);
  const legacy = original.filter(idea => idea.workflow === 'stock-reel');
  assert.deepEqual(plain(all.slice(0, legacy.length).map(idea => idea.id)), legacy.map(idea => idea.id));
  assert.equal(new Set(all.map(idea => idea.title.toLowerCase())).size, all.length);
  assert.deepEqual(plain(catalog.CONTENT_IDEAS), original);
  assert.equal(catalog.CONTENT_IDEAS.find(idea => idea.id === '1-3').query, 'train countryside');
  assert.ok(catalog.CONTENT_IDEAS.filter(idea => idea.workflow !== 'stock-reel').some(idea => idea.title.split(/\s+/).length > 2));
});

test('each batch mixes wildlife, nature, places, movement and other subjects while rotating saved cursors', () => {
  const storage = memoryStorage(), seen = new Set();
  let previous;
  for (let batch = 0; batch < allTopics.length; batch++) {
    const next = helper.nextStoredFootageSuggestions(storage);
    assert.ok(next.ideas[0].category === 'Animals & everyday moments' || ['Birds','Butterflies'].includes(next.ideas[0].title));
    assert.ok(next.ideas.some(idea=>idea.category==='Architecture & design'||idea.title==='City streets'),'Architecture cannot be crowded out by countries');
    assert.equal(new Set(next.ideas.map(idea => idea.id)).size, 6);
    if (previous) assert.ok(next.ideas.every(idea => !previous.includes(idea.id)), 'Adjacent mixed batches stay fresh');
    previous = next.ideas.map(idea => idea.id);
    for (const idea of next.ideas) seen.add(idea.id);
  }
  assert.equal(seen.size, fallbackTopics.size);
  const legacyCursor = catalog.CONTENT_IDEAS.filter(idea => idea.workflow === 'stock-reel').length - 1;
  const remembered = helper.nextStoredFootageSuggestions(memoryStorage({ [storageKey]: JSON.stringify({ version: 1, cursor: legacyCursor }) }));
  assert.deepEqual(plain(remembered.ideas), plain(helper.stockFootageSuggestions(legacyCursor)));
  assert.equal(remembered.remembered, true);
});

test('topic ranking uses measured subjects and refresh deadlines persist per surface', async () => {
  const ranking = helper.personalizedStockSuggestions({ now: 1_000_000, recent: [], feedback: [], strongerTopics: [
    { topic: 'Otters swimming', workflow: 'stock-reel', evidenceCount: 4 },
  ] });
  assert.equal(ranking.ideas[0].title, 'Otters');
  assert.equal(ranking.ideas[0].basis, 'observed-response');
  assert.match(ranking.ideas[0].reason, /measured Instagram results/);

  const storage = memoryStorage();
  let time = Date.parse('2026-01-01T00:00:00Z'), scheduled, resumed, refreshes = 0, succeeds = true, removed = false;
  const flush = async () => { for (let count = 0; count < 10; count++) await Promise.resolve(); };
  const key = `${helper.FOOTAGE_SUGGESTION_REFRESH_AT_KEY}:quick-templates`;
  const { stop } = helper.installFootageSuggestionRefresh({
    key: 'quick-templates', storage, now: () => time,
    setTimeout(callback, delay) { scheduled = { callback, delay }; return scheduled; },
    clearTimeout(handle) { if (scheduled === handle) scheduled = undefined; },
    subscribeResume(listener) { resumed = listener; return () => { removed = true; }; },
    async refresh() { refreshes++; return succeeds; },
  });
  assert.equal(Number(storage.getItem(key)), time + helper.FOOTAGE_SUGGESTION_REFRESH_MS);
  assert.equal(refreshes, 0, 'A new page waits for its first persisted due date');
  time += helper.FOOTAGE_SUGGESTION_REFRESH_MS;
  scheduled.callback(); await flush();
  assert.equal(refreshes, 1);
  assert.equal(Number(storage.getItem(key)), time + helper.FOOTAGE_SUGGESTION_REFRESH_MS);
  assert.equal(scheduled.delay, helper.FOOTAGE_SUGGESTION_REFRESH_MS);
  succeeds = false; time += helper.FOOTAGE_SUGGESTION_REFRESH_MS; scheduled.callback(); await flush();
  assert.equal(refreshes, 2);
  assert.equal(Number(storage.getItem(key)), time, 'A failure keeps the due date overdue');
  assert.equal(scheduled.delay, 60_000, 'A failed due refresh retries in one minute');
  succeeds = true; time += 60_000; scheduled.callback(); await flush();
  assert.equal(refreshes, 3);
  assert.equal(Number(storage.getItem(key)), time + helper.FOOTAGE_SUGGESTION_REFRESH_MS);
  resumed(); await flush();
  stop(); assert.equal(removed, true); assert.equal(scheduled, undefined);

  const reopenedStorage = memoryStorage({ [key]: String(time - 1) });
  const { stop: reopened } = helper.installFootageSuggestionRefresh({ key: 'quick-templates', storage: reopenedStorage, now: () => time,
    setTimeout(callback, delay) { scheduled = { callback, delay }; return scheduled; }, clearTimeout(handle) { if (scheduled === handle) scheduled = undefined; },
    async refresh() { refreshes++; return true; } });
  await flush();
  assert.equal(refreshes, 4, 'An overdue stored deadline refreshes when the dashboard reopens');
  reopened();
});

test('mount, More ideas and reopening rotate locally without searching or creating a video', async () => {
  const storage = memoryStorage(), h = harness({ storage }); await h.advance(1000);
  assert.match(text(h.tree), /Topic suggestions/); assert.match(text(h.tree), /not live trends/);
  assert.equal(nodes(h.tree).find(node => node.type === 'details').props.open, undefined, 'Topic suggestions are collapsed by default');
  assert.equal(ideas(h).length, 6); assert.ok(ideas(h).every(node => node.props.type === 'button'));
  assert.equal(h.button('More ideas').props.type, 'button');
  assert.ok(ideas(h).every(node => node.props.className.includes('rounded-xl')), 'Suggestions keep short topic titles and a compact evidence line');
  assert.match(h.input().props.placeholder, /Nature, Switzerland, trains/);
  assert.equal(nodes(h.tree).find(node => node.type === 'details' && text(node).startsWith('Reel details')).props.open, undefined);
  assert.equal(nodes(h.tree).filter(node => ['select', 'textarea'].includes(node.type)).length, 0);
  const first = ideaKeys(h); h.click('More ideas'); await h.flush(); assert.notDeepEqual(ideaKeys(h), first);
  assert.equal(h.input().props.value, '');
  assert.equal(h.requests.length, 0); assert.equal(h.started.length, 0);
  const reopened = harness({ storage }); await reopened.advance(1000);
  assert.notDeepEqual(ideaKeys(reopened), ideaKeys(h)); assert.equal(reopened.requests.length, 0);
});

test('an open footage screen refreshes daily without searching or changing the chosen topic/results',async()=>{
  const h=harness();h.changeTopic('Otters');await h.advance(600);
  const first=ideaKeys(h),requestCount=h.requests.length,candidates=h.candidates().map(node=>node.key);
  await h.advance(helper.FOOTAGE_SUGGESTION_REFRESH_MS-601);assert.deepEqual(ideaKeys(h),first);
  await h.advance(1);assert.notDeepEqual(ideaKeys(h),first);
  assert.equal(h.input().props.value,'Otters');assert.deepEqual(h.candidates().map(node=>node.key),candidates);
  assert.equal(h.requests.length,requestCount);assert.equal(h.posts.length,0);
  h.unmount();assert.equal(h.pendingTimers,0);
});

test('unavailable and readable-but-write-blocked storage rotate honestly during this visit', async () => {
  const stored = JSON.stringify({ version: 1, cursor: 6 });
  for (const storage of [
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    { getItem() { return stored; }, setItem() { throw new Error('write blocked'); } },
  ]) {
    const h = harness({ storage }); await h.flush();
    assert.match(text(h.tree), /Browser storage is unavailable; ideas still rotate here but may repeat next visit/);
    const first = ideaKeys(h); h.click('More ideas'); await h.flush(); const second = ideaKeys(h);
    assert.notDeepEqual(second, first); h.click('More ideas'); await h.flush(); assert.notDeepEqual(ideaKeys(h), second);
    assert.equal(h.requests.length, 0);
  }
});

test('clicking an idea searches its exact topic in both free libraries but never selects footage automatically', async () => {
  const h = harness(); await h.flush(); const query = queryOf(ideas(h)[1]);
  await clickIdea(h, 1); await h.advance(600);
  assert.equal(h.input().props.value, query); assert.equal(h.gets.length, 1);
  assert.equal(h.gets[0].url, '/api/stock-reels?q=' + encodeURIComponent(query) + '&provider=all&automatic=true&browse=true');
  assert.equal(h.candidates().length, 3); assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
  assert.equal(nodes(h.tree).filter(node => node.type === 'video' || node.type === 'audio').length, 0);
});

test('every displayed chip inserts its exact label after repeated More ideas rotations', async () => {
  const h = harness(); await h.flush(); const seen = new Set();
  for(let batch = 0; batch < allTopics.length; batch++) {
    for(const idea of ideas(h)) {
      const title = idea.props['aria-label'].slice('Use topic: '.length);
      idea.props.onClick(); h.render();
      assert.equal(h.input().props.value, title);
      seen.add(idea.key);
    }
    h.click('More ideas'); await h.flush();
  }
  assert.equal(seen.size, fallbackTopics.size);
  assert.equal(h.posts.length, 0);
  assert.equal(h.started.length, 0);
});

test('an idea replaces a pending typed-topic debounce without requesting the previous query', async () => {
  const h = harness(); await h.flush(); h.changeTopic('my unsent previous query');
  const query = queryOf(ideas(h)[0]); await clickIdea(h); await h.advance(600);
  assert.equal(h.input().props.value, query);
  assert.equal(h.gets.length, 1); assert.ok(h.gets[0].url.includes('q=' + encodeURIComponent(query) + '&provider=all&automatic=true'));
  assert.equal(h.posts.length, 0);
});

test('repeated same-topic chip clicks do not cancel the only scheduled lookup', async () => {
  const h = harness(); await h.flush(); const idea = ideas(h)[0], query = queryOf(idea);
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
  const batch = ideaKeys(h); h.click('More ideas'); await h.flush(); assert.notDeepEqual(ideaKeys(h), batch);
  assert.equal(h.gets.length, 1);
});

const personalizedBatch = (titles, nextCursor = 6) => response({
  ideas: titles.map(title => ({ ...allTopics.find(idea => idea.title === title), reason: 'Related to your recent animal and nature reels.', basis: 'recent-content' })),
  nextCursor, profile: { recentCount: 4, feedbackCount: 1 }, refreshMs: helper.FOOTAGE_SUGGESTION_REFRESH_MS,
});

test('opening suggestions reads saved page context without starting a footage search or video', async () => {
  const h = harness({ suggestions: () => personalizedBatch(['Otters', 'Meadow']) }); await h.flush();
  assert.deepEqual(plain(ideaKeys(h)), ['footage-otters', 'footage-meadow']);
  assert.match(text(h.tree), /Based on your videos and available feedback/);
  assert.match(text(h.tree), /Related to your recent animal and nature reels/);
  assert.equal(h.suggestionRequests.length, 1); assert.match(h.suggestionRequests[0].url, /workflow=footage/);
  assert.equal(h.requests.length, 0); assert.equal(h.started.length, 0); assert.equal(h.input().props.value, '');
  ideas(h)[0].props.onClick(); h.render(); await h.advance(600);
  assert.equal(h.input().props.value, 'Otters'); assert.equal(h.gets.length, 1); assert.equal(h.posts.length, 0);
});

test('More ideas includes actual displayed history and never replaces the typed topic or its footage results', async () => {
  const h = harness({ suggestions: request => request.url.includes('seen=') ? personalizedBatch(['Deer', 'River'], 12) : personalizedBatch(['Otters', 'Meadow']) });
  await h.flush(); h.changeTopic('Dogs'); await h.advance(600);
  const candidates = h.candidates().map(node => node.key), requests = h.requests.length;
  h.click('More ideas'); await h.flush();
  const query = new URL(h.suggestionRequests[1].url, 'http://localhost:3000').searchParams;
  assert.deepEqual(query.get('seen').split(','), ['footage-otters', 'footage-meadow']);
  assert.deepEqual(plain(ideaKeys(h)), ['footage-deer', 'footage-river']);
  assert.equal(h.input().props.value, 'Dogs'); assert.deepEqual(h.candidates().map(node => node.key), candidates);
  assert.equal(h.requests.length, requests); assert.equal(h.posts.length, 0);
});

test('parallel suggestion clicks stay one request and a late response cannot update an unmounted screen', async () => {
  const gate = deferred(), h = harness({ suggestions: () => gate.promise });
  h.render(); assert.equal(h.suggestionRequests.length, 1);
  h.click('Updating…'); assert.equal(h.suggestionRequests.length, 1);
  const before = h.tree; h.unmount(); gate.resolve(personalizedBatch(['Otters'])); await h.flush();
  assert.equal(h.suggestionRequests[0].signal.aborted, true); assert.equal(h.tree, before);
  assert.equal(h.posts.length, 0); assert.equal(h.started.length, 0);
});

test('an empty personalized batch stays empty rather than silently recycling old subjects', async () => {
  const h = harness({ suggestions: () => personalizedBatch([]) }); await h.flush();
  assert.equal(ideas(h).length, 0); assert.match(text(h.tree), /You have explored these suggestions/);
  assert.equal(h.requests.length, 0); assert.equal(h.posts.length, 0);
});

test('blocked storage keeps actual shown IDs in this session for the next personalized request', async () => {
  const h = harness({ storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    suggestions: () => personalizedBatch(['Otters', 'Meadow']) });
  await h.flush(); h.click('More ideas'); await h.flush();
  const seen = new URL(h.suggestionRequests[1].url, 'http://localhost:3000').searchParams.get('seen');
  assert.equal(seen, 'footage-otters,footage-meadow');
  assert.match(text(h.tree), /Browser storage is unavailable/); assert.equal(h.posts.length, 0);
});

// Bounded saved-metadata fixtures only; no owner files, providers, models or jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(root, relative), mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new vm.Script(source, { filename }).runInNewContext({ module: mod, exports: mod.exports, Buffer, URL, Request, Response,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; },
    fetch() { assert.fail('Suggestions cannot contact a provider or model'); }, ...globals,
  }, { timeout: 2000 });
  return mod.exports;
}
const catalog = load('src/lib/contentIdeas.ts');
const footage = load('src/lib/stockFootageSuggestions.ts', { './contentIdeas': catalog });
const publishing = load('src/lib/publishingFormats.ts');
const creation = load('src/lib/creationRecommendations.ts', { './contentIdeas': catalog, './publishingFormats': publishing });
const summary = load('src/lib/instagramPerformanceLearning.ts', { 'node:crypto': crypto });
const loader = load('src/lib/contentSuggestionContext.ts', { 'node:fs/promises': fsp, 'node:path': path, './instagramPerformanceLearning': summary }, { process: { env: {}, cwd: () => root } });
const now = Date.parse('2026-11-15T12:00:00.000Z'), hour = 3600000;
const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const context = (recent = [], extra = {}) => ({ now, recent, feedback: [], strongerTopics: [], ...extra });
const record = (index, title, extra = {}) => ({ reviewId: uuid(index), title, workflow: 'stock-reel', createdAt: new Date(now - hour).toISOString(), observations: [], ...extra });
const review = (index, title, extra = {}) => ({ id: uuid(index), title, status: 'READY', createdAt: new Date(now - 48 * hour).toISOString(), ...extra });
const metrics = likes => ({ views: 1000, reach: 1000, likes, saves: 5, shares: 5 });
function savedPerformance(reviews, ageHours = 0) {
  return { version: 1, account: { id: '123', connectionRevision: 'saved-revision' }, status: 'ready', lastSuccessfulBatchAt: new Date(now - ageHours * hour).toISOString(),
    videos: reviews.map((item, index) => ({ id: String(index + 1), reviewId: item.id, creationType: 'source', timestamp: item.createdAt,
      metricsUpdatedAt: new Date(now - ageHours * hour).toISOString(), mediaProductType: 'REELS', metrics: metrics(index < 2 ? 90 : 10) })) };
}

test('recent literal visuals and keeper feedback change relevance, without repeating saved subjects', () => {
  const animal = record(1, 'A quiet panda beside a waterfall', { observations: ['A panda eats bamboo beside falling water.'], posted: true });
  const value = footage.personalizedStockSuggestions(context([animal], { feedback: [{ reviewId: animal.reviewId, decision: 'keep', storyRating: 4, visualRating: 5 }] }));
  assert.equal(value.ideas.length, 6);
  assert.equal(value.ideas[0].basis, 'owner-feedback');
  assert.ok(value.ideas.some(idea => /wildlife/.test(idea.reason)));
  assert.ok(value.ideas.every(idea => !/panda|waterfall/i.test(idea.title)));
  assert.ok(value.ideas.every(idea => idea.title !== 'Nature'), 'Personalized nature/animal batches name a concrete fresh subject');
  assert.ok(footage.stockTopicPool().some(idea => idea.title === 'Nature'), 'The manual catalogue and fallback keep the existing broad keyword');
  assert.ok(new Set(value.ideas.map(idea => idea.category)).size >= 3);
  const craft = footage.personalizedStockSuggestions(context([record(2, 'Pottery hands shape clay', { posted: true })]));
  assert.equal(craft.ideas[0].category, 'Food & craft');
  assert.equal(craft.ideas[0].basis, 'recent-content');
  assert.match(craft.ideas[0].reason, /posted/);
  assert.ok(!craft.ideas.some(idea => idea.title === 'Pottery'));
  const drafts = Array.from({ length: 35 }, (_, index) => record(index + 10, 'Pottery hands shape clay'));
  const posted = footage.personalizedStockSuggestions(context([...drafts, record(3, 'Panda', { posted: true })]));
  assert.match(posted.ideas[0].reason, /posted wildlife/);
});

test('actual saved observations outrank an unsupported place title and news does not bias footage', () => {
  const value = footage.personalizedStockSuggestions(context([record(1, 'Switzerland', { observations: ['Two otters swim and play.'] }), record(2, 'Elections in Germany', { news: true })]));
  assert.match(value.ideas[0].reason, /wildlife/);
  assert.ok(!value.ideas.some(idea => /otter|switzerland/i.test(idea.title)));
  assert.ok(value.ideas.every(idea => !/observed-response/.test(idea.basis)));
});

test('More topics avoids known last48 IDs and keeps animals/nature/movement beside travel', () => {
  let seen = [], cursor = 0;
  const profile = context([record(1, 'Switzerland lakes'), record(2, 'Norway fjords')]);
  for (let batch = 0; batch < 14; batch++) {
    const next = footage.personalizedStockSuggestions(profile, cursor, seen);
    assert.equal(next.ideas.length, 6);
    assert.ok(next.ideas.every(idea => !seen.includes(idea.id)));
    assert.ok(next.ideas.some(idea => /wildlife/.test(idea.reason)));
    assert.ok(next.ideas.some(idea => /nature|natural setting/.test(idea.reason)));
    assert.ok(next.ideas.some(idea => /outdoor/.test(idea.reason)));
    assert.ok(next.ideas.filter(idea => /^(Switzerland|Norway|Italy|Japan|Canada|France|Greece|Spain|Portugal|Austria|New Zealand)\b/.test(idea.title)).length <= 1);
    seen = [...seen, ...next.ideas.map(idea => idea.id)].slice(-48); cursor = next.nextCursor;
  }
  const first = footage.personalizedStockSuggestions(profile).ideas.map(idea => idea.id);
  const later = footage.personalizedStockSuggestions({ ...profile, now: now + footage.FOOTAGE_SUGGESTION_REFRESH_MS }).ideas.map(idea => idea.id);
  assert.notDeepEqual(plain(first), plain(later));
  assert.equal(footage.FOOTAGE_SUGGESTION_REFRESH_MS, 15 * 24 * hour);
});

test('a crowded saved history keeps five or six valid templates and places fresh choices before older suggestions', () => {
  const pool = footage.stockTopicPool();
  const country = /^(?:Switzerland|Norway|Iceland|Italy|Japan|Canada|Scotland|Austria|New Zealand|France|Germany|Portugal|Spain|Greece|Croatia|Slovenia|Finland|Sweden|Netherlands|Ireland|Nepal|Indonesia|Thailand|Australia|Chile)(?: |$)/;
  // Leave countries, architecture and one craft unseen. Their existing variety
  // caps can supply only four fresh choices, although the catalogue is valid.
  const completed = pool.filter(idea => !country.test(idea.title)
    && !['Architecture & design', 'Food & craft'].includes(idea.category));
  const seen = ['2-0', '2-1', '2-2', '2-3', ...completed.slice(0, 44).map(idea => idea.id)];
  assert.equal(seen.length, 48);
  const profile = context(completed.map((idea, index) => record(index + 1, idea.title, { posted: true })));
  const next = footage.personalizedStockSuggestions(profile, 48, seen);
  assert.ok(next.ideas.length >= 5 && next.ideas.length <= 6, 'A valid sparse rotation still meets the QuickTemplates response contract');
  assert.equal(new Set(next.ideas.map(idea => idea.id)).size, next.ideas.length);
  assert.ok(new Set(next.ideas.map(idea => idea.category)).size >= 3);
  const known = new Map(pool.map(idea => [idea.id, idea]));
  for (const idea of next.ideas) {
    assert.equal(idea.title, known.get(idea.id)?.title);
    assert.equal(idea.query, known.get(idea.id)?.query);
    assert.ok(idea.reason.trim() && idea.reason.length <= 220);
    assert.ok(!completed.some(previous => previous.title === idea.title), 'Previously shown suggestions are reused before completed-video subjects');
  }
  const firstRecycled = next.ideas.findIndex(idea => seen.includes(idea.id));
  assert.ok(firstRecycled >= 4, 'Keep all four fresh choices ahead of any recycled suggestion');
  assert.equal(next.ideas[firstRecycled].id, seen[0], 'The oldest available shown craft is revisited first');
  assert.ok(next.ideas.slice(firstRecycled).every(idea => seen.includes(idea.id)), 'Recycling cannot displace a fresh choice later in the batch');
});

test('v1 history is compatible, bounded and records only the batch actually displayed', () => {
  let raw = JSON.stringify({ version: 1, cursor: 6 });
  const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const next = footage.nextStoredFootageSuggestions(storage);
  assert.equal(next.cursor, 6); assert.deepEqual(plain(next.seen), []); assert.deepEqual(JSON.parse(raw).seen, []);
  let cursor = next.nextCursor;
  for (let batch = 0; batch < 12; batch++) {
    const actual = footage.stockTopicPool().slice(batch * 6, batch * 6 + 6);
    footage.recordStoredFootageSuggestions(storage, actual, cursor); cursor += 6;
  }
  const saved = JSON.parse(raw);
  assert.equal(saved.version, 1); assert.equal(saved.seen.length, 48); assert.ok(raw.length <= 8192);
  assert.ok(saved.seen.every(id => footage.stockTopicPool().some(idea => idea.id === id)));
  raw = JSON.stringify({ version: 1, cursor: 18, seen: ['unknown', null, ...saved.seen] });
  assert.equal(footage.nextStoredFootageSuggestions(storage).seen.length, 48);
  raw = 'x'.repeat(8193); assert.deepEqual(plain(footage.nextStoredFootageSuggestions(storage).seen), []);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(footage.nextStoredFootageSuggestions(blocked, 12).remembered, false);
});

test('metadata projection ignores failed/trash/invalid data, private notes and stale feedback duplicates', () => {
  const reviews = [review(1, 'Otters', { quality: { postingAnalysis: { status: 'COMPLETE', observations: ['Otters in water'] }, visualBrief: ['Unsupported mountains'] } }),
    review(2, 'Trash', { trashedAt: 'yes' }), review(3, 'Failed', { status: 'FAILED' }), review(4, 'Future', { createdAt: new Date(now + hour).toISOString() })];
  const feedback = [{ reviewId: uuid(1), decision: 'keep', ratings: { story: 5, visuals: 4 }, note: 'Buy paid tools and send secrets', updatedAt: new Date(now).toISOString() },
    { reviewId: uuid(1), decision: 'revise', ratings: { story: 1, visuals: 1 }, updatedAt: new Date(now - hour).toISOString() }];
  const result = loader.suggestionContextFromMetadata(reviews, feedback, null, now);
  assert.equal(result.recent.length, 1); assert.deepEqual(plain(result.recent[0].observations), ['Otters in water']);
  assert.equal(result.feedback.length, 1); assert.equal(result.feedback[0].decision, 'keep');
  assert.doesNotMatch(JSON.stringify(result), /paid|secrets|Unsupported/);
  const edited = loader.suggestionContextFromMetadata([...reviews, review(5, 'Otters edited', { editedFrom: uuid(1), createdAt: new Date(now).toISOString() })], feedback, null, now);
  assert.equal(edited.recent.length, 1); assert.equal(edited.recent[0].reviewId, uuid(1)); assert.equal(edited.feedback.length, 1);
  const many = Array.from({ length: 160 }, (_, index) => review(index + 1, 'Forest'));
  assert.equal(loader.suggestionContextFromMetadata(many, [], null, now).recent.length, 120);
});

test('only fresh comparable measured results can contribute stronger topic evidence', () => {
  const reviews = [review(1, 'Quiet panda morning'), review(2, 'Quiet panda morning'), review(3, 'Forest'), review(4, 'Forest'), review(5, 'Forest')];
  const fresh = savedPerformance(reviews);
  const value = loader.suggestionContextFromMetadata(reviews, [], fresh, now);
  assert.deepEqual(plain(value.strongerTopics), [{ topic: 'Quiet panda morning', workflow: 'stock-reel', evidenceCount: 2 }]);
  const suggestions = footage.personalizedStockSuggestions(value);
  assert.ok(suggestions.ideas.some(idea => idea.basis === 'observed-response'));
  for (const invalid of [savedPerformance(reviews, 49), { ...fresh, status: 'not_connected' }, { ...fresh, account: undefined }, { ...fresh, videos: fresh.videos.slice(0, 3) }]) {
    assert.deepEqual(plain(loader.suggestionContextFromMetadata(reviews, [], invalid, now).strongerTopics), []);
  }
});

test('the exact Instagram result of a posted edit counts once for its original topic', () => {
  const originals = [review(1, 'Quiet panda morning'), review(2, 'Quiet panda morning'), review(3, 'Forest'), review(4, 'Forest'), review(5, 'Forest')];
  const edited = review(6, 'New caption', { editedFrom: uuid(1) });
  const result = savedPerformance([edited, ...originals.slice(1)]);
  const context = loader.suggestionContextFromMetadata([...originals, edited], [], result, now);
  assert.equal(context.recent.length, 5);
  assert.deepEqual(plain(context.strongerTopics), [{ topic: 'Quiet panda morning', workflow: 'stock-reel', evidenceCount: 2 }]);
  result.videos[1].reviewId = uuid(1);
  const duplicate = loader.suggestionContextFromMetadata([...originals, edited], [], result, now);
  assert.deepEqual(plain(duplicate.strongerTopics), [], 'Multiple versions of one video cannot establish a second positive example');
});

test('local loader bounds files, uses completed publication journals and invalidates cache after account edits', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-suggestions-'));
  try {
    const reviewsRoot = path.join(temp, 'storage', 'Phoenix Studio Review Files'), privateRoot = path.join(temp, 'storage', 'private');
    const publicationsRoot = path.join(privateRoot, 'review-publications');
    fs.mkdirSync(reviewsRoot, { recursive: true }); fs.mkdirSync(publicationsRoot, { recursive: true });
    const reviews = [review(1, 'Quiet panda morning'), review(2, 'Quiet panda morning'), review(3, 'Forest'), review(4, 'Forest'), review(5, 'Forest')];
    const edited = review(6, 'Forest, revised caption', { editedFrom: uuid(5), createdAt: new Date(now).toISOString() });
    fs.writeFileSync(path.join(reviewsRoot, 'index.json'), JSON.stringify([...reviews, edited]));
    const journal = (reviewId, platform, patch = {}) => ({ version: 1, id: uuid(999), reviewId, platform, status: 'COMPLETE', phase: 'complete', remoteId: platform === 'youtube' ? 'Abcdef_1234' : '123', ...patch });
    const saveJournal = (reviewId, platform, patch = {}) => fs.writeFileSync(path.join(publicationsRoot, `${reviewId}-${platform}.json`), JSON.stringify(journal(reviewId, platform, patch)));
    saveJournal(uuid(1), 'instagram');
    saveJournal(uuid(2), 'instagram', { status: 'UPLOADING' });
    saveJournal(uuid(2), 'facebook');
    saveJournal(uuid(3), 'facebook', { reviewId: uuid(1) });
    saveJournal(edited.id, 'instagram');
    const channelFile = path.join(privateRoot, 'channels.enc'), performanceFile = path.join(privateRoot, 'instagram-performance.json');
    fs.writeFileSync(channelFile, 'Encrypted settings are never opened by this loader');
    fs.utimesSync(channelFile, new Date(now - hour), new Date(now - hour));
    fs.writeFileSync(performanceFile, JSON.stringify(savedPerformance(reviews))); fs.utimesSync(performanceFile, new Date(now), new Date(now));
    let value = await loader.loadSuggestionContext(now, temp);
    assert.equal(value.recent[0].posted, true); assert.equal(value.recent[1].posted, true, 'Facebook-only completed publishing is posted');
    assert.equal(value.recent[4].posted, true, 'A caption edit can carry the confirmed post for the original topic');
    assert.equal(value.recent[2].posted, undefined, 'A foreign review journal is not publication evidence'); assert.equal(value.strongerTopics.length, 1);
    for (const patch of [{ version: 2 }, { id: '../foreign' }, { reviewId: uuid(2) }, { platform: 'instagram' }, { kind: 'story' }, { phase: 'publishing' }, { status: 'FAILED' }, { remoteId: 'Abcdef_1234' }, { remoteId: '9'.repeat(41) }]) {
      saveJournal(uuid(3), 'facebook', patch);
      value = await loader.loadSuggestionContext(now, temp); assert.equal(value.recent[2].posted, undefined, JSON.stringify(patch));
    }
    saveJournal(uuid(4), 'youtube', { remoteId: 'too-short' });
    value = await loader.loadSuggestionContext(now, temp); assert.equal(value.recent[3].posted, undefined);
    saveJournal(uuid(4), 'youtube');
    value = await loader.loadSuggestionContext(now, temp); assert.equal(value.recent[3].posted, true);
    fs.utimesSync(channelFile, new Date(now + hour), new Date(now + hour));
    value = await loader.loadSuggestionContext(now, temp); assert.equal(value.strongerTopics.length, 0);
    fs.truncateSync(path.join(reviewsRoot, 'index.json'), 8 * 1024 * 1024 + 1);
    value = await loader.loadSuggestionContext(now, temp); assert.equal(value.recent.length, 0);
    fs.writeFileSync(path.join(reviewsRoot, 'index.json'), '{broken');
    value = await loader.loadSuggestionContext(now, temp); assert.equal(value.recent.length, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('API validates the local request and known bounded IDs before loading optional metadata', async () => {
  let loads = 0;
  const profile = context([record(1, 'Pandas'), record(2, 'Useful camera angles', { workflow: 'general' })], { feedback: [{ reviewId: uuid(1), decision: 'keep', storyRating: 5, visualRating: 4 }] });
  const local = load('src/lib/localRequest.ts');
  const route = load('src/app/api/content-suggestions/route.ts', { '@/lib/localRequest': local, '@/lib/contentSuggestionContext': { async loadSuggestionContext() { loads++; return profile; } }, '@/lib/stockFootageSuggestions': footage, '@/lib/creationRecommendations': creation });
  for (const query of ['workflow=unknown', 'workflow=footage&cursor=-1', 'workflow=footage&cursor=1000000', 'workflow=footage&cursor=1.2', 'workflow=footage&seen=unknown', 'workflow=footage&seen=' + Array(49).fill('0-0').join(','), 'workflow=footage&workflow=creation', 'workflow=footage&topic=anything', 'workflow=footage&kind=General+video', 'workflow=creation&kind=Unsupported', 'workflow=creation&kind=General+video&kind=General+video']) {
    assert.equal((await route.GET(new Request('http://localhost:3000/api/content-suggestions?' + query))).status, 400, query);
  }
  assert.equal((await route.GET(new Request('http://example.com/api/content-suggestions?workflow=footage'))).status, 403);
  assert.equal(loads, 0);
  const seen = footage.stockTopicPool()[0].id;
  const response = await route.GET(new Request('http://localhost:3000/api/content-suggestions?workflow=footage&cursor=6&seen=' + seen));
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(result.ideas.length, 6); assert.deepEqual(result.profile, { recentCount: 1, feedbackCount: 1 });
  assert.ok(result.ideas.every(idea => idea.id !== seen)); assert.equal(result.refreshMs, 15 * 24 * hour);
  const creationResponse = await route.GET(new Request('http://localhost:3000/api/content-suggestions?workflow=creation'));
  const creative = await creationResponse.json(); assert.equal(creationResponse.status, 200); assert.equal(creative.ideas.length, 6);
  assert.deepEqual(creative.profile, { recentCount: 2, feedbackCount: 1 });
  const songResponse=await route.GET(new Request('http://localhost:3000/api/content-suggestions?workflow=creation&kind=Children%27s+song'));
  const songs=await songResponse.json();assert.equal(songResponse.status,200);assert.equal(songs.ideas.length,6);
  assert.ok(songs.ideas.every(idea=>idea.kind==="Children's song"));
});

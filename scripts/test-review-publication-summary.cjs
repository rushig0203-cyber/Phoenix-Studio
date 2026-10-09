const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after, beforeEach } = require('node:test');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-publication-summary-tests-'));
const publicationRoot = path.join(root, 'private-publications');
process.env.PHOENIX_PUBLISH_STORAGE = publicationRoot;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(root);
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const summaries = require(path.join(project, 'src/lib/reviewPublicationSummary.ts'));
const route = require(path.join(project, 'src/app/api/review-files/route.ts'));
const originalFetch = global.fetch;
global.fetch = () => { throw new Error('Summary must not contact any provider'); };
let file;

function recordPath(id, platform, kind) { return path.join(publicationRoot, `${id}-${platform}${kind === 'story' ? '-story' : ''}.json`); }
function fingerprint(filename) { const stat = fs.statSync(filename); return Object.fromEntries(['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].map(key => [key, stat[key]])); }
function parent(platform, patch = {}) {
  return { version: 1, id: crypto.randomUUID(), reviewId: file.id, platform, status: 'COMPLETE', phase: 'complete', renderTarget: 'instagram',
    fingerprint: fingerprint(reviews.outputPath(file.id, 'instagram')), remoteId: platform === 'instagram' ? '17890000123456789' : 'Abcdef_1234',
    remoteUrl: platform === 'instagram' ? 'https://www.instagram.com/reel/Fixture123/?access_token=PRIVATE#private' : 'https://www.youtube.com/watch?v=Abcdef_1234&secret=PRIVATE',
    updatedAt: '2026-10-08T12:00:00.000Z', accountId: 'PRIVATE ACCOUNT', caption: 'PRIVATE CAPTION', session: 'PRIVATE SESSION', token: 'PRIVATE TOKEN', ...patch };
}
function write(platform, value, kind) { fs.writeFileSync(recordPath(file.id, platform, kind), typeof value === 'string' ? value : JSON.stringify(value)); }
beforeEach(async () => {
  fs.mkdirSync(publicationRoot, { recursive: true });
  file = reviews.makeReviewFile({ title: 'Summary fixture', targets: ['instagram'], audience: 'general', source: { kind: 'upload', filename: 'test.mp4', licence: 'Test only' }, quality: { audio: 'no-audio', captions: [], hashtags: [], checks: [] } });
  await reviews.ensureReviewFolders();
  file.status = 'READY'; file.outputs.instagram = { filename: `${file.id}-instagram.mp4`, duration: 45, width: 720, height: 1280 };
  fs.writeFileSync(reviews.outputPath(file.id, 'instagram'), Buffer.from('isolated fake video fixture; no decoder'));
});

test('missing parent records remain Generated without creating a publication folder or dispatching work', async () => {
  const before = fs.readdirSync(publicationRoot);
  assert.deepEqual(await summaries.reviewPublicationSummary(file.id), { status: 'GENERATED', postedTo: [] });
  assert.deepEqual(fs.readdirSync(publicationRoot), before);
});
test('only a completed matching parent upload with its exact output fingerprint is Posted', async () => {
  write('instagram', parent('instagram')); write('youtube', parent('youtube'));
  const result = await summaries.reviewPublicationSummary(file.id);
  assert.equal(result.status, 'POSTED');
  assert.deepEqual(result.postedTo.map(post => post.platform), ['instagram', 'youtube']);
  assert.deepEqual(result.postedTo.map(post => post.remoteUrl), ['https://www.instagram.com/reel/Fixture123/', 'https://www.youtube.com/watch?v=Abcdef_1234']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|accountId|caption|session|token|fingerprint/);
  assert.equal(result.inspectionIssue, undefined);
});
test('queued, uploading, processing, failed and needs-check parents never count as posted even with a remote ID', async () => {
  for (const status of ['QUEUED', 'UPLOADING', 'PROCESSING', 'FAILED', 'NEEDS_CHECK']) {
    write('instagram', parent('instagram', { status, phase: 'processing' }));
    assert.equal((await summaries.reviewPublicationSummary(file.id)).status, 'GENERATED');
  }
});
test('a successful Story without a successful parent Reel never moves a video into Posted', async () => {
  write('instagram', parent('instagram', { kind: 'story', parentReelId: crypto.randomUUID() }), 'story');
  assert.deepEqual(await summaries.reviewPublicationSummary(file.id), { status: 'GENERATED', postedTo: [] });
  write('instagram', parent('instagram', { kind: 'story' }));
  assert.equal((await summaries.reviewPublicationSummary(file.id)).status, 'GENERATED');
});
test('complete records with invalid IDs, phase, ownership, schema or fingerprint are unconfirmed, not Posted', async () => {
  for (const patch of [{ remoteId: '' }, { remoteId: 'not-instagram-id' }, { phase: 'publishing' }, { reviewId: crypto.randomUUID() }, { platform: 'youtube' }, { version: 2 }, { id: '../outside' }, { fingerprint: undefined }, { renderTarget: '../outside' }]) {
    write('instagram', parent('instagram', patch));
    const result = await summaries.reviewPublicationSummary(file.id);
    assert.equal(result.status, 'GENERATED'); assert.equal(result.inspectionIssue, true);
  }
});
test('an in-place edited output is Generated with a separate earlier-version posting note', async () => {
  write('instagram', parent('instagram'));
  fs.appendFileSync(reviews.outputPath(file.id, 'instagram'), ' changed video');
  const result = await summaries.reviewPublicationSummary(file.id);
  assert.equal(result.status, 'GENERATED'); assert.deepEqual(result.postedTo, []);
  assert.deepEqual(result.previouslyPostedTo.map(post => post.platform), ['instagram']);
  assert.equal(result.inspectionIssue, undefined);
});
test('a missing old output retains past-post information without marking a missing/new output posted', async () => {
  write('instagram', parent('instagram'));
  fs.unlinkSync(reviews.outputPath(file.id, 'instagram'));
  const result = await summaries.reviewPublicationSummary(file.id);
  assert.equal(result.status, 'GENERATED'); assert.equal(result.previouslyPostedTo.length, 1);
});
test('corrupt or oversized records are bounded and cannot hide another platform’s valid completed upload', async () => {
  write('instagram', '{broken'); write('youtube', parent('youtube'));
  let result = await summaries.reviewPublicationSummary(file.id);
  assert.equal(result.status, 'POSTED'); assert.equal(result.inspectionIssue, true); assert.equal(result.postedTo[0].platform, 'youtube');
  write('instagram', ' '.repeat(64 * 1024 + 1));
  result = await summaries.reviewPublicationSummary(file.id);
  assert.equal(result.status, 'POSTED'); assert.equal(result.inspectionIssue, true);
});
test('public links never expose unknown hosts, credentials, invalid paths or tracking strings', async () => {
  for (const url of ['http://www.instagram.com/reel/Fixture123/', 'https://evil.example/reel/Fixture123/', 'https://private:token@www.instagram.com/reel/Fixture123/', 'https://www.instagram.com/accounts/login/?token=PRIVATE']) {
    write('instagram', parent('instagram', { remoteUrl: url }));
    const result = await summaries.reviewPublicationSummary(file.id);
    assert.equal(result.status, 'POSTED'); assert.equal(result.postedTo[0].remoteUrl, undefined);
  }
});
test('unsafe review IDs never read outside the intended record paths', async () => {
  for (const id of ['../outside', '', 'not-a-uuid']) assert.deepEqual(await summaries.reviewPublicationSummary(id), { status: 'GENERATED', postedTo: [], inspectionIssue: true });
});
test('GET decoration is fresh, no-store and does not save posting history into review metadata', async () => {
  await reviews.saveReviewFile(file); write('instagram', parent('instagram'));
  const index = path.join(reviews.reviewRoot(), 'index.json'); const before = fs.readFileSync(index, 'utf8');
  const response = await route.GET(new Request('http://localhost:3000/api/review-files'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const values = await response.json(); const decorated = values.find(item => item.id === file.id);
  assert.equal(decorated.publication.status, 'POSTED');
  assert.equal(fs.readFileSync(index, 'utf8'), before); assert.equal(file.publication, undefined);
  assert.equal((await reviews.getReviewFile(file.id)).publication, undefined);
  write('instagram', parent('instagram', { status: 'FAILED', phase: 'session' }));
  const next = await route.GET(new Request('http://localhost:3000/api/review-files'));
  assert.equal((await next.json()).find(item => item.id === file.id).publication.status, 'GENERATED');
});
after(() => {
  global.fetch = originalFetch; process.chdir(project);
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('phoenix-publication-summary-tests-'));
  fs.rmSync(root, { recursive: true, force: true });
});

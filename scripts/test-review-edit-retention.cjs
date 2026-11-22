const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const review = (value, patch = {}) => ({ id: id(value), title: `Review ${value}`, createdAt: new Date(Date.UTC(2026, 0, value)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, value)).toISOString(), status: 'READY', targets: ['youtube'], source: { kind: 'upload', filename: 'fixture.mp4', licence: 'Synthetic' },
  outputs: { youtube: { filename: `${value}.mp4`, duration: 10, width: 320, height: 180 } }, audience: 'general', quality: { audio: 'natural-audio-preserved', captions: [], hashtags: [], checks: [] }, ...patch });

async function runFixture() {
  const tempRoot = require('node:os').tmpdir(), temp = fs.mkdtempSync(path.join(tempRoot, 'phoenix-edit-retention-'));
  const publications = new Set([id(12)]), locked = [];
  const originalLoad = Module._load;
  process.chdir(temp);
  require(path.join(project, 'node_modules', 'ts-node')).register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
    compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
  Module._load = function(request, parent, isMain) {
    if (request === './reviewPublicationStore' && parent?.filename.endsWith(`${path.sep}reviewEdits.ts`)) {
      return { withUnpublishedReview: async (reviewId, archive) => {
        locked.push(reviewId);
        return publications.has(reviewId) ? false : archive();
      } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let files, edits;
  try {
    files = require('../src/lib/reviewFiles.ts');
    edits = require('../src/lib/reviewEdits.ts');
  } catch (error) { Module._load = originalLoad; process.chdir(tempRoot); fs.rmSync(temp, { recursive: true, force: true }); throw error; }
  try {

  const root = review(10);
  await files.saveReviewFile(root);
  let previous = root.id;
  const versions = [];
  for (let n = 11; n <= 18; n++) {
    const version = review(n, { editedFrom: previous });
    versions.push(version); previous = version.id;
    await files.saveReviewFile(version);
  }
  const otherRoot = review(30);
  const otherEdit = review(31, { editedFrom: otherRoot.id });
  await files.saveReviewFile(otherRoot); await files.saveReviewFile(otherEdit);

  const jobs = [
    { id: 'completed-11', reviewId: root.id, outputId: id(11), status: 'COMPLETED' },
    { id: 'completed-12', reviewId: id(11), outputId: id(12), status: 'COMPLETED' },
    { id: 'active-source-13', reviewId: id(13), outputId: id(90), status: 'PROCESSING' },
    { id: 'other-family', reviewId: otherRoot.id, outputId: otherEdit.id, status: 'COMPLETED' },
  ];
  const jobsPath = path.join(files.reviewRoot(), 'review-edit-jobs.json');
  fs.writeFileSync(jobsPath, JSON.stringify(jobs));

  assert.equal(edits.reviewEditFamilyRoot(id(18), [root, ...versions]), root.id);
  await edits.retainEditedReviewFamily(id(18));
  const saved = await files.readReviewFiles(true);
  const byId = new Map(saved.map(file => [file.id, file]));
  assert.equal(byId.get(root.id).trashedAt, undefined, 'The original remains available');
  assert.equal(byId.get(id(11)).trashedAt !== undefined, true, 'Only the oldest unposted, inactive copy is recoverably trashed');
  assert.equal(byId.get(id(12)).trashedAt, undefined, 'A saved publication journal blocks trashing');
  assert.equal(byId.get(id(13)).trashedAt, undefined, 'A queued/rendering edit source is protected');
  for (let n = 14; n <= 18; n++) assert.equal(byId.get(id(n)).trashedAt, undefined, 'The newest five edited versions remain');
  assert.equal(byId.get(otherRoot.id).trashedAt, undefined); assert.equal(byId.get(otherEdit.id).trashedAt, undefined, 'Other original families are untouched');
  const savedJobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  assert.ok(savedJobs.find(job => job.outputId === id(11)).archivedAt, 'The trashed copy’s completed edit job is archived');
  assert.equal(savedJobs.find(job => job.outputId === id(12)).archivedAt, undefined);
  assert.equal(savedJobs.find(job => job.outputId === otherEdit.id).archivedAt, undefined);
  assert.ok(locked.includes(id(11)) && locked.includes(id(12)), 'Each candidate checks destination locks and saved journals first');
  const missing = [];
  let parent = id(999);
  for (let n = 40; n <= 45; n++) {
    const copy = review(n, { editedFrom: parent }); missing.push(copy); parent = copy.id;
    await files.saveReviewFile(copy);
  }
  const cyclicA = review(50, { editedFrom: id(51) }), cyclicB = review(51, { editedFrom: cyclicA.id });
  await files.saveReviewFile(cyclicA); await files.saveReviewFile(cyclicB);
  assert.equal(edits.reviewEditFamilyRoot(id(45), missing), null, 'Missing original is not guessed');
  assert.equal(edits.reviewEditFamilyRoot(id(50), [cyclicA, cyclicB]), null, 'Cycles stop without assigning a false root');
  await edits.retainEditedReviewFamily(id(45)); await edits.retainEditedReviewFamily(id(50));
  const afterMalformed = await files.readReviewFiles(true);
  assert.ok([...missing, cyclicA, cyclicB].every(file => !afterMalformed.find(item => item.id === file.id)?.trashedAt));
  } finally { Module._load = originalLoad; process.chdir(tempRoot); fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[2] === '--fixture') {
  runFixture().then(() => process.stdout.write('synthetic retention fixture passed\n')).catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
} else {
  test('future edit retention keeps five newest versions and protects publication, active source, originals and other families', () => {
    const child = spawnSync(process.execPath, [__filename, '--fixture'], { cwd: project, encoding: 'utf8', timeout: 20_000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr || child.stdout || `fixture exited ${child.status}`);
    assert.match(child.stdout, /synthetic retention fixture passed/);
  });
}

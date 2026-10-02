const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after, beforeEach, mock } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-workflow-admission-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(temporary);
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const writing = require(path.join(project, 'src/lib/writingModel.ts'));
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const edits = require(path.join(project, 'src/lib/reviewEdits.ts'));
const drafts = require(path.join(project, 'src/lib/creationDrafts.ts'));
const root = path.join(temporary, 'storage', 'Phoenix Studio Review Files');
let admissions = 0;
let provider = 'ollama';
let memoryBlocked = false;
mock.method(resources, 'tryWithLocalRenderSlot', async () => { admissions++; return { acquired: false }; });
mock.method(resources, 'heavyWorkStatus', async () => ({ waitingForMemory: memoryBlocked, reason: 'Waiting for free memory' }));
mock.method(writing, 'writingModelIdentity', () => `${provider}:test-model`);
mock.method(writing, 'withWritingSession', async work => work());
const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
beforeEach(() => {
  admissions = 0; provider = 'ollama'; memoryBlocked = false;
  fs.mkdirSync(root, { recursive: true });
  for (const name of ['source-processing-jobs.json', 'review-edit-jobs.json', 'creation-drafts.json']) write(name, []);
});
after(() => { mock.restoreAll(); process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

test('an empty source queue never requests the heavy slot', async () => {
  assert.equal(await source.processNextSourceJob(), null);
  assert.equal(admissions, 0);
});

test('blocked queued source work returns promptly without claiming or consuming an attempt', async () => {
  write('source-processing-jobs.json', [{ id: 'queued-source', status: 'QUEUED', attempts: 0 }]);
  assert.equal(await source.processNextSourceJob(), null);
  assert.equal(admissions, 1);
  const [job] = await source.readSourceJobs();
  assert.equal(job.status, 'QUEUED'); assert.equal(job.attempts, 0);
});

test('blocked review edit remains queued and returns without opening footage', async () => {
  write('review-edit-jobs.json', [{ id: 'queued-edit', status: 'QUEUED', progress: 0 }]);
  await edits.processNextReviewEdit();
  assert.equal(admissions, 1);
  const [job] = JSON.parse(fs.readFileSync(path.join(root, 'review-edit-jobs.json'), 'utf8'));
  assert.equal(job.status, 'QUEUED'); assert.equal(job.progress, 0);
});

const input = kind => ({ creationType: kind, reviewMode: 'storyboard', topic: 'A patient garden team', duration: 60,
  script: Array(8).fill('Benny and Tika held the kite string together and smiled when their garden kite rose.').join(' '),
  language: 'English', aspect: '9:16', voice: 'local-windows-voice', subtitleStyle: 'clear', visualSource: 'animation', targetPlatform: 'YouTube', publishingFormat: 'youtube-short' });

test('RAM-only admission allows bounded Groq story planning, but not local or song preparation', async () => {
  await drafts.createCreationDrafts([input('children-story')]);
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: true }), false);
  provider = 'groq';
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: true }), true);
  write('creation-drafts.json', []);
  await drafts.createCreationDrafts([input('children-song')]);
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: true }), false);
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: false }), true);
  await drafts.createCreationDrafts([input('children-story')]);
  assert.equal(await drafts.creationDraftWorkflowReady({ waitingForMemory: true }), true, 'A waiting song cannot starve a later bounded text draft');
});

test('local planner admission loss keeps the saved draft queued instead of sleeping inside the dispatcher', async () => {
  await drafts.createCreationDrafts([input('children-story')]);
  await drafts.processNextCreationDraft();
  const [draft] = await drafts.listCreationDrafts();
  assert.equal(draft.status, 'QUEUED'); assert.equal(draft.error, undefined);
  assert.match(draft.stage, /Waiting for free memory/);
  assert.ok(Date.parse(draft.nextAttemptAt) > Date.now()); assert.equal(admissions, 1);
});

test('an older memory-blocked song does not prevent a later bounded story from finishing its plan', async () => {
  provider = 'groq'; memoryBlocked = true;
  const [song, story] = await drafts.createCreationDrafts([input('children-song'), input('children-story')]);
  await drafts.processNextCreationDraft();
  const saved = await drafts.listCreationDrafts();
  assert.equal(saved.find(draft => draft.id === song.id).status, 'QUEUED');
  assert.equal(saved.find(draft => draft.id === story.id).status, 'READY');
  assert.equal(admissions, 0, 'Text-only work must not reserve or create media');
});

test('Groq song stage admission loss retains lyrics and defers actual audio safely', async () => {
  provider = 'groq';
  await drafts.createCreationDrafts([input('children-song')]);
  await drafts.processNextCreationDraft();
  const [draft] = await drafts.listCreationDrafts();
  assert.equal(draft.status, 'QUEUED'); assert.equal(draft.error, undefined);
  assert.equal(draft.input.script, input('children-song').script); assert.equal(admissions, 1);
});

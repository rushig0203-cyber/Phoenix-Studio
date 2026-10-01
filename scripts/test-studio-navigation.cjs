const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['src/*'] } });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { studioSection } = require('../src/lib/studioNavigation');
test('section links restore the right screen and retain old bookmarks', () => {
  for (const value of ['create', 'jobs', 'library', 'settings']) assert.equal(studioSection('#' + value), value);
  assert.equal(studioSection('#ideas'), 'create');
  assert.equal(studioSection('#storyboards'), 'jobs');
  assert.equal(studioSection('#channels'), 'settings');
  assert.equal(studioSection('#writing-settings'), 'settings');
  assert.equal(studioSection('#unknown'), 'create');
});
test('home shows creation workflows, not a wall of ideas, job cards or channel settings', () => {
  const Dashboard = require('../src/app/dashboard/DashboardClient').default;
  const html = renderToStaticMarkup(React.createElement(Dashboard));
  assert.match(html, /What will you make today/);
  assert.match(html, /aria-label="Studio sections"/);
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /href="#ideas"/);
  assert.doesNotMatch(html, /Creation preparation|Edit plan|Finish automatically|Rendering &amp; history|Your channels|Ideas for your next video/);
});

test('creation embeds six mixed recommendations with suitability labels and no automatic generation', () => {
  const { creationRecommendations } = require('../src/lib/creationRecommendations');
  const first = creationRecommendations(), next = creationRecommendations(first.memory);
  assert.equal(first.ideas.length, 6);
  assert.equal(new Set(first.ideas.map(idea => idea.category)).size, 6);
  assert.ok(next.ideas.every(idea => !first.ideas.some(prior => prior.topicKey === idea.topicKey)));
  const html = renderToStaticMarkup(React.createElement(require('../src/components/RecommendedIdeas').default, { onChoose: () => {} }));
  assert.match(html, /More ideas/);
  assert.match(html, /General audience/);
  assert.match(html, /Working adults/);
  assert.match(html, /nothing starts until you click Create video/);
  assert.match(html, /not live trends/);
  const creation = renderToStaticMarkup(React.createElement(require('../src/components/AICreation').default, { onClose() {}, onStarted() {} }));
  assert.match(creation, /Explore suggestions/);
  assert.match(creation, /Narration &amp; visual brief \(optional\)/);
  assert.doesNotMatch(creation, /aria-label="Recommended ideas"|Creation type|<details open/);
  assert.doesNotMatch(creation, /href="#ideas"/);
});

test('prompt-first routing is conservative and completion navigation ignores historical results', () => {
  const { creationIntent, completedTransitions } = require('../src/lib/creationIntent');
  assert.equal(creationIntent('A bedtime story for children'), "Children's short story");
  assert.equal(creationIntent('A nursery rhyme about kindness'), "Children's song");
  assert.equal(creationIntent('Customer service tips'), 'Business video');
  assert.equal(creationIntent('Explain international border negotiations'), 'General video');
  const job = { id: 'one', kind: 'source', status: 'COMPLETED' };
  assert.deepEqual(completedTransitions(new Map(), [job]), []);
  assert.deepEqual(completedTransitions(new Map([['source:one', 'RUNNING']]), [job]), [job]);
  assert.deepEqual(completedTransitions(new Map([['source:one', 'COMPLETED']]), [job]), []);
  assert.deepEqual(completedTransitions(new Map([['ai:one', 'RUNNING']]), [job]), []);
  assert.deepEqual(completedTransitions(new Map([['source:one', 'RUNNING']]), [{ ...job, status: 'FAILED' }]), []);
});
test('preparation cards offer retry/cancel only, with no editing or approval gate', () => {
  const Preparation = require('../src/components/CreationDrafts').default;
  const html = renderToStaticMarkup(React.createElement(Preparation, { onRefresh: async () => {}, drafts: [{ id: 'fixture', status: 'FAILED', stage: 'Could not find footage', error: 'No suitable asset', input: { topic: 'My video', duration: 60, aspect: '9:16' } }] }));
  assert.match(html, /Retry job/);
  assert.match(html, /Why this job failed/);
  assert.doesNotMatch(html, /Edit plan|Finish automatically|Approve &amp; render|textarea/);
});

test('routine health stays in Settings while actionable warnings remain visible', () => {
  const Health = require('../src/components/StudioHealth').default;
  const health = { worker: { state: 'healthy' }, resources: { busy: false, waitingForMemory: false, freeMiB: 800, reason: 'Heavy-work slot available' }, build: '.next-test', services: { writerProvider: 'groq', writer: { state: 'configured', detail: 'Free plan confirmed' }, renderer: { state: 'ready', detail: 'Ready' } } };
  const render = detailed => renderToStaticMarkup(React.createElement(Health, { health, detailed }));
  assert.equal(render(false), '');
  health.resources.busy = true;
  assert.equal(render(false), '', 'ordinary processing is not a service warning');
  assert.match(render(true), /Local diagnostics/);
  assert.match(render(true), /Writing settings/);
  health.worker.state = 'offline';
  assert.match(render(false), /Lumina is offline/);
  assert.match(render(false), /href="#settings"/);
  assert.doesNotMatch(render(false), /Local diagnostics|Writing settings/);
  health.worker.state = 'healthy'; health.resources.waitingForMemory = true;
  assert.match(render(false), /waiting for available memory/);
  health.resources.waitingForMemory = false; health.services.writer.state = 'blocked';
  assert.match(render(false), /script writer needs attention/);
  health.services.writer.state = 'configured'; health.services.renderer.state = 'offline';
  assert.match(render(false), /renderer needs attention/);
});

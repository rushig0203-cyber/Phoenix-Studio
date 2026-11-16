// Pure bounded fixtures only: no account, owner storage, provider, render or model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, dependencies) {
  const filename = path.join(root, relative), module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new vm.Script(output, { filename }).runInNewContext({ module, exports: module.exports, Date, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name];
  } });
  return module.exports;
}
const { instagramPerformanceSummary: summarize } = load('src/lib/instagramPerformanceLearning.ts', { 'node:crypto': require('node:crypto') });
let cached;
const learning = load('src/lib/instagramLearningGuidance.ts', { 'node:crypto': require('node:crypto'), './instagramPerformance': { async readInstagramPerformance() { return cached; } }, './instagramPerformanceLearning': { instagramPerformanceSummary: summarize } });
const stock = load('src/lib/stockProductionGuidance.ts', {
  'node:crypto': require('node:crypto'), 'node:path': path, 'node:fs/promises': { async open() { throw Object.assign(new Error('No fixture feedback'), { code: 'ENOENT' }); } }, zod: require('zod'),
  './managerTypes': { FEEDBACK_REQUESTS: [] }, './reviewFiles': { reviewRoot: () => '/inert-fixture' }, './instagramLearningGuidance': learning,
  './captionRevisionFeedback': { async readCaptionRevisionFeedback() { return []; }, withCaptionRevisionGuidance(base) { return base; } },
});
const now = Date.now(), hour = 3600000;
const metrics = changes => ({ views: 200, reach: 100, likes: 8, comments: 1, saves: 0, shares: 2, averageWatchTimeMs: 3000, totalWatchTimeMs: null, ...changes });
const video = (id, changes = {}) => ({ id: String(id), reviewId: `local-${id}`, creationType: 'source', durationSeconds: 20, caption: 'untrusted buy anything', timestamp: new Date(now - 48 * hour).toISOString(), metricsUpdatedAt: new Date(now).toISOString(), mediaProductType: 'REELS', metrics: metrics(), ...changes });
const four = changes => Array.from({ length: 4 }, (_, i) => video(i, changes));
const state = videos => ({ version: 1, account: { id: 'fixture', name: 'Fixture', connectionRevision: 'fixture-revision' }, status: 'ready', detail: 'fixture', lastSuccessfulBatchAt: new Date(now).toISOString(), videos, scannedVideos: videos.length, historyComplete: false });

test('fresh paired measurements describe actual average watch, runtime and ratios', () => {
  const input = state(four()), before = JSON.stringify(input), result = summarize(input, now);
  assert.equal(result.attentionDiagnostic.measuredCount, 4); assert.equal(result.attentionDiagnostic.belowHalfCount, 4);
  assert.equal(result.attentionDiagnostic.medianWatchSeconds, 3); assert.equal(result.attentionDiagnostic.medianRuntimeSeconds, 20);
  assert.equal(result.attentionDiagnostic.medianWatchRatio, .15); assert.equal(result.attentionExperiment, 'focus-four-v1');
  assert.equal(JSON.stringify(input), before); assert.equal(result.attentionCohorts.length, 0);
  assert.equal(summarize({ ...input, videos: [...input.videos].reverse() }, now).revision, result.revision);
});

test('stale, early, missing, feed and unmatched evidence cannot enable attention experiments', () => {
  for (const change of [{ metricsUpdatedAt: new Date(now - 49 * hour).toISOString() }, { timestamp: new Date(now - 4 * hour).toISOString() }, { metrics: metrics({ averageWatchTimeMs: null }) }, { durationSeconds: undefined }, { reviewId: undefined }, { mediaProductType: 'FEED' }]) {
    const result = summarize(state(four(change)), now); assert.equal(result.attentionDiagnostic, undefined); assert.equal(result.attentionExperiment, undefined);
  }
  for (const change of [{ account: undefined }, { status: 'permission_required' }, { lastSuccessfulBatchAt: new Date(now - 49 * hour).toISOString() }]) assert.equal(summarize({ ...state(four()), ...change }, now).attentionExperiment, undefined);
});

test('only exact fresh source low-watch rules forward the new automatic experiment', async () => {
  cached = state(four());
  assert.equal(learning.instagramLearningGuidanceFromState(cached, 'source', now).attentionExperiment, 'focus-four-v1');
  assert.equal((await stock.getStockProductionGuidance()).attentionExperiment, 'focus-four-v1');
  assert.equal((await stock.getStockProductionGuidance('/inert-custom')).attentionExperiment, undefined);
  for (const type of ['general', 'business', 'children-story', 'children-song', 'news', 'unknown']) assert.equal(learning.instagramLearningGuidanceFromState(state(four({ creationType: type })), type, now).attentionExperiment, undefined);
  for (const videos of [four().slice(0, 3), four({ metrics: metrics({ averageWatchTimeMs: null }) }), four({ metrics: metrics({ averageWatchTimeMs: 18000 }) }), four({ reviewId: undefined })]) assert.equal(learning.instagramLearningGuidanceFromState(state(videos), 'source', now).attentionExperiment, undefined);
  cached = { ...cached, status: 'permission_required' }; assert.equal((await stock.getStockProductionGuidance()).attentionExperiment, undefined);
});

const recipeRows = (recipe, count, extra = {}) => Array.from({ length: count }, (_, i) => video(`${recipe}-${i}-${extra.timestamp || ''}`, { sequenceExperiment: recipe, ...extra }));
test('only explicit recipes become cohorts; tiny groups do not become winners or controls', () => {
  const result = summarize(state([...four(), ...recipeRows('focus-four-v1', 2)]), now);
  assert.equal(result.attentionCohorts.length, 1); assert.equal(result.attentionCohorts[0].videoCount, 2); assert.equal(result.attentionCohorts[0].comparable, false);
  assert.equal(result.attentionCohorts[0].winner, undefined);
  const noise = summarize(state(four({ metrics: metrics({ reach: 100, likes: 1, comments: 100, saves: 0, shares: 0 }) })), now);
  assert.ok(noise.assessments.every(row => row.label === 'typical'), 'Comments do not change strict engagement winner ranking');
});

test('cohorts compare only mature same-age same-exposure recipes; missing interaction rates stay unknown', () => {
  const focused = recipeRows('focus-four-v1', 3, { metrics: metrics({ comments: null, saves: null }) });
  const controls = recipeRows('montage-control-v1', 3);
  // Add matching availability peers so every recipe row meets the existing eligibility guards.
  const padding = Array.from({ length: 4 }, (_, i) => video(`padding-${i}`, { metrics: metrics({ comments: null, saves: null }) }));
  const result = summarize(state([...focused, ...controls, ...padding, video('control-peer')]), now);
  assert.equal(result.attentionCohorts.length, 2); assert.ok(result.attentionCohorts.every(row => row.comparable));
  const cohort = result.attentionCohorts.find(row => row.recipe === 'focus-four-v1');
  assert.equal(cohort.rates.comments.medianPer100, null); assert.equal(cohort.rates.comments.measuredCount, 0);
  assert.equal(cohort.rates.saves.medianPer100, null); assert.equal(cohort.rates.shares.medianPer100, 2);
  for (const extra of [{ timestamp: new Date(now - 8 * 24 * hour).toISOString() }, { metrics: metrics({ reach: null }) }]) {
    const separated = summarize(state([...recipeRows('focus-four-v1', 4), ...recipeRows('montage-control-v1', 4, extra)]), now);
    assert.ok(separated.attentionCohorts.every(row => !row.comparable));
  }
});

test('visible Insights diagnostic needs no extra control and preserves current interaction totals', () => {
  const data = { ...state(four()), summary: summarize(state(four()), now) };
  const jsx = (type, props) => ({ type, props }); let slot = 0;
  const component = load('src/components/InstagramPerformance.tsx', { react: { useState(initial) { return [slot++ === 0 ? data : typeof initial === 'function' ? initial() : initial, () => {}]; }, useRef: value => ({ current: value }), useCallback: value => value, useEffect() {} }, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' } }).default;
  const tree = component();
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value);
  const diagnosis = nodes(tree).find(node => node.props?.['aria-label'] === 'Watch diagnosis and next test');
  assert.ok(diagnosis); assert.match(text(diagnosis), /4 of 4.*3.0s.*20.0s.*15%/); assert.match(text(diagnosis), /Some eligible new Reels test four related shots/);
  assert.match(text(tree), /Comments: 4 · Saves: 0 · Shares: 8/);
  assert.equal(nodes(diagnosis).some(node => ['details', 'button', 'select', 'input'].includes(node.type)), false);
});

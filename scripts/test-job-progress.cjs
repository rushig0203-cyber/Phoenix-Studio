const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
const JobProgress = require('../src/components/JobProgress').default;
const render = props => renderToStaticMarkup(React.createElement(JobProgress, { label: 'Fixture job progress', ...props }));
test('visible progress represents actual queue values and clamps invalid bounds without exposing details', () => {
  for (const [progress, expected] of [[42.8, 42], [-10, 0], [150, 100], [0, 0]]) {
    const html = render({ progress }); assert.match(html, new RegExp(`value="${expected}"`)); assert.ok(html.includes(`${expected}%`));
  }
  const complete = render({ status: 'COMPLETED', progress: 19 }); assert.match(complete, /Completed/); assert.match(complete, /100%/);
  assert.doesNotMatch(complete, /<details|<section|stage|elapsed|error|height:.*px/);
});
test('preparation without measured progress is indeterminate, not a fabricated percentage', () => {
  for (const props of [{ status: 'PLANNING' }, { progress: NaN }, { progress: Infinity }]) {
    const html = render(props); assert.match(html, /<progress/); assert.doesNotMatch(html, /value="|\d+%/);
  }
  assert.match(render({ status: 'QUEUED' }), /0%/);
  const failed = render({ progress: 35, failed: true }); assert.match(failed, /Needs attention/); assert.match(failed, /35%/);
  assert.match(failed, /aria-label="Fixture job progress: Needs attention"/);
  const unmeasuredFailure = render({ status: 'FAILED' });
  assert.match(unmeasuredFailure, /value="0"/); assert.match(unmeasuredFailure, /aria-valuetext="Progress not measured"/);
  assert.doesNotMatch(unmeasuredFailure, /\d+%/, 'A failed unmeasured preparation does not animate or invent a completion figure');
});

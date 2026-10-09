const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/instagramLocationSuggestions.ts');
const moduleObject = { exports: {} };
new vm.Script(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename }).runInNewContext({ module: moduleObject, exports: moduleObject.exports, require() { throw new Error('Suggestions must remain local and dependency-free'); } });
const { instagramLocationSuggestions } = moduleObject.exports;
const file = (title = 'Quiet mountain trail', quality = {}) => ({ id: 'fixture-one', title, quality });
test('places are deterministic non-India choices, with Switzerland first and no claimed filming proof', () => {
  const result = instagramLocationSuggestions(file());
  assert.equal(result.places[0], 'Switzerland');
  assert.equal(result.places.length, 6);
  assert.equal(new Set(result.places).size, 6);
  assert.ok(!result.places.includes('India'));
  assert.deepEqual(Array.from(result.hints), []);
  assert.deepEqual(JSON.parse(JSON.stringify(instagramLocationSuggestions(file()))), JSON.parse(JSON.stringify(result)));
  assert.equal(result.verified, undefined);
});
test('explicit country mentions are separate unverified hints, not guessed from mountains or alps', () => {
  const result = instagramLocationSuggestions(file('Swiss mountains and Norway'));
  assert.deepEqual(Array.from(result.hints), ['Switzerland', 'Norway']);
  assert.ok(!result.places.some(place => result.hints.includes(place)));
  assert.deepEqual(Array.from(instagramLocationSuggestions(file('Mountains and Alps')).hints), []);
});
test('bounded visual observations supply hints but never acquire verified status', () => {
  const result = instagramLocationSuggestions(file('A calm landscape', { postingAnalysis: { observations: ['A path in Japan', 'An Iceland landscape', 'A beach in Italy', 'Australia fourth ignored'] } }));
  assert.deepEqual(Array.from(result.hints), ['Italy', 'Japan', 'Iceland']);
  assert.ok(!result.hints.includes('Australia'));
});
test('caption promises, links, countries inside words and India do not become location evidence', () => {
  const result = instagramLocationSuggestions(file('Indian trail with japanesque shapes', { postCopy: 'Filmed in Switzerland. https://example.org/Norway' }));
  assert.deepEqual(Array.from(result.hints), []);
});

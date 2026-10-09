// Pure production-helper tests: no media decode, model, provider or owner files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const project = path.resolve(__dirname, '..');
function functions(filename, names, context = {}) {
  const source = fs.readFileSync(path.join(project, filename), 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length, 'Load the actual named production functions.');
  const code = ts.transpileModule(selected.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleFixture = { exports: {} };
  vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, ...context });
  return moduleFixture.exports;
}
const gain = functions('src/lib/stockReel.ts', ['stockMusicMixGain']);
const audio = functions('src/lib/sourceProcessing.ts', ['stockReelMusicSections', 'stockReelMusicVolume'], gain);
const defaults = (() => {
  const filename = path.join(project, 'src/lib/automaticStockReel.ts'), source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleFixture = { exports: {} };
  vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, require: () => ({}) });
  return moduleFixture.exports;
})();
const intervals = [
  { outputStart: 0, outputEnd: 3 },
  { outputStart: 3, outputEnd: 7 },
  { outputStart: 7, outputEnd: 10 },
];
const states = [{ usable: true, mean: -65, max: -52 }, { usable: false, mean: -99, max: -99 }, { usable: true, mean: -20, max: -3 }];
function at(filter, t) {
  const expression = /^volume='(.*)':eval=frame$/.exec(filter)?.[1];
  assert.ok(expression, 'Use FFmpeg per-frame volume, not an all-reel gain.');
  return vm.runInNewContext(expression.replace(/\bif\(/g, 'choose('), {
    t, choose: (condition, yes, no) => condition ? yes : no,
    lt: (a, b) => a < b, gt: (a, b) => a > b,
    clip: (value, low, high) => Math.max(low, Math.min(high, value)),
  });
}
test('one quiet ambience interval does not suppress music throughout silent intervals', () => {
  const sections = audio.stockReelMusicSections(intervals, states, true);
  assert.ok(sections[0].gain > 0 && sections[0].gain < .003);
  assert.equal(sections[1].gain, 1);
  assert.equal(sections[2].gain, .28);
  const filter = audio.stockReelMusicVolume(sections);
  assert.equal(at(filter, 1), Number(sections[0].gain.toFixed(6)));
  assert.equal(at(filter, 5), 1, 'The silent middle has actual audible music, not the quietest-source gain.');
  assert.equal(at(filter, 9.9), .28, 'The final original interval keeps its own quieter bed.');
});
test('short gain ramps meet quietly at edits and never bury the quiet original interval', () => {
  const sections = audio.stockReelMusicSections(intervals, states, true), filter = audio.stockReelMusicVolume(sections);
  const quietGain = Number(sections[0].gain.toFixed(6));
  for (const time of [0, .1, 1, 2.8, 2.999999]) assert.ok(at(filter, time) <= quietGain + .000001);
  assert.ok(Math.abs(at(filter, 2.999999) - at(filter, 3)) < .000001);
  assert.ok(at(filter, 3.09) > quietGain && at(filter, 3.09) < 1);
  assert.ok(Math.abs(at(filter, 6.999999) - at(filter, 7)) < .00001);
  for (let time = 0; time < 10; time += .035) assert.ok(at(filter, time) >= 0 && at(filter, time) <= 1);
});
test('explicit music replacement and all-silent sources keep a full bed through the final section', () => {
  const sections = audio.stockReelMusicSections(intervals, states, false);
  assert.ok(sections.every(section => section.gain === 1 && !section.original));
  const filter = audio.stockReelMusicVolume(sections);
  for (const time of [0, 3, 6.99, 9.9, 10]) assert.equal(at(filter, time), 1);
  const silent = audio.stockReelMusicSections([{ outputStart: 0, outputEnd: 11 }], [{ usable: false, mean: -99, max: -99 }], true);
  assert.equal(at(audio.stockReelMusicVolume(silent), 10.8), 1);
});
test('new automatic policy keeps the same instrumental level across audible and silent source shots', () => {
  const options = defaults.automaticStockReelOptions('forest'), preserveOriginal = options.audio !== 'music';
  assert.equal(preserveOriginal, false);
  const sections = audio.stockReelMusicSections(intervals, states, preserveOriginal, options.audio === 'auto');
  assert.ok(sections.every(section => section.gain === 1 && !section.original));
  const filter = audio.stockReelMusicVolume(sections);
  for (const time of [0, 2.99, 3, 5, 6.99, 7, 9.99, 10]) assert.equal(at(filter, time), 1);
});
test('automatic sound fills only silent intervals and never adds music over usable original ambience', () => {
  const sections = audio.stockReelMusicSections(intervals, states, true, true), filter = audio.stockReelMusicVolume(sections);
  assert.deepEqual(Array.from(sections, section => section.gain), [0, 1, 0]);
  for (const time of [0, 1, 2.99, 7, 8, 9.99]) assert.equal(at(filter, time), 0);
  assert.equal(at(filter, 5), 1);
  assert.ok(at(filter, 3.09) > 0 && at(filter, 3.09) < 1);
  assert.ok(at(filter, 6.91) > 0 && at(filter, 6.91) < 1);
  const tail = audio.stockReelMusicSections([{ outputStart: 0, outputEnd: 3 }, { outputStart: 3, outputEnd: 11 }], [states[0], states[1]], true, true);
  assert.equal(at(audio.stockReelMusicVolume(tail), 10.8), 1, 'A final silent shot gets music through its actual end.');
});
test('short shots use bounded ramps and malformed intervals/measurements never become a guessed mix', () => {
  const short = audio.stockReelMusicSections([{ outputStart: 0, outputEnd: .05 }, { outputStart: .05, outputEnd: .1 }], [states[0], states[1]], true);
  assert.ok(Number.isFinite(at(audio.stockReelMusicVolume(short), .075)));
  assert.throws(() => audio.stockReelMusicSections(intervals, [], true), /one measured/);
  assert.throws(() => audio.stockReelMusicSections([{ outputStart: 1, outputEnd: 3 }], [states[0]], true), /contiguous/);
  assert.throws(() => audio.stockReelMusicSections([{ outputStart: 0, outputEnd: Infinity }], [states[0]], true), /contiguous/);
  assert.throws(() => audio.stockReelMusicSections([{ outputStart: 0, outputEnd: 3 }], [{ ...states[0], mean: NaN }], true), /finite sound/);
  assert.throws(() => audio.stockReelMusicVolume([{ start: 0, end: 3, gain: 2, original: false }]), /invalid/);
});

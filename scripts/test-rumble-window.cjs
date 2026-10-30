const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/lib/rumbleWindow.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function load(window) { const mod = { exports: {} }; new vm.Script(code).runInNewContext({ module: mod, exports: mod.exports, window }); return mod.exports; }
test('Phoenix reuses its upload tab without navigating away from an unfinished upload', () => {
  let opened = 0, focused = 0; const navigated = [];
  const tab = { closed: false, opener: 'unsafe', location: { href: 'about:blank', replace(url) { navigated.push(url); this.href = url; } }, focus() { focused++; } };
  const app = load({ open(url, target) { opened++; assert.equal(url, ''); assert.equal(target, 'phoenix-rumble-upload'); return tab; } });
  assert.equal(app.openRumbleUpload(), true); assert.equal(tab.opener, null);
  tab.location.href = 'https://rumble.com/upload?unfinished';
  assert.equal(app.openRumbleUpload(), true); assert.equal(opened, 1); assert.equal(focused, 2);
  assert.deepEqual(navigated, ['https://rumble.com/upload']);
  tab.closed = true; assert.equal(app.openRumbleUpload(), true); assert.equal(opened, 2);
});
test('an existing cross-origin named tab is focused, never overwritten, and blocked popups report failure', () => {
  let focused = 0;
  const tab = { closed: false, opener: null, get location() { throw new Error('Cross origin'); }, focus() { focused++; } };
  assert.equal(load({ open() { return tab; } }).openRumbleUpload(), true); assert.equal(focused, 1);
  assert.equal(load({ open() { return null; } }).openRumbleUpload(), false);
});

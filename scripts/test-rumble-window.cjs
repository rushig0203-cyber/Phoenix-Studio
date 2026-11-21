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

const click = (extra = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, prevented: false,
  preventDefault() { this.prevented = true; }, ...extra });

test('the shared dashboard link reuses its own tab without replacing an unfinished upload', () => {
  const opened = [], navigated = [], focused = [];
  const tabs = new Map();
  const app = load({ open(url, target) {
    assert.equal(url, ''); opened.push(target);
    const tab = { closed: false, opener: 'unsafe', location: { href: 'about:blank', replace(href) { this.href = href; navigated.push([target, href]); } }, focus() { focused.push(target); } };
    tabs.set(target, tab); return tab;
  } });
  assert.equal(app.openRumbleUpload(), true);
  tabs.get('phoenix-rumble-upload').location.href = 'https://rumble.com/upload?unfinished';
  const first = click(); app.rumbleDashboardLink.onClick(first); assert.equal(first.prevented, true);
  const second = click(); app.rumbleDashboardLink.onClick(second); assert.equal(second.prevented, true);
  assert.equal(app.openRumbleUpload(), true);
  assert.deepEqual(opened, ['phoenix-rumble-upload', 'phoenix-rumble-dashboard']);
  assert.deepEqual(navigated, [['phoenix-rumble-upload', 'https://rumble.com/upload'], ['phoenix-rumble-dashboard', 'https://rumble.com/account/dashboard']]);
  assert.deepEqual(focused, ['phoenix-rumble-upload', 'phoenix-rumble-dashboard', 'phoenix-rumble-dashboard', 'phoenix-rumble-upload']);
  assert.equal(tabs.get('phoenix-rumble-upload').location.href, 'https://rumble.com/upload?unfinished');
  assert.equal(tabs.get('phoenix-rumble-dashboard').opener, null);
});

test('dashboard modified clicks and popup failures leave the real safe link usable', () => {
  let opens = 0;
  const app = load({ open() { opens++; return null; } });
  for (const extra of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
    const event = click(extra); app.rumbleDashboardLink.onClick(event);
    assert.equal(event.prevented, false);
  }
  assert.equal(opens, 0);
  const event = click(); app.rumbleDashboardLink.onClick(event);
  assert.equal(opens, 1); assert.equal(event.prevented, false);
  assert.equal(app.rumbleDashboardLink.href, 'https://rumble.com/account/dashboard');
  assert.equal(app.rumbleDashboardLink.target, 'phoenix-rumble-dashboard');
  assert.equal(app.rumbleDashboardLink.rel, 'noopener noreferrer');
});

test('a separately recovered dashboard tab is only focused and a closed tab can reopen', () => {
  let opened = 0, focused = 0;
  const tab = { closed: false, opener: null, get location() { throw new Error('Cross origin'); }, focus() { focused++; } };
  const app = load({ open() { opened++; return tab; } });
  app.rumbleDashboardLink.onClick(click()); app.rumbleDashboardLink.onClick(click());
  assert.equal(opened, 1); assert.equal(focused, 2);
  tab.closed = true; app.rumbleDashboardLink.onClick(click()); assert.equal(opened, 2);
});

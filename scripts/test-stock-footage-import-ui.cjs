const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'src/components/StockFootageImport.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { fileName: 'StockFootageImport.tsx', compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : !tree || !tree.props ? [] : [tree, ...nodes(tree.props.children)]; }
const file = (name = 'forest.mp4', size = 1024) => ({ name, size, type: 'video/mp4', arrayBuffer() { throw new Error('Never buffer footage in RAM'); } });

// Execute the real component handlers against inert JSX and a mocked upload.
// No server, browser, provider, file decoding, credentials or timer waits.
function harness(options = {}) {
  const slots = [], effects = [], requests = [], started = [];
  let index = 0, dirty = true, tree, mounted = true, acquisitions = 0, releases = 0, uuid = 0;
  let disabled = !!options.disabled;
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = { './ui/button': { Button: 'button' }, 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {
    useState(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = initial; return [slots[at], value => { slots[at] = value; dirty = true; }]; },
    useRef(initial) { const at = index++; if (!Object.hasOwn(slots, at)) slots[at] = { current: initial }; return slots[at]; },
    useEffect(callback) { const at = index++; if (!effects[at]) effects[at] = { callback }; },
  } };
  class UploadRequest {
    constructor() { this.upload = {}; this.headers = {}; requests.push(this); }
    open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/api/stock/manual-import'); this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(body) { this.body = body; if (options.sendThrows) throw new Error('Fixture startup failure'); }
  }
  const mod = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module: mod, exports: mod.exports, URL, Error,
    crypto: { randomUUID() { return 'fixture-request-' + ++uuid; } }, XMLHttpRequest: UploadRequest,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), 'Unexpected import: ' + name); return dependencies[name]; },
  }, { timeout: 1000 });
  const Component = mod.exports.default;
  function render() {
    if (!mounted) return tree;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 30); dirty = false; index = 0;
      tree = Component({ disabled, acquire() { acquisitions++; return options.acquire !== false; }, release() { releases++; }, onStarted(message) { started.push(message); } });
      for (const effect of effects) if (effect && !effect.ran) { effect.ran = true; effect.cleanup = effect.callback(); }
    }
    return tree;
  }
  function find(predicate) { const found = nodes(tree).filter(predicate); assert.equal(found.length, 1); return found[0]; }
  const h = { requests, started, render, get tree() { return tree; }, get acquisitions() { return acquisitions; }, get releases() { return releases; },
    input(type) { return find(node => node.type === 'input' && node.props.type === type); },
    creator() { return find(node => node.type === 'input' && node.props.maxLength === 120); },
    provider(value) { find(node => node.type === 'select').props.onChange({ target: { value } }); render(); },
    setFile(selected = file()) { h.input('file').props.onChange({ target: { files: [selected] } }); render(); return selected; },
    setPage(value = 'https://mixkit.co/free-stock-video/forest-opening-123/') { h.input('url').props.onChange({ target: { value } }); render(); },
    setCreator(value) { h.creator().props.onChange({ target: { value } }); render(); },
    confirm() { h.input('checkbox').props.onChange({ target: { checked: true } }); render(); },
    submit() { find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    fill() { const selected = h.setFile(); h.setPage(); h.confirm(); return selected; },
    complete(status, data) { const request = requests.at(-1); request.status = status; request.responseText = typeof data === 'string' ? data : JSON.stringify(data); request.onload(); render(); },
    fail(kind = 'onerror') { requests.at(-1)[kind](); render(); },
    disable() { disabled = true; dirty = true; render(); },
    unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
  };
  render(); return h;
}

test('manual sources stay collapsed with accurate licence/automation limits and no preview downloads', () => {
  const h = harness();
  assert.equal(h.requests.length, 0);
  assert.ok(nodes(h.tree).some(node => node.type === 'details' && !node.props.open));
  assert.match(text(h.tree), /these websites are not searched automatically/);
  assert.match(text(h.tree), /one downloaded clip as a reel source/);
  assert.match(text(h.tree), /not a provider-verified API result/);
  assert.deepEqual(nodes(h.tree).filter(node => node.type === 'a').map(node => node.props.href), ['https://mixkit.co/free-stock-video/', 'https://dareful.com/']);
  assert.equal(nodes(h.tree).filter(node => ['video', 'audio', 'iframe'].includes(node.type)).length, 0);
});

test('missing, empty, unsupported and oversized files never acquire work or upload', () => {
  for (const selected of [null, file('empty.mp4', 0), file('bad.exe'), file('large.mp4', 500 * 1024 * 1024 + 1), file('a'.repeat(256) + '.mp4')]) {
    const h = harness(); if (selected) h.setFile(selected); h.setPage(); h.confirm(); h.submit();
    assert.equal(h.requests.length, 0); assert.equal(h.acquisitions, 0); assert.match(text(h.tree), /MP4, MOV, WebM or MKV/);
  }
});

test('a valid original source URL and explicit licence are required before acquisition', () => {
  for (const page of ['not a url', 'https://mixkit.co/', 'https://mixkit.co/free-stock-video/', 'https://mixkit.co/license/modal/videoFree/', 'https://mixkit.co/free-stock-video/nature/extra/', 'http://mixkit.co/clip/', 'https://mixkit.co.evil.example/clip/', 'https://dareful.com/clip/', 'https://user:pass@mixkit.co/clip/', 'https://mixkit.co:444/clip/']) {
    const h = harness(); h.setFile(); h.setPage(page); h.confirm(); h.submit(); assert.equal(h.requests.length, 0); assert.equal(h.acquisitions, 0);
  }
  const h = harness(); h.setFile(); h.setPage(); h.submit(); assert.equal(h.requests.length, 0); assert.match(text(h.tree), /not its Restricted licence/);
});

test('Dareful requires credited creator and CC BY 4.0 acknowledgement', () => {
  const h = harness(); h.provider('dareful'); h.setFile(); h.setPage('https://dareful.com/beach-ocean-waves/'); h.confirm(); h.submit();
  assert.equal(h.requests.length, 0); assert.match(text(h.tree), /credited creator/);
  h.setCreator('Joel Holland'); h.submit();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].headers['X-Phoenix-Stock-Provider'], 'dareful');
  assert.equal(h.requests[0].headers['X-Phoenix-Creator'], 'Joel%20Holland');
  assert.match(text(h.tree), /creator\/source credit, licence link and edit notice/);
  assert.match(text(h.tree), /captionless Stories require visible credits first/);
});

test('manual import metadata limits and Dareful clip paths match the server before sending a File', () => {
  const longTitle = harness(); longTitle.setFile(file('a'.repeat(220) + '.mp4')); longTitle.setPage(); longTitle.confirm(); longTitle.submit();
  assert.equal(decodeURIComponent(longTitle.requests[0].headers['X-Phoenix-Title']).length, 160);
  const longCredit = harness(); longCredit.fill(); longCredit.setCreator('b'.repeat(121)); longCredit.submit();
  assert.equal(longCredit.requests.length, 0); assert.match(text(longCredit.tree), /within 120 characters/);
  for (const page of ['https://dareful.com/about/', 'https://dareful.com/about-dareful-completely-free-4k-stock-video/', 'https://dareful.com/sitemap.xml', 'https://dareful.com/category/nature/', 'https://dareful.com/tag/nature/', 'https://dareful.com/privacy-policy/', 'https://dareful.com/terms/', 'https://dareful.com/videos/beach/']) {
    const h = harness(); h.provider('dareful'); h.setFile(); h.setPage(page); h.setCreator('Joel Holland'); h.confirm(); h.submit();
    assert.equal(h.requests.length, 0, page); assert.equal(h.acquisitions, 0);
  }
});

test('upload streams the actual File once with encoded metadata, same-origin endpoint and progress', () => {
  const h = harness(), selected = h.fill(); h.submit(); h.submit();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body, selected); assert.equal(h.acquisitions, 1);
  const headers = h.requests[0].headers;
  assert.equal(headers['X-Phoenix-Filename'], 'forest.mp4'); assert.equal(headers['X-Phoenix-Title'], 'forest');
  assert.equal(headers['X-Phoenix-Source-Page'], encodeURIComponent('https://mixkit.co/free-stock-video/forest-opening-123/'));
  assert.equal(headers['X-Phoenix-Licence-Confirmed'], 'true'); assert.equal(headers['Content-Type'], 'video/mp4');
  assert.equal(h.requests[0].timeout, 780_000);
  h.requests[0].upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 }); h.render(); assert.match(text(h.tree), /25%/);
  h.requests[0].upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 }); h.render(); assert.match(text(h.tree), /Checking the clip/);
  h.complete(201, { job: { id: 'saved-reel' }, message: 'Fixture queued' });
  assert.deepEqual(h.started, ['Fixture queued']); assert.equal(h.releases, 1); h.submit(); assert.equal(h.requests.length, 1);
});

test('errors, timeouts, invalid JSON and unconfirmed success retain the request ID for safe explicit retry', () => {
  for (const fail of [h => h.fail(), h => h.fail('ontimeout'), h => h.fail('onabort'), h => h.complete(503, { error: 'Fixture retry later' }), h => h.complete(200, '<html>'), h => h.complete(201, { message: 'Not saved' })]) {
    const h = harness(); h.fill(); h.submit(); const id = h.requests[0].headers['X-Phoenix-Request-Id']; fail(h);
    assert.equal(h.started.length, 0); assert.equal(h.releases, 1);
    h.submit(); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].headers['X-Phoenix-Request-Id'], id);
    h.complete(201, { job: { id: 'same-reel' } }); assert.equal(h.started.length, 1);
  }
});

test('external disabled state and authoritative parent lock prevent an overlapping automatic import', () => {
  const h = harness({ disabled: true }); h.fill(); h.submit(); assert.equal(h.acquisitions, 0); assert.equal(h.requests.length, 0);
  const guarded = harness({ acquire: false }); guarded.fill(); guarded.submit(); assert.equal(guarded.acquisitions, 1); assert.equal(guarded.requests.length, 0);
});

test('editing away and back before retry preserves the accepted-request identity, changed metadata does not', () => {
  const h = harness(); h.fill(); h.submit(); const first = h.requests[0].headers['X-Phoenix-Request-Id']; h.fail();
  h.setPage('https://mixkit.co/free-stock-video/different-456/'); h.setPage(); h.confirm(); h.submit();
  assert.equal(h.requests[1].headers['X-Phoenix-Request-Id'], first); h.fail();
  h.setCreator('A different credit'); h.submit();
  assert.notEqual(h.requests[2].headers['X-Phoenix-Request-Id'], first);
});

test('startup failure releases shared busy state and accepted upload after unmount sends no UI callback', () => {
  const broken = harness({ sendThrows: true }); broken.fill(); broken.submit(); assert.equal(broken.releases, 1); assert.equal(broken.started.length, 0);
  const h = harness(); h.fill(); h.submit(); h.unmount(); h.complete(201, { job: { id: 'accepted-after-unmount' } });
  assert.equal(h.started.length, 0); assert.equal(h.releases, 1); h.submit(); assert.equal(h.requests.length, 1);
});

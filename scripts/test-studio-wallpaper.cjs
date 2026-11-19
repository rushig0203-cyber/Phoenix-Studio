const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const project = path.resolve(__dirname, '..');
function compile(relativePath, dependencies, process) {
  const filename = path.join(project, relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, URL, Response, Uint8Array, process,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected wallpaper import: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

for (const artwork of ['wallpaper', 'logo']) test(artwork + ' reads its own bounded local JPEG and falls back for unsafe or missing images', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-wallpaper-'));
  const storage = path.join(root, 'storage');
  const directory = path.join(storage, 'ui');
  const filename = path.join(directory, 'studio-' + artwork + '.jpg');
  const otherFilename = path.join(directory, artwork === 'logo' ? 'studio-wallpaper.jpg' : 'studio-logo.jpg');
  fs.mkdirSync(directory, { recursive: true });
  const image = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]);
  fs.writeFileSync(otherFilename, image);
  t.after(() => {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.unlinkSync(otherFilename);
    for (const folder of [directory, storage, root]) fs.rmdirSync(folder);
  });

  const env = {};
  const localArtwork = compile('src/lib/studioArtwork.ts', {
    'node:fs/promises': require('node:fs/promises'),
    'node:path': path,
    '@/lib/localRequest': compile('src/lib/localRequest.ts', {}),
  }, { env, cwd: () => root });
  const { GET } = compile('src/app/api/studio-' + artwork + '/route.ts', { '@/lib/studioArtwork': localArtwork });
  const host = 'http://localhost:3000';
  const request = new Request(host + '/api/studio-' + artwork);
  assert.equal((await GET(request)).status, 204, 'a different image does not replace the missing asset');
  fs.writeFileSync(filename, Buffer.from('not an image'));
  assert.equal((await GET(request)).status, 204);
  fs.writeFileSync(filename, Buffer.alloc(512 * 1024 + 1));
  assert.equal((await GET(request)).status, 204, 'oversized images are declined');

  fs.writeFileSync(filename, image);
  const response = await GET(new Request(request.url + '?file=../../other.jpg'));
  assert.equal(response.status, 200, 'query cannot select a different file');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);

  assert.equal((await GET(new Request('https://studio.example/api/studio-' + artwork))).status, 204);
  assert.equal((await GET(new Request(request.url, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 204);
  assert.equal((await GET(new Request(request.url, { headers: { Origin: 'https://elsewhere.example' } }))).status, 204);
  env.VERCEL = '1';
  assert.equal((await GET(request)).status, 204, 'hosted execution falls back even if the loopback URL is presented');
});

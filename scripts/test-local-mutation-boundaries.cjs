const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Run actual route handlers with fake work functions: no owner files, process,
// credential, provider, model or renderer is opened by these boundary checks.
const project = path.resolve(__dirname, '..');
const id = '8b5c458d-f8e7-4dc8-b46a-30f1f901d001';
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(project, relative), mod = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new vm.Script(output, { filename }).runInNewContext({ module: mod, exports: mod.exports,
    URL, Request, Response, console, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
  }, { timeout: 1000 });
  return mod.exports;
}
const local = load('src/lib/localRequest.ts');
const formats = load('src/lib/publishingFormats.ts');
function harness() {
  const calls = [], generation = load('src/app/api/generations/route.ts', {
    'node:crypto': require('node:crypto'), 'next/server': { NextResponse: Response }, zod: require('zod'),
    '@/lib/localRequest': local, '@/lib/publishingFormats': formats,
    '@/lib/songAudio': {}, '@/lib/stockBrief': {}, '@/lib/localSinging': {},
    '@/lib/writingSettings': {}, '@/lib/newsResearch': {},
    '@/lib/jobHistory': { JobHistoryConflictError: class extends Error {} },
    '@/lib/generation': {
      removeGenerationJob: async value => { calls.push(['delete', value]); return { id: value, status: 'CANCELLED' }; },
      retryGenerationJob: async value => { calls.push(['retry', value]); return { id: value, status: 'QUEUED' }; },
      regenerateGenerationJob: async value => { calls.push(['regenerate', value]); return { id: value, status: 'QUEUED' }; },
    },
    '@/lib/creationDrafts': {
      DraftConflict: class extends Error {},
      createCreationDrafts: async inputs => { calls.push(['create', inputs[0].topic]); return [{ id, status: 'QUEUED' }]; },
    },
    '@/lib/kidsRenderer': { kidsRendererAvailable: async () => { calls.push(['renderer-check']); return true; } },
  });
  const song = load('src/app/api/song-audio/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/localRequest': local,
    '@/lib/songAudio': { stageSongAudio: async (body, filename) => { calls.push(['song', filename]); assert.ok(body); return { id, duration: 75 }; } },
  });
  const shortcut = load('src/app/api/review-files/shortcut/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/localRequest': local, 'node:util': require('node:util'),
    'node:child_process': { execFile: (...args) => { calls.push(['shortcut']); args.at(-1)(null, '', ''); } },
    '@/lib/reviewFiles': { ensureReviewFolders: async () => { calls.push(['folders']); }, reviewRoot: () => 'C:\\isolated-fixture\\reviews' },
  }, { process: { platform: 'win32', env: { USERPROFILE: 'C:\\isolated-fixture' } } });
  return { calls, generation, song, shortcut };
}
const cases = [
  ['creation', 'POST', '/api/generations', h => h.generation.POST],
  ['retry', 'PATCH', '/api/generations', h => h.generation.PATCH],
  ['delete', 'DELETE', `/api/generations?id=${id}`, h => h.generation.DELETE],
  ['song upload', 'POST', '/api/song-audio', h => h.song.POST],
  ['Desktop shortcut', 'POST', '/api/review-files/shortcut', h => h.shortcut.POST],
];
for (const [label, patch] of [
  ['missing origin', { headers: {} }],
  ['different origin', { headers: { origin: 'https://outside.example' } }],
  ['cross-site request', { headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' } }],
  ['nonlocal website', { base: 'https://phoenix.example', headers: { origin: 'https://phoenix.example' } }],
  ['mismatched Host', { headers: { origin: 'http://localhost:3000', host: 'outside.example' } }],
]) test(`${label} cannot consume input or start any retained local mutation`, async () => {
  const h = harness();
  for (const [name, method, endpoint, handler] of cases) {
    const request = new Request(`${patch.base || 'http://localhost:3000'}${endpoint}`, { method, headers: patch.headers });
    request.json = request.formData = request.arrayBuffer = () => assert.fail(`${name} consumed rejected input`);
    Object.defineProperty(request, 'body', { get() { assert.fail(`${name} opened a rejected upload stream`); } });
    const response = await handler(h)(request);
    assert.equal(response.status, 403, name);
    assert.deepEqual(h.calls, [], `${name} must reject before work`);
  }
});

test('same-origin creation, retry, regenerate and delete retain their existing workflow', async () => {
  const h = harness();
  const request = (method, body, query = '') => new Request(`http://localhost:3000/api/generations${query}`, {
    method, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let response = await h.generation.POST(request('POST', { topic: 'A bear shares a scarf', script: 'A bear shares a scarf with a cold friend.', duration: 75 }));
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).draftIds, [id]);
  response = await h.generation.PATCH(request('PATCH', { id }));
  assert.equal(response.status, 200);
  response = await h.generation.PATCH(request('PATCH', { id, regenerate: true }));
  assert.equal(response.status, 200);
  response = await h.generation.DELETE(request('DELETE', undefined, `?id=${id}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).filesRetained, true);
  assert.deepEqual(h.calls, [['renderer-check'], ['create', 'A bear shares a scarf'], ['retry', id], ['regenerate', id], ['delete', id]]);
});

test('same-origin song upload passes its raw stream to existing bounded staging', async () => {
  const h = harness();
  const response = await h.song.POST(new Request('http://127.0.0.1:3000/api/song-audio', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3000', 'x-phoenix-filename': 'Original%20song.wav' }, body: 'fixture',
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls, [['song', 'Original song.wav']]);
});

test('same-origin Desktop shortcut keeps the existing native creation path', async () => {
  const h = harness();
  const response = await h.shortcut.POST(new Request('http://localhost:3000/api/review-files/shortcut', {
    method: 'POST', headers: { origin: 'http://localhost:3000' },
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).created, true);
  assert.deepEqual(h.calls, [['folders'], ['shortcut']]);
});

test('trusted requests still reject invalid jobs and oversized song uploads without starting work', async () => {
  const h = harness(), origin = 'http://localhost:3000';
  assert.equal((await h.generation.DELETE(new Request(`${origin}/api/generations?id=invalid`, { method: 'DELETE', headers: { origin } }))).status, 400);
  assert.equal((await h.generation.PATCH(new Request(`${origin}/api/generations`, { method: 'PATCH', headers: { origin }, body: '{}' }))).status, 400);
  assert.equal((await h.song.POST(new Request(`${origin}/api/song-audio`, { method: 'POST', headers: { origin, 'content-length': String(100 * 1024 * 1024 + 1) } }))).status, 413);
  assert.deepEqual(h.calls, []);
});

test('legacy archives retain their reads but no longer expose destructive or fake-saving mutations', async () => {
  const saved = { id, title: 'Archived project', originalVideoUrl: 'https://videos.pexels.com/fixture.mp4', sourceBytes: 123n,
    sourceProvider: 'moneyprinterturbo', versions: [], generationJob: { socialCopyJson: '{"caption":"Archived copy"}' } };
  const db = {
    project: { findFirst: async () => saved },
    user: { findMany: async () => [{ id: 'owner', name: 'Studio owner', role: 'ADMIN' }] },
    stockMediaUse: { findMany: async () => [{ provider: 'pexels', mediaId: '42' }] },
  };
  const dependencies = {
    'next/server': { NextResponse: Response }, '@/lib/db': { db },
    '@/lib/session': { requireUserId: async () => 'owner', isUnauthorized: () => false },
    '@/lib/localProjects': { getLocalProject: () => undefined },
  };
  for (const [relative, expected] of [
    ['src/app/api/projects/[id]/route.ts', { url: saved.originalVideoUrl }],
    ['src/app/api/projects/[id]/timeline/route.ts', {}],
    ['src/app/api/projects/[id]/review/route.ts', { caption: 'Archived copy' }],
    ['src/app/api/admin/users/route.ts', [{ id: 'owner', name: 'Studio owner', role: 'ADMIN' }]],
    ['src/app/api/stock/used/route.ts', { keys: ['pexels:42'] }],
  ]) {
    const archive = load(relative, dependencies);
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) assert.equal(archive[method], undefined, `${relative} ${method}`);
    const response = await archive.GET(new Request('http://localhost:3000/api/fixture'), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, relative);
    const data = await response.json();
    assert.deepEqual(relative.endsWith('/review/route.ts') ? data.socialCopy : data, expected, relative);
  }
  assert.equal(fs.existsSync(path.join(project, 'src/app/api/stock/import/route.ts')), false);
});

test('legacy owner lookup reads an existing account without implicitly creating or modifying one', async () => {
  for (const configured of [undefined, 'saved-owner-id']) {
    const expected = configured || 'auraclip-owner', calls = [];
    const session = load('src/lib/session.ts', { '@/lib/db': { db: { user: {
      findUnique: async query => { calls.push(JSON.parse(JSON.stringify(query))); return { id: expected }; },
      upsert: () => assert.fail('Archive reads must not create an owner'),
    } } } }, { process: { env: configured ? { AURACLIP_OWNER_ID: configured } : {} } });
    assert.equal(await session.requireUserId(), expected);
    assert.deepEqual(calls, [{ where: { id: expected }, select: { id: true } }]);
    assert.equal(session.isUnauthorized(new Error('Database unavailable')), false);
  }
});

test('a missing archived owner fails actionably instead of inventing a successful account or login', async () => {
  let reads = 0;
  const session = load('src/lib/session.ts', { '@/lib/db': { db: { user: {
    findUnique: async () => { reads++; return null; },
    upsert: () => assert.fail('Missing owner must not be created implicitly'),
  } } } }, { process: { env: {} } });
  await assert.rejects(session.requireUserId(), /Legacy archive unavailable: configure AURACLIP_OWNER_ID.*Current local videos and jobs are unaffected/);
  assert.equal(reads, 1);
});

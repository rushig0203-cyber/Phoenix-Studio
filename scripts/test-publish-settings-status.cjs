const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { z } = require('zod');

function route(channels, saved = {}, unauthorized = false) {
  const calls = [];
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/app/api/settings/publish/route.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports, URL, require(name) {
      if (name === 'next/server') return { NextResponse: { json: Response.json } };
      if (name === 'zod') return { z };
      if (name === '@/lib/session') return {
        requireUserId: async () => { if (unauthorized) throw new Error('unauthorized'); return 'owner'; },
        isUnauthorized: error => error.message === 'unauthorized',
      };
      if (name === '@/lib/channelConnections') return { listChannels: async origin => { calls.push({ origin }); return channels; } };
      if (name === '@/lib/db') return { db: { publishSettings: {
        findUnique: async () => saved,
        upsert: async input => { calls.push(input); return { ...saved, ...input.update }; },
      } } };
      throw new Error('Forbidden dependency: ' + name);
    },
  });
  return { exports, calls };
}

test('legacy preferences reports encrypted-channel identity and uploading permission separately, never old token fields', async () => {
  const app = route([{ platform: 'youtube', connected: true, publishReady: false }, { platform: 'instagram', connected: true, publishReady: true }],
    { youtubeAccessToken: 'PRIVATE_OLD_TOKEN', instagramToken: 'PRIVATE_TOKEN', aiTone: 'balanced' });
  const response = await app.exports.GET(new Request('http://localhost:3000/api/settings/publish'));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.youtubeConnected, true); assert.equal(data.youtubePublishReady, false);
  assert.equal(data.instagramConnected, true); assert.equal(data.instagramPublishReady, true);
  assert.equal(data.aiTone, 'balanced'); assert.doesNotMatch(JSON.stringify(data), /PRIVATE|Token|instagramToken/);
  assert.deepEqual(app.calls, [{ origin: 'http://localhost:3000' }]);
});

test('preferences cannot set channel connection status or save pasted tokens through their generic form', async () => {
  const app = route([{ platform: 'youtube', connected: false, publishReady: false }]);
  const response = await app.exports.POST(new Request('http://localhost:3000/api/settings/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiTone: 'professional', youtubeConnected: true, youtubeAccessToken: 'PRIVATE_TOKEN' }),
  }));
  const data = await response.json();
  assert.equal(data.youtubeConnected, false); assert.equal(data.aiTone, 'professional');
  assert.doesNotMatch(JSON.stringify(app.calls), /PRIVATE_TOKEN|youtubeConnected|youtubeAccessToken/);
});

test('unauthenticated preferences cannot inspect channel settings', async () => {
  const app = route([], {}, true);
  const response = await app.exports.GET(new Request('http://localhost:3000/api/settings/publish'));
  assert.equal(response.status, 401); assert.equal(app.calls.length, 0);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-hosted-song-'));
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
process.chdir(temporary);
const audio = require(path.join(project, 'src/lib/songAudio.ts'));
const singing = require(path.join(project, 'src/lib/hostedSinging.ts'));
const realFetch = global.fetch, realStage = audio.stageSongAudio;
const id = 'a'.repeat(32), origin = singing.HOSTED_SINGING_ORIGIN;
const file = { path: `/tmp/gradio/${'b'.repeat(64)}/song.mp3`, url: `${origin}/gradio_api/file=/tmp/gradio/${'b'.repeat(64)}/song.mp3`, meta: { _type: 'gradio.FileData' }, is_stream: false };
const input = extra => {
  const value = { lyrics: 'Tiny stars above the tree. Glow and dance for you and me.', style: 'Warm acoustic nursery melody', language: 'English', duration: 20, consent: true, ...extra };
  if ((value.taskId || value.submissionStarted) && !Object.hasOwn(extra || {}, 'requestFingerprint')) value.requestFingerprint = singing.hostedSongFingerprint(value);
  return value;
};
const schema = () => ({ named_endpoints: { '/__call__': { parameters: ['audio_duration', 'prompt', 'lyrics', 'infer_step', 'guidance_scale', 'scheduler_type', 'cfg_type', 'omega_scale', 'manual_seeds', 'guidance_interval', 'guidance_interval_decay', 'min_guidance_scale', 'use_erg_tag', 'use_erg_lyric', 'use_erg_diffusion', 'oss_steps', 'guidance_scale_text', 'guidance_scale_lyric', 'audio2audio_enable', 'ref_audio_strength', 'ref_audio_input', 'lora_name_or_path'].map(parameter_name => ({ parameter_name })), returns: [{ label: 'Text2Music Generated Audio 1' }] } } });
function expectedSchema() {
  const result = schema();
  for (const [index, label] of Object.entries({ 0: 'Audio Duration', 1: 'Tags', 2: 'Lyrics', 18: 'Enable Audio2Audio', 20: 'Reference Audio (for Audio2Audio)' })) result.named_endpoints['/__call__'].parameters[index].label = label;
  return result;
}
const output = extra => [extra || file, { task: 'text2music', lyrics: input().lyrics, audio2audio_enable: false, ref_audio_input: null }];
const events = (kind, value) => `event: ${kind}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const stream = text => new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
let calls, saved, staged;
beforeEach(() => {
  calls = []; saved = []; staged = 0;
  audio.stageSongAudio = async (body, name, source) => {
    staged++; assert.equal(await new Response(body).text(), 'actual-audio-fixture'); assert.equal(source, 'hosted-ace'); assert.match(name, /mp3$/);
    return { id: 'staged-song', duration: 20 };
  };
  global.fetch = async (value, options = {}) => {
    const url = new URL(value); calls.push({ url, options });
    assert.equal(url.origin, origin); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers?.Authorization, undefined, 'Free anonymous mode sends no credentials');
    if (url.pathname === '/gradio_api/info') return Response.json(expectedSchema());
    if (url.pathname === '/gradio_api/call/__call__') return Response.json({ event_id: id });
    if (url.pathname.endsWith(`/${id}`)) return new Response(stream(events('heartbeat', null) + events('generating', output()) + events('complete', output())));
    if (url.pathname.startsWith('/gradio_api/file=')) return new Response('actual-audio-fixture');
    assert.fail(`Unexpected request ${url.pathname}`);
  };
});
after(() => { global.fetch = realFetch; audio.stageSongAudio = realStage; process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });
const save = async change => { saved.push(change); };

test('hosted singing uses exact documented schema, one song, original lyrics and English/Hindi without media uploads', () => {
  singing.assertHostedSongSchema(expectedSchema());
  const song = singing.hostedSongPayload(input({ language: 'Hindi', lyrics: 'चमको तारे चमको प्यारे' }));
  assert.equal(song.data.length, 22); assert.equal(song.data[0], 20); assert.match(song.data[1], /^Hindi vocals\./);
  assert.equal(song.data[2], 'चमको तारे चमको प्यारे'); assert.equal(song.data[3], 60);
  assert.equal(song.data[18], false); assert.equal(song.data[20], null); assert.equal(song.data[21], 'none');
  assert.match(singing.hostedSongPayload(input()).data[1], /^English vocals\./);
  assert.match(singing.hostedSongPayload(input({ language: undefined, lyrics: 'चमको तारे' })).data[1], /^Hindi vocals\./);
  assert.throws(() => singing.hostedSongPayload(input({ consent: false })), /Allow sending/);
  assert.throws(() => singing.hostedSongPayload(input({ duration: 211 })), /duration/);
  const changed = expectedSchema(); changed.named_endpoints['/__call__'].parameters[2].label = 'Upload a file';
  assert.throws(() => singing.assertHostedSongSchema(changed), /API changed/);
});

test('completed hosted task streams actual audio only after completion and saves its durable ID before polling', async () => {
  assert.equal((await singing.prepareHostedSong(input(), save)).id, 'staged-song');
  assert.equal(staged, 1); assert.equal(saved[0].songSubmissionStarted, true); assert.equal(saved[1].songTaskId, id);
  assert.deepEqual(calls.map(call => call.url.pathname), ['/gradio_api/info', '/gradio_api/call/__call__', `/gradio_api/call/__call__/${id}`, new URL(file.url).pathname]);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
});

test('known hosted task resumes without schema check or duplicate POST', async () => {
  await singing.prepareHostedSong(input({ taskId: id, submissionStarted: true }), save);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => !call.options.method)); assert.equal(staged, 1);
});

test('retained task and completed output are bound to exact lyrics, musical style, language and duration', async () => {
  for (const change of [{ lyrics: 'Different lyrics' }, { style: 'Different arrangement' }, { language: 'Hindi' }, { duration: 21 }]) {
    const original = input({ taskId: id, output: { ...file } });
    await assert.rejects(singing.prepareHostedSong({ ...original, ...change }, save), /does not match/);
  }
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id, requestFingerprint: undefined }), save), /does not match/);
  assert.equal(calls.length, 0); assert.equal(staged, 0);
});

test('a completed song checkpoints its validated file so download retry needs no consumed event stream', async () => {
  await singing.prepareHostedSong(input({ taskId: id }), save);
  const completed = saved.find(change => change.songOutput)?.songOutput;
  assert.deepEqual(completed, { path: file.path, url: file.url, is_stream: false });
  calls.length = 0;
  await singing.prepareHostedSong(input({ taskId: id, output: completed }), save);
  assert.equal(calls.length, 1); assert.equal(calls[0].url.href, file.url);
});

test('missing consent and uncertain submissions make no request', async () => {
  await assert.rejects(singing.prepareHostedSong(input({ consent: false }), save), /Allow sending/);
  await assert.rejects(singing.prepareHostedSong(input({ submissionStarted: true }), save), /uncertain/);
  await assert.rejects(singing.prepareHostedSong(input({ taskId: '../../other' }), save), /task is invalid/);
  assert.equal(calls.length, 0); assert.equal(saved.length, 0);
});

test('changed remote schema blocks before submission and retains no false acceptance', async () => {
  global.fetch = async () => Response.json(schema());
  await assert.rejects(singing.prepareHostedSong(input(), save), /API changed/);
  assert.equal(saved.length, 0); assert.equal(staged, 0);
});

test('free quota rejection waits without payment or an uncertain duplicate', async () => {
  const baseFetch = global.fetch;
  global.fetch = async (url, options) => options?.method === 'POST' ? new Response('Quota exceeded', { status: 429 }) : baseFetch(url, options);
  await assert.rejects(singing.prepareHostedSong(input(), save), error => error instanceof singing.HostedSingingWaitError && error.retryAfterMs === 86400000);
  assert.equal(saved.at(-1).songSubmissionStarted, false); assert.equal(staged, 0);
});

test('definitive GPU-quota error clears only its rejected task so a later free retry can submit', async () => {
  global.fetch = async () => new Response(stream(events('error', 'You have exceeded your GPU quota.')));
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), singing.HostedSingingWaitError);
  assert.deepEqual(saved, [{ songTaskId: undefined, songSubmissionStarted: false, songRequestFingerprint: undefined }]); assert.equal(staged, 0);
});

test('rate-limited status retains known event ID instead of treating the job as rejected', async () => {
  global.fetch = async () => new Response('Too many requests', { status: 429 });
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), singing.HostedSingingWaitError);
  assert.deepEqual(saved, []); assert.equal(staged, 0);
});

test('only a provider terminal error marks a song replaceable by explicit owner retry', async () => {
  global.fetch = async () => new Response(stream(events('error', null)));
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), /could not generate/);
  assert.deepEqual(saved, [{ songTaskFailed: true }]); assert.equal(staged, 0);
  saved.length = 0;
  global.fetch = async () => new Response('Provider unavailable', { status: 500 });
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), /task is retained/);
  assert.deepEqual(saved, [], 'Uncertain status must not authorize another submission');
});

test('an invalid acceptance is retained as uncertain rather than resubmitted', async () => {
  const baseFetch = global.fetch;
  global.fetch = async (url, options) => options?.method === 'POST' ? Response.json({ event_id: 'not-valid' }) : baseFetch(url, options);
  await assert.rejects(singing.prepareHostedSong(input(), save), /uncertain submission/);
  assert.equal(saved.length, 1); assert.equal(saved[0].songSubmissionStarted, true); assert.equal(staged, 0);
});

test('remote downloads reject foreign hosts, traversal, mismatched files and streaming metadata', () => {
  assert.equal(singing.hostedSongDownload(file).origin, origin);
  for (const change of [ { url: 'https://other.example/gradio_api/file=audio.mp3' }, { url: `${file.url}?token=secret` }, { path: '/etc/passwd' }, { path: '/tmp/gradio/../private.mp3', url: `${origin}/gradio_api/file=/tmp/gradio/../private.mp3` }, { is_stream: true } ]) assert.throws(() => singing.hostedSongDownload({ ...file, ...change }), /unsafe|invalid/);
});

test('malformed or missing audio completion and oversized status cannot become a song', async () => {
  for (const value of [[], [file, file], ['speech-only'], {}]) {
    global.fetch = async () => new Response(stream(events('complete', value)));
    await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save));
  }
  global.fetch = async () => new Response('x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), /safe response limit/); assert.equal(staged, 0);
});

test('download size is checked before staging without buffering its body', async () => {
  const baseFetch = global.fetch;
  global.fetch = async (url, options) => new URL(url).pathname.startsWith('/gradio_api/file=') ? new Response('not read', { headers: { 'content-length': String(101 * 1024 * 1024) } }) : baseFetch(url, options);
  await assert.rejects(singing.prepareHostedSong(input({ taskId: id }), save), /100 MB/); assert.equal(staged, 0);
});

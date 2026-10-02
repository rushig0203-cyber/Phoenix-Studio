const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { test, after, mock } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-stock-reel-quality-'));
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(temporary);
const planning = require(path.join(project, 'src/lib/stockReel.ts'));
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const stock = require(path.join(project, 'src/lib/naturalStock.ts'));

after(() => {
  mock.restoreAll(); process.chdir(project);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('phoenix-stock-reel-quality-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('six-shot caps retain the chosen endings, order and exact cumulative frame budget', () => {
  const shots = Array.from({ length: 6 }, (_, index) => ({ duration: 30, start: index, end: index + 20 }));
  for (const cap of [45, 60, 75, 90, 105]) {
    const plan = planning.planStockIntervals(shots, cap);
    assert.equal(plan.length, 6);
    assert.equal(plan.reduce((sum, shot) => sum + shot.frames, 0), cap * 24);
    assert.equal(plan.at(-1).outputEnd, cap);
    plan.forEach((shot, index) => { assert.equal(shot.end, shots[index].end); assert.ok(shot.start >= shots[index].start); assert.equal(shot.outputStart, index ? plan[index - 1].outputEnd : 0); });
  }
});

test('short selected moments remain short and invalid trim ranges never become filler', () => {
  const plan = planning.planStockIntervals([{ duration: 20, start: 8, end: 11 }, { duration: 10, start: 2, end: 6 }], 105);
  assert.equal(plan.at(-1).outputEnd, 7); assert.equal(plan[0].start, 8); assert.equal(plan[1].end, 6);
  assert.throws(() => planning.planStockIntervals([{ duration: 3, start: 2, end: 6 }], 60), /outside/);
  assert.throws(() => planning.planStockIntervals([{ duration: 3, start: 3, end: 3 }], 60), /outside/);
  assert.throws(() => planning.planStockIntervals(Array.from({ length: 7 }, () => ({ duration: 3 })), 60), /one to six/);
});

test('portrait framing fills only when at least 92 percent survives, landscape retains its full picture', () => {
  assert.match(planning.stockFraming({ width: 1080, height: 1920 }).filter, /crop=720:1280/);
  assert.doesNotMatch(planning.stockFraming({ width: 1920, height: 1080 }).filter, /crop=/);
  assert.match(planning.stockFraming({ width: 1920, height: 1080 }).description, /Entire source picture/);
  assert.doesNotMatch(planning.stockFraming({ width: 1080, height: 1920 }, 'fit').filter, /crop=/);
  const ranked = stock.portraitFirstStock([{ id: 1, provider: 'pixabay', width: 1920, height: 1080 }, { id: 2, provider: 'pexels', width: 720, height: 1280 }, { id: 2, provider: 'pexels', width: 720, height: 1280 }]);
  assert.deepEqual(ranked.map(video => video.id), [2, 1]);
});

test('quiet real ambience is preserved conservatively instead of classified as failed audio', () => {
  assert.equal(planning.stockAudioUsable(true, -65, -52), true);
  assert.equal(planning.stockAudioUsable(true, -99, -99), false);
  assert.equal(planning.stockAudioUsable(false, -15, -1), false);
  assert.equal(planning.stockAudioUsable(true, -Infinity, -Infinity), false);
  assert.ok(planning.stockMusicMixGain([-65, -20]) < .003, 'A quiet stream remains above the instrumental bed');
});

test('local instrumentals vary by reel and mood, have gentle ends, and stay under 4 MB at 105 seconds', () => {
  const reflective = planning.stockMusicWav(2, 'reflective', 'one-reel');
  assert.deepEqual(reflective, planning.stockMusicWav(2, 'reflective', 'one-reel'));
  assert.notDeepEqual(reflective, planning.stockMusicWav(2, 'reflective', 'other-reel'));
  assert.notDeepEqual(reflective, planning.stockMusicWav(2, 'warm', 'one-reel'));
  assert.equal(reflective.toString('ascii', 0, 4), 'RIFF');
  assert.equal(reflective.readInt16LE(44), 0);
  let peak = 0; for (let index = 44; index < reflective.length; index += 2) peak = Math.max(peak, Math.abs(reflective.readInt16LE(index)));
  assert.ok(peak > 100 && peak < 16000);
  assert.ok(planning.stockMusicWav(105, 'journey', 'bounded').length < 4 * 1024 * 1024);
  assert.throws(() => planning.stockMusicWav(107, 'warm', 'bounded'), /bounded/);
});

const reelInput = () => ({ requestId: crypto.randomUUID(), caption: '', theme: 'forest stream', maxDuration: 60, options: { audio: 'ambience-music', mood: 'warm', transition: 'soft', framing: 'auto' } });
const download = (number, open) => ({ provider: number === 1 ? 'pexels' : 'pixabay', mediaId: String(number), title: `Forest stream shot ${number}`, creator: `Fixture ${number}`, sourcePage: number === 1 ? 'https://www.pexels.com/video/forest-stream-1/' : 'https://pixabay.com/videos/forest-stream-2/', start: 0, end: 2, open });

test('stock downloads share one disk budget, are sequential, and duplicate request IDs never open new streams', async () => {
  let active = 0, maximum = 0, opens = 0;
  const open = async () => {
    opens += 1; active += 1; maximum = Math.max(maximum, active);
    const stream = new ReadableStream({ async start(controller) { await new Promise(resolve => setImmediate(resolve)); controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close(); active -= 1; } });
    return { stream, expectedBytes: 4 };
  };
  const input = reelInput(), downloads = [download(1, open), download(2, open)];
  const job = await source.createStockReelJob(downloads, input);
  assert.equal(job.stockSource.shots.length, 2); assert.equal(maximum, 1); assert.equal(opens, 2);
  assert.deepEqual(fs.readFileSync(reviews.sourcePath(job.id, job.stockSource.shots[1].sourceFile)), Buffer.from([1, 2, 3, 4]));
  assert.equal((await source.createStockReelJob(downloads, input)).id, job.id); assert.equal(opens, 2);
  // This job is only a download fixture. Keep it out of the later mocked processor test.
  await source.updateJob(job.id, { status: 'CANCELLED' });
});

test('an aggregate-budget or interrupted-stream failure removes only this request staging files', async () => {
  const folder = path.dirname(reviews.sourcePath('fixture', 'shot.mp4'));
  const before = fs.readdirSync(folder).sort(); let cancelled = false;
  const first = download(1, async () => ({ stream: Readable.toWeb(Readable.from(Buffer.from('first'))), expectedBytes: 5 }));
  const oversized = download(2, async () => ({ stream: new ReadableStream({ cancel() { cancelled = true; } }), expectedBytes: planning.MAX_STOCK_REEL_BYTES }));
  await assert.rejects(source.createStockReelJob([first, oversized], reelInput()), /shared 500 MB/);
  assert.equal(cancelled, true); assert.deepEqual(fs.readdirSync(folder).sort(), before);
  const interrupted = download(2, async () => ({ stream: Readable.toWeb(Readable.from(Buffer.from('short'))), expectedBytes: 40 }));
  await assert.rejects(source.createStockReelJob([first, interrupted], reelInput()), /interrupted/);
  assert.deepEqual(fs.readdirSync(folder).sort(), before);
});

test('selected-interval reel assembly retains quiet sound, credits and clean editable media, with no title overlay; retry reuses output', async t => {
  const calls = []; let encoding = 0, maxEncoding = 0, encodes = 0;
  const spawn = mock.method(require('node:child_process'), 'spawn', (command, args, options = {}) => {
    calls.push({ command, args });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    const isEncode = !args.includes('-show_entries') && typeof args.at(-1) === 'string' && args.at(-1).endsWith('.mp4');
    if (isEncode) { encoding += 1; encodes += 1; maxEncoding = Math.max(maxEncoding, encoding); }
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        const filename = path.basename(args.at(-1)), original = /-shot-[12]-/.test(filename);
        child.stdout.end(JSON.stringify({ format: { duration: original ? '2' : '4' }, streams: [{ codec_type: 'video', width: original ? 360 : 720, height: original ? 640 : 1280 }, { codec_type: 'audio' }] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: false, modelCached: false, detail: 'No model in isolated fixture.' }));
      else if (args.includes('volumedetect')) {
        const filename = args[args.indexOf('-i') + 1];
        child.stderr.end(filename.includes('shot-1-') ? 'mean_volume: -65.0 dB\nmax_volume: -52.0 dB\n' : 'mean_volume: -99.0 dB\nmax_volume: -99.0 dB\n');
      } else {
        if (isEncode) {
          const output = path.resolve(options.cwd || temporary, args.at(-1));
          assert.ok(output.startsWith(temporary + path.sep)); fs.writeFileSync(output, Buffer.alloc(4096)); encoding -= 1;
        }
        child.stdout.end('fixture tool version\nout_time=00:00:04.000\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const slot = mock.method(resources, 'withLocalRenderSlot', operation => operation());
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const input = reelInput(), open = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 });
  const job = await source.createStockReelJob([download(1, open), download(2, open)], input);
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  assert.equal(file.quality.audio, 'natural-audio-preserved'); assert.equal(file.quality.captions.length, 0); assert.equal(file.quality.subtitles.decision, 'uncertain');
  assert.equal(file.quality.visualSources.length, 2); assert.equal(file.quality.visualSources[0].provider, 'pexels'); assert.match(file.quality.postCopy, /https:\/\/pixabay.com\/videos\/forest-stream-2/);
  assert.ok(file.quality.checks.some(check => /original retained \(-65.0/.test(check)));
  assert.equal(file.artifacts.editing.captionsBaked, false); assert.match(file.artifacts.editing.video, /editable-master/); assert.match(file.artifacts.original, /original-assembly/);
  assert.equal(maxEncoding, 1, 'Encoding stays sequential');
  assert.ok(calls.some(call => call.args.some(arg => typeof arg === 'string' && arg.includes('amix=inputs=2'))));
  assert.ok(!calls.some(call => call.args.some(arg => typeof arg === 'string' && /drawtext=|ass=captions/.test(arg))), 'No speech means neither captions nor a posting title overlay');
  assert.ok(!calls.some(call => call.args.includes('--input')), 'An unavailable cached model does not trigger transcription or a model download');
  const finalEncode = calls.find(call => call.args.at(-1)?.includes('.partial-') && call.args.at(-1)?.endsWith('.mp4'));
  assert.equal(finalEncode.args[finalEncode.args.indexOf('-frames:v') + 1], '96');
  file.quality.postCopy = 'Posting copy checked for this specific output.'; file.quality.hashtags = ['#ForestStream'];
  await reviews.saveReviewFile(file);
  const before = encodes;
  await source.updateJob(job.id, { status: 'FAILED', error: 'isolated interruption after final persistence' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  assert.equal(encodes, before, 'Verified finished outputs are reused before per-shot encoding');
  assert.equal((await reviews.getReviewFile(file.id)).quality.postCopy, file.quality.postCopy);
  assert.equal((await source.getSourceJob(job.id)).status, 'COMPLETED');
});

test('stock API rejects impossible intervals before downloading and resolves every provider ID itself', async t => {
  const originalFetch = global.fetch; let opened = 0, queued;
  global.fetch = async () => { opened += 1; throw new Error('No media should download in this validation fixture'); };
  const mocks = [mock.method(source, 'findStockSourceJob', async () => null), mock.method(source, 'ffmpegAvailable', async () => true), mock.method(stock, 'resolveNaturalStock', async (provider, id) => ({ id, provider, duration: 12, width: 720, height: 1280, title: 'Actual source title', creator: 'Actual source creator', sourcePage: provider === 'pexels' ? 'https://www.pexels.com/video/forest-1/' : 'https://pixabay.com/videos/forest-2/', previewUrl: provider === 'pexels' ? 'https://videos.pexels.com/video-files/1/720.mp4' : 'https://cdn.pixabay.com/video/2.mp4' })), mock.method(source, 'createStockReelJob', async (downloads, input) => { queued = { downloads, input }; return { id: 'isolated-job' }; })];
  t.after(() => { mocks.forEach(item => item.mock.restore()); global.fetch = originalFetch; });
  const api = require(path.join(project, 'src/app/api/stock-reels/route.ts'));
  const request = body => new Request('http://localhost:3000/api/stock-reels', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { requestId: crypto.randomUUID(), caption: '', duration: 60, theme: 'forest stream', shots: [{ provider: 'pexels', id: 1, start: 4, end: 8 }, { provider: 'pixabay', id: 2, start: 2, end: 7 }], options: { audio: 'original', mood: 'reflective', transition: 'cut', framing: 'fit' } };
  const good = await api.POST(request(body)); assert.equal(good.status, 201); assert.equal(queued.downloads.length, 2); assert.equal(queued.input.caption, ''); assert.equal(queued.input.options.audio, 'original'); assert.equal(queued.downloads[0].title, 'Actual source title');
  const bad = await api.POST(request({ ...body, shots: [{ provider: 'pexels', id: 1, start: 10, end: 30 }] })); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /outside/); assert.equal(opened, 0);
  const repeated = await api.POST(request({ ...body, shots: [body.shots[0], body.shots[0]] })); assert.equal(repeated.status, 400); assert.match((await repeated.json()).error, /each source once/);
});

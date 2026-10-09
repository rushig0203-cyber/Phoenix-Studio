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
const automatic = require(path.join(project, 'src/lib/automaticStockReel.ts'));
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
  assert.throws(() => planning.planStockIntervals(Array.from({ length: 13 }, () => ({ duration: 3 })), 60), /one to twelve/);
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

test('minimum-length auto windows reserve genuine EOF context for off-cadence footage, not manual or legacy trims', () => {
  const shot = { start: 0, end: 25, trimMode: 'auto' };
  const info = { duration: 25, videoDuration: 24.956667, frameRate: 30000 / 1001 };
  const bounded = source.stockSourcePictureInterval(shot, info, 40);
  assert.ok(Math.abs(bounded.end - (24.956667 - 2 / 24)) < 1e-7);
  assert.equal(shot.end, 25, 'Saved provenance is not rewritten');
  assert.equal(source.stockSourcePictureInterval(shot, info).end, 24.956667, 'Older automatic recipes keep their original EOF');
  assert.equal(source.stockSourcePictureInterval({ ...shot, trimMode: 'manual' }, info).end, 25);
  assert.equal(source.stockSourcePictureInterval({ start: 0, end: 25 }, info).end, 25);
  assert.equal(source.stockSourcePictureInterval({ ...shot, end: 8 }, info, 40).end, 8, 'Selected end away from EOF stays unchanged');
});

test('aligned 24fps footage still supplies five complete eight-second intervals', () => {
  const bounds = Array.from({ length: 5 }, () => source.stockSourcePictureInterval({ start: 0, end: 8, trimMode: 'auto' }, { duration: 8, videoDuration: 8, frameRate: 24 }, 40));
  const plan = planning.planStockIntervals(bounds, 45, 'cinematic', 40);
  assert.equal(plan.at(-1).outputEnd, 40); assert.equal(plan.reduce((sum, shot) => sum + shot.frames, 0), 960);
});

test('missing, slow or fast source cadence uses bounded genuine context and rejects unusably short picture', () => {
  const shot = { start: 0, end: 8, trimMode: 'auto' };
  for (const [rate, margin] of [[undefined, 2 / 24], [NaN, 2 / 24], [12, 2 / 12], [60, 2 / 24]]) {
    const bound = source.stockSourcePictureInterval(shot, { duration: 8, videoDuration: 8, frameRate: rate }, 40);
    assert.ok(Math.abs(bound.end - (8 - margin)) < 1e-7);
  }
  assert.throws(() => source.stockSourcePictureInterval(shot, { duration: 8 }, 40), /verifiable picture/);
  assert.throws(() => source.stockSourcePictureInterval(shot, { duration: .05, videoDuration: .05 }, 40), /too short/);
});

test('local stereo instrumentals vary by reel and mood, have gentle ends, and stay under 11 MB at 105 seconds', () => {
  const reflective = planning.stockMusicWav(2, 'reflective', 'one-reel');
  assert.deepEqual(reflective, planning.stockMusicWav(2, 'reflective', 'one-reel'));
  assert.notDeepEqual(reflective, planning.stockMusicWav(2, 'reflective', 'other-reel'));
  assert.notDeepEqual(reflective, planning.stockMusicWav(2, 'warm', 'one-reel'));
  assert.equal(reflective.toString('ascii', 0, 4), 'RIFF');
  assert.equal(reflective.readUInt16LE(22), 2);
  assert.equal(reflective.readUInt32LE(24), 24000);
  assert.equal(reflective.readInt16LE(44), 0);
  let peak = 0; for (let index = 44; index < reflective.length; index += 2) peak = Math.max(peak, Math.abs(reflective.readInt16LE(index)));
  assert.ok(peak > 100 && peak < 16000);
  assert.ok(planning.stockMusicWav(105, 'journey', 'bounded').length < 11 * 1024 * 1024);
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
  // Every child is fake here. Mock the current admission entry point instead of
  // making a logic fixture depend on the owner's free RAM or live model state.
  const slot = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const input = { ...reelInput(), caption: 'Forest streams in the afternoon.' }, open = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 });
  const job = await source.createStockReelJob([download(1, open), download(2, open)], input);
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  assert.equal(file.quality.postingTextOrigin, 'owner', 'An explicitly supplied stock caption belongs to the owner');
  assert.equal(file.quality.audio, 'natural-audio-preserved'); assert.equal(file.quality.captions.length, 0); assert.equal(file.quality.subtitles.decision, 'uncertain');
  assert.equal(file.quality.visualSources.length, 2); assert.equal(file.quality.visualSources[0].provider, 'pexels'); assert.equal(file.quality.postCopy, input.caption);
  assert.match(file.quality.visualSources[1].providerUrl, /https:\/\/pixabay.com\/videos\/forest-stream-2/);
  assert.ok(file.quality.checks.some(check => /Shot 2:.*pixabay/.test(check)), 'Source credits stay in review metadata, not posting copy');
  assert.ok(file.quality.checks.some(check => /original retained \(-65.0/.test(check)));
  assert.equal(file.artifacts.editing.captionsBaked, false); assert.match(file.artifacts.editing.video, /editable-master/); assert.match(file.artifacts.original, /original-assembly/);
  assert.equal(maxEncoding, 1, 'Encoding stays sequential');
  assert.ok(calls.some(call => call.args.some(arg => typeof arg === 'string' && arg.includes('amix=inputs=2'))));
  assert.ok(!calls.some(call => call.args.some(arg => typeof arg === 'string' && /drawtext=|ass=captions/.test(arg))), 'No speech means neither captions nor a posting title overlay');
  assert.ok(!calls.some(call => call.args.includes('--input')), 'An unavailable cached model does not trigger transcription or a model download');
  const finalEncode = calls.find(call => call.args.at(-1)?.includes('.partial-') && call.args.at(-1)?.endsWith('.mp4'));
  assert.ok(!finalEncode.args.includes('-frames:v'),'Stock fallback bounds time instead of terminating its audio with a picture ceiling');
  assert.equal(finalEncode.args[finalEncode.args.lastIndexOf('-t') + 1],'4.000');
  assert.match(finalEncode.args[finalEncode.args.indexOf('-vf')+1],/fps=24,setpts=PTS-STARTPTS/);
  file.quality.postCopy = 'Posting copy checked for this specific output.'; file.quality.hashtags = ['#ForestStream'];
  delete file.quality.postingTextOrigin; // Legacy metadata must retain the known owner caption on reuse.
  await reviews.saveReviewFile(file);
  const before = encodes;
  await source.updateJob(job.id, { status: 'FAILED', error: 'isolated interruption after final persistence' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  assert.equal(encodes, before, 'Verified finished outputs are reused before per-shot encoding');
  assert.equal((await reviews.getReviewFile(file.id)).quality.postCopy, file.quality.postCopy);
  assert.equal((await reviews.getReviewFile(file.id)).quality.postingTextOrigin, 'owner');
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

test('new automatic reel replaces mixed source sound with one full-length instrumental and adds no removed-source speech captions', async t => {
  const calls = [], encodedLengths = new Map();
  let decodedSourceDuration = 8;
  const spawn = mock.method(require('node:child_process'), 'spawn', (command, args, options = {}) => {
    calls.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        const filename = path.basename(args.at(-1)), downloaded = /-shot-(\d+)-/.exec(filename), shot = /^shot-\d+\.mp4$/.test(filename);
        const seconds = downloaded ? String(decodedSourceDuration) : shot ? encodedLengths.get(filename) : '40';
        child.stdout.end(JSON.stringify({ format: { duration: seconds }, streams: [
          { codec_type: 'video', duration: seconds, codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '24/1', width: 720, height: 1280 },
          ...((downloaded && Number(downloaded[1]) === 2) ? [] : [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }]),
        ] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: true, modelCached: true }));
      else if (args.includes('volumedetect')) child.stderr.end('mean_volume: -20.0 dB\nmax_volume: -3.0 dB\n');
      else {
        assert.ok(!args.includes('--input'), 'Removed source speech must not start transcription');
        if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('.mp4')) {
          const output = path.resolve(options.cwd || temporary, args.at(-1));
          assert.ok(output.startsWith(temporary + path.sep)); fs.writeFileSync(output, Buffer.alloc(4096));
          if (/^shot-\d+\.mp4$/.test(path.basename(output))) encodedLengths.set(path.basename(output), args[args.lastIndexOf('-t') + 1]);
        }
        child.stdout.end('fixture tool version\nout_time=00:00:40.000\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const slot = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const open = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 });
  const input = { ...reelInput(), maxDuration: 45, options: { ...automatic.automaticStockReelOptions('forest'), minDuration: 40, shotCadence: 'brisk-v1' } };
  const makeDownloads = () => Array.from({ length: 8 }, (_, index) => ({ ...download(index + 1, open), end: 8, trimMode: 'auto' }));
  const job = await source.createStockReelJob(makeDownloads(), input);
  assert.equal(job.stockSource.options.shotCadence, 'brisk-v1', 'The new cadence is saved before rendering');
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  assert.equal(file.quality.audio, 'local-music-replaced');
  assert.deepEqual(file.quality.captions, []); assert.equal(file.quality.subtitles.decision, 'none');
  assert.ok(calls.some(args => args.includes('anullsrc=r=48000:cl=stereo')), 'The fixture includes a silent source alongside audible sources');
  const musicMaster = calls.find(args => path.basename(args.at(-1) || '') === 'editable-master.mp4');
  assert.ok(musicMaster, 'One continuous musical master is made for the reel');
  assert.equal(musicMaster.filter(arg => arg === '-i').length, 2);
  assert.match(musicMaster[musicMaster.lastIndexOf('-i') + 1], /instrumental\.wav$/);
  assert.deepEqual(musicMaster.filter((arg, index) => musicMaster[index - 1] === '-map'), ['0:v:0', '1:a:0']);
  assert.equal(musicMaster[musicMaster.lastIndexOf('-t') + 1], '40.000000');
  assert.ok(!musicMaster.some(arg => /amix=|volume=/.test(arg)), 'The music is neither mixed with nor level-switched around source audio');
  assert.ok(!calls.some(args => args.includes('--input') || args.some(arg => typeof arg === 'string' && /drawtext=|ass=captions/.test(arg))));
  assert.ok(file.artifacts.music); assert.equal(file.artifacts.editing.captionsBaked, false);
  assert.ok(file.quality.checks.some(check => /saved brisk cadence.*six seconds/.test(check)));
  assert.equal(encodedLengths.size, 8); assert.equal(encodedLengths.get('shot-1.mp4'), '3.000000');
  const shotArgs = calls.filter(args => args.includes('-c:v') && /^shot-\d+\.mp4$/.test(path.basename(args.at(-1) || '')));
  for (const args of shotArgs) {
    assert.ok(Number(args[args.lastIndexOf('-t') + 1]) <= 6);
    assert.match(args[args.indexOf('-vf') + 1], /fps=24,setpts=PTS-STARTPTS/);
    assert.ok(!args.includes('-stream_loop') && !args.some(arg => /tpad=|setpts=.*\*/.test(arg)));
  }
  decodedSourceDuration = 5;
  const short = await source.createStockReelJob(makeDownloads(), { ...input, requestId: crypto.randomUUID() });
  const before = calls.length;
  await source.processNextSourceJob();
  const rejected = await source.getSourceJob(short.id);
  assert.equal(rejected.status, 'FAILED'); assert.match(rejected.error, /Not enough related footage/);
  assert.ok(!calls.slice(before).some(args => /^shot-\d+\.mp4$/.test(path.basename(args.at(-1) || ''))), 'Decoded picture bounds fail before any encoding or hold padding');
  await source.updateJob(short.id, { status: 'CANCELLED' });
});

test('new cadence validation runs before opening streams for incomplete or manual recipes', async () => {
  let opened = 0;
  const open = async () => { opened++; return { stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 }; };
  const downloads = Array.from({ length: 8 }, (_, index) => ({ ...download(index + 1, open), end: 8, trimMode: 'auto' }));
  const input = { ...reelInput(), maxDuration: 45, options: { ...automatic.automaticStockReelOptions('forest'), minDuration: 40, shotCadence: 'brisk-v1' } };
  await assert.rejects(source.createStockReelJob(downloads.slice(1), input), /Brisk cadence/);
  await assert.rejects(source.createStockReelJob(downloads, { ...input, options: { ...input.options, minDuration: undefined } }), /Brisk cadence/);
  await assert.rejects(source.createStockReelJob(downloads.map((shot, index) => index ? shot : { ...shot, trimMode: 'manual' }), input), /Brisk cadence/);
  assert.equal(opened, 0);
});

test('new automatic40s recipes validate actual picture length on fresh output and completed reuse, and retain safe retry behavior', async t => {
  let pictureDuration = 38, decodedSourceDuration = 30, encodes = 0;
  const shotCommands = [];
  const spawn = mock.method(require('node:child_process'), 'spawn', (command, args, options = {}) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        const original = /-shot-\d+-/.test(path.basename(args.at(-1))), seconds = original ? decodedSourceDuration : pictureDuration;
        child.stdout.end(JSON.stringify({ format: { duration: original ? String(decodedSourceDuration) : '40.021' }, streams: [
          { codec_type: 'video', duration: String(seconds), codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '24/1', width: 720, height: 1280 },
          ...(original ? [] : [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }]),
        ] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: false, modelCached: false }));
      else {
        if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('.mp4')) {
          encodes++;
          if (/^shot-\d+\.mp4$/.test(path.basename(args.at(-1)))) shotCommands.push(args);
          const output = path.resolve(options.cwd || temporary, args.at(-1));
          assert.ok(output.startsWith(temporary + path.sep)); fs.writeFileSync(output, Buffer.alloc(4096));
        }
        child.stdout.end('fixture tool version\nout_time=00:00:40.000\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const slot = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const open = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 });
  const makeDownloads = () => Array.from({ length: 5 }, (_, index) => ({ ...download(index + 1, open), end: 40, trimMode: 'auto' }));
  const input = { ...reelInput(), maxDuration: 45, options: { audio: 'auto', mood: 'warm', transition: 'cut', framing: 'auto', pacing: 'cinematic', minDuration: 40 } };
  const job = await source.createStockReelJob(makeDownloads(), input);
  assert.equal(job.stockSource.options.minDuration, 40, 'The saved recipe survives process restart');
  await source.processNextSourceJob();
  let done = await source.getSourceJob(job.id);
  assert.equal(done.status, 'FAILED'); assert.match(done.error, /rendered picture.*shorter.*40/);
  assert.equal((await reviews.readReviewFiles()).filter(file => file.processing?.jobId === job.id && file.status === 'READY').length, 0);
  pictureDuration = 40;
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  done = await source.getSourceJob(job.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]); assert.equal(file.outputs.instagram.videoDuration, 40);
  assert.ok(file.quality.checks.some(check => /22\.000s–30\.000s/.test(check)), 'Overstated catalog ends were clamped to actual source picture before planning');
  assert.equal(file.quality.postingTextOrigin, 'automatic');
  assert.ok(shotCommands.length > 0);
  for (const args of shotCommands) {
    assert.equal(args.filter(arg => arg === '-t').length, 1, 'Only output duration stops a minimum-length frame conversion');
    assert.ok(args.indexOf('-t') > args.indexOf('-i'), 'Decoder can read genuine lookahead');
    assert.ok(!args.includes('-stream_loop') && !args.some(arg => /tpad=/.test(arg)), 'No repeated or frozen ending');
  }
  const beforeBadReuse = encodes;
  pictureDuration = 38;
  await source.updateJob(job.id, { status: 'FAILED', error: 'Fixture completed picture became invalid' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  done = await source.getSourceJob(job.id); assert.equal(done.status, 'FAILED'); assert.match(done.error, /rendered picture.*shorter.*40/);
  assert.ok(encodes > beforeBadReuse, 'A short saved output is not accepted through the early completed-reuse branch');
  pictureDuration = 40;
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  const beforeGoodReuse = encodes;
  await source.updateJob(job.id, { status: 'FAILED', error: 'Fixture interrupt after verified completion' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  assert.equal((await source.getSourceJob(job.id)).status, 'COMPLETED'); assert.equal(encodes, beforeGoodReuse, 'A verified40s finished file is retained, not duplicated');
  // UUID idempotency owns its original recipe even if a caller now supplies an
  // insufficient changed recipe. It must not open streams or regenerate it.
  assert.equal((await source.createStockReelJob([makeDownloads()[0]], input)).id, job.id);
  decodedSourceDuration = 7.999;
  const short = await source.createStockReelJob(makeDownloads(), { ...input, requestId: crypto.randomUUID() });
  const beforeInsufficient = encodes;
  await source.processNextSourceJob();
  const shortDone = await source.getSourceJob(short.id);
  assert.equal(shortDone.status, 'FAILED'); assert.match(shortDone.error, /Not enough related footage.*40-second/);
  assert.equal(encodes, beforeInsufficient, 'Insufficient actual source picture fails before encoding');
  await source.updateJob(short.id, { status: 'CANCELLED' });
});

test('older automatic recipes clamp rounded catalog ends to actual picture; manual and missing-mode trims remain strict', async t => {
  let actualPicture = [37.578333, 10.333333, 12.56];
  const calls = [];
  const spawn = mock.method(require('node:child_process'), 'spawn', (command, args, options = {}) => {
    calls.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        const shot = /-shot-(\d+)-/.exec(path.basename(args.at(-1)));
        child.stdout.end(JSON.stringify({ format: { duration: shot ? ['38', '10.333333', '12.56'][Number(shot[1]) - 1] : '17.521' }, streams: [
          { codec_type: 'video', duration: String(shot ? actualPicture[Number(shot[1]) - 1] : 17.5), codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '24/1', width: 720, height: 1280 },
          ...(shot ? [] : [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }]),
        ] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: false, modelCached: false }));
      else {
        if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('.mp4')) {
          const output = path.resolve(options.cwd || temporary, args.at(-1));
          assert.ok(output.startsWith(temporary + path.sep)); fs.writeFileSync(output, Buffer.alloc(4096));
        }
        child.stdout.end('fixture tool version\nout_time=00:00:17.500\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const slot = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const open = async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 });
  // This timing fixture uses its own identities so unrelated earlier completed
  // fixtures do not consume the newly enforced universal four-use allowance.
  const makeDownloads = trimMode => [38, 10, 12].map((end, index) => ({ ...download(index + 1, open), mediaId: String(1001 + index), end, ...(trimMode ? { trimMode } : {}) }));
  const makeInput = () => ({ ...reelInput(), maxDuration: 45, options: { audio: 'auto', mood: 'reflective', transition: 'cut', framing: 'auto', pacing: 'cinematic' } });
  const job = await source.createStockReelJob(makeDownloads('auto'), makeInput());
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id);
  assert.equal(done.status, 'COMPLETED', done.error);
  assert.equal(done.stockSource.options.minDuration, undefined, 'Older saved recipes do not gain a new minimum');
  assert.equal(done.stockSource.shots[0].end, 38, 'Catalog provenance stays unchanged on disk');
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  assert.ok(file.quality.checks.some(check => /17\.500 seconds/.test(check)));
  // The first cinematic window is only five seconds. Verify picture-only end
  // clamping explicitly with a final shot shorter than its rounded catalog end.
  actualPicture = [37.578333, 10.333333, 11.578333];
  const shortened = await source.createStockReelJob(makeDownloads('auto'), makeInput());
  await source.processNextSourceJob();
  const shortenedDone = await source.getSourceJob(shortened.id);
  assert.equal(shortenedDone.status, 'COMPLETED', shortenedDone.error);
  const shortenedFile = await reviews.getReviewFile(shortenedDone.reviewIds[0]);
  assert.ok(shortenedFile.quality.checks.some(check => /4\.578s–11\.578s/.test(check)), 'Final auto window ends at actual picture, not longer container');
  actualPicture = [37.578333, 10.333333, 12.56];
  for (const trimMode of ['manual', undefined]) {
    const downloads = makeDownloads(trimMode);
    downloads[0].end = 39; // Beyond even the reported container; no owner interval correction.
    const strict = await source.createStockReelJob(downloads, { ...makeInput(), maxDuration: 75 });
    const before = calls.length;
    await source.processNextSourceJob();
    const stopped = await source.getSourceJob(strict.id);
    assert.equal(stopped.status, 'FAILED'); assert.match(stopped.error, /trim lies outside/);
    assert.ok(!calls.slice(before).some(args => !args.includes('-show_entries') && typeof args.at(-1) === 'string' && args.at(-1).endsWith('.mp4')), 'Invalid owner trims fail before encoding');
  }
  const outOfBounds = makeDownloads('auto'); outOfBounds[0].start = 37.9;
  const invalidStart = await source.createStockReelJob(outOfBounds, makeInput());
  await source.processNextSourceJob();
  const invalidDone = await source.getSourceJob(invalidStart.id);
  assert.equal(invalidDone.status, 'FAILED'); assert.match(invalidDone.error, /trim lies outside/);
});

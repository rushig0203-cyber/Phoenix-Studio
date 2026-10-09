// Pure remux-gate/command regression tests. No FFmpeg, provider or private files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, mock } = require('node:test');
const ts = require('typescript');
const filename = path.join(__dirname, '..', 'src/lib/sourceProcessing.ts');
const source = fs.readFileSync(filename, 'utf8');
const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const names = ['canRemuxStockAssembly', 'stockAssemblyRemuxArgs'];
const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(selected.length, names.length);
const code = ts.transpileModule(selected.map(node => node.getText(parsed)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleFixture = { exports: {} };
vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, STOCK_REEL_FPS: 24 });
const render = moduleFixture.exports;
const job = { stockSource: { shots: [{ sourceFile: 'downloaded-shot.mp4' }] } };
const media = { duration: 11, width: 720, height: 1280, hasAudio: true, videoCodec: 'h264', pixelFormat: 'yuv420p', frameRate: 24, audioCodec: 'aac', audioSampleRate: 48000, audioChannels: 2 };
test('verified caption-free stock assembly can retain its picture without another encode', () => {
  assert.equal(render.canRemuxStockAssembly(job, [], media, 11), true);
  assert.equal(render.canRemuxStockAssembly(job, [], { ...media, duration: 11.04 }, 11), true);
});
test('uploads, legacy single-source stock and captioned renders never use the stock remux shortcut', () => {
  assert.equal(render.canRemuxStockAssembly({}, [], media, 11), false);
  assert.equal(render.canRemuxStockAssembly({ stockSource: { provider: 'pexels' } }, [], media, 11), false);
  assert.equal(render.canRemuxStockAssembly({ stockSource: { shots: [] } }, [], media, 11), false);
  assert.equal(render.canRemuxStockAssembly(job, [{ start: 0, end: 1, lines: ['Actual speech.'] }], media, 11), false);
});
test('unverified codecs, audio, format and duration safely fall back to the existing renderer', () => {
  for (const change of [{ videoCodec: undefined }, { videoCodec: 'hevc' }, { pixelFormat: 'yuv444p' }, { frameRate: 30 }, { audioCodec: 'mp3' }, { audioSampleRate: 16000 }, { audioChannels: 1 }, { hasAudio: false }, { width: 1280, height: 720 }, { duration: 10.5 }, { duration: NaN }]) {
    assert.equal(render.canRemuxStockAssembly(job, [], { ...media, ...change }, 11), false, JSON.stringify(change));
  }
  assert.equal(render.canRemuxStockAssembly(job, [], media, 0), false);
  assert.equal(render.canRemuxStockAssembly(job, [], media, Infinity), false);
});
test('remux maps verified picture/sound only, writes faststart, and never slows or pads footage', () => {
  const args = Array.from(render.stockAssemblyRemuxArgs('editable-master.mp4', 'scoped.partial.mp4'));
  assert.deepEqual(args, ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'editable-master.mp4', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', 'scoped.partial.mp4']);
  assert.ok(!args.some(arg => /setpts|atempo|loop|pad|libx264|^-vf$|^-af$/.test(arg)));
});

test('mocked stock queue dispatches the verified remux and fills a silent tail without replacing quiet ambience', async t => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const { Readable, PassThrough } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const project = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-stock-remux-mock-'));
  const previousDirectory = process.cwd(), previousFetch = global.fetch;
  const previousFfmpeg = process.env.PHOENIX_FFMPEG_PATH, previousFfprobe = process.env.PHOENIX_FFPROBE_PATH;
  process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
  require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
  require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
  process.chdir(temporary);
  global.fetch = async () => { throw new Error('No provider/model request belongs in this mocked fixture.'); };
  const calls = [];
  const children = mock.method(require('node:child_process'), 'spawn', (binary, args, options = {}) => {
    calls.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      if (args.includes('-show_entries')) {
        const name = path.basename(args.at(-1)), sourceShot = /-shot-[12]-/.test(name), first = /-shot-1-/.test(name);
        const info = sourceShot ? { duration: first ? 3 : 8, width: 360, height: 640, hasAudio: first } : media;
        child.stdout.end(JSON.stringify({ format: { duration: String(info.duration) }, streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', avg_frame_rate: '24/1', width: info.width, height: info.height },
          ...(info.hasAudio ? [{ codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }] : []),
        ] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: false, modelCached: false, detail: 'No local speech model in isolated fixture.' }));
      else if (args.includes('volumedetect')) child.stderr.end('mean_volume: -65.0 dB\nmax_volume: -52.0 dB\n');
      else {
        const output = args.at(-1);
        if (typeof output === 'string' && output.endsWith('.mp4')) {
          const destination = path.resolve(options.cwd || temporary, output);
          assert.ok(destination.startsWith(temporary + path.sep), 'Mocked media stays in this test directory.');
          fs.writeFileSync(destination, Buffer.alloc(4096));
        }
        child.stdout.end('fixture tool version\nout_time=00:00:11.000\n');
      }
      child.emit('close', 0);
    });
    return child;
  });
  const resources = require(path.join(project, 'src/lib/renderResources.ts'));
  const admission = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => {
    children.mock.restore(); admission.mock.restore(); priority.mock.restore();
    global.fetch = previousFetch; process.chdir(previousDirectory);
    if (previousFfmpeg === undefined) delete process.env.PHOENIX_FFMPEG_PATH; else process.env.PHOENIX_FFMPEG_PATH = previousFfmpeg;
    if (previousFfprobe === undefined) delete process.env.PHOENIX_FFPROBE_PATH; else process.env.PHOENIX_FFPROBE_PATH = previousFfprobe;
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(temporary).startsWith('phoenix-stock-remux-mock-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const processing = require(path.join(project, 'src/lib/sourceProcessing.ts'));
  const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
  const downloads = [3, 8].map((duration, index) => ({ provider: 'pexels', mediaId: String(index + 1), title: 'Related forest moment', creator: 'Mock contributor', sourcePage: `https://www.pexels.com/video/forest-${index + 1}/`, start: 0, end: duration, trimMode: 'manual', open: async () => ({ stream: Readable.toWeb(Readable.from(Buffer.alloc(2048))), expectedBytes: 2048 }) }));
  const queued = await processing.createStockReelJob(downloads, { requestId: crypto.randomUUID(), caption: '', theme: 'forest', maxDuration: 60, options: { audio: 'auto', mood: 'warm', transition: 'cut', framing: 'auto', pacing: 'selected' } });
  assert.ok(queued.stockSource.shots.every(shot => shot.trimMode === 'manual'));
  assert.equal(queued.stockSource.editVersion, 2);
  await processing.processNextSourceJob();
  const done = await processing.getSourceJob(queued.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  assert.equal(file.outputs.instagram.duration, 11); assert.equal(file.quality.audio, 'natural-audio-preserved');
  assert.deepEqual(file.quality.captions, []);
  assert.ok(file.quality.checks.some(check => check.includes('no music over usable original ambience')));
  assert.ok(file.quality.checks.some(check => check.includes('without a second picture encode')));
  assert.equal(file.artifacts.renderRevision, 'stock-assembly-v2');
  assert.match(file.artifacts.editing.video, /stock-assembly-v2/);
  const videoEncodes = calls.filter(args => args.includes('libx264'));
  assert.equal(videoEncodes.length, 2, 'Only the two source shots require picture encoding.');
  const finalCopy = calls.find(args => typeof args.at(-1) === 'string' && args.at(-1).includes('.partial-') && args.at(-1).endsWith('.mp4'));
  assert.equal(finalCopy[finalCopy.indexOf('-c') + 1], 'copy');
  const musicMix = calls.find(args => args.includes('-filter_complex'));
  const graph = musicMix[musicMix.indexOf('-filter_complex') + 1];
  assert.match(graph, /eval=frame\[bed\]/);
  assert.match(graph, /if\(lt\(t,3\.000000\),0\.000000/);
  assert.doesNotMatch(graph, /setpts|atempo|stream_loop/);
});

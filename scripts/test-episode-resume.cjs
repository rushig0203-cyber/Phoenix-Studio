// Isolated queue/checkpoint regression: tools are fake; no owner file/model is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable, PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { test, after, mock } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-episode-resume-'));
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
process.chdir(temporary);
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
after(() => {
  mock.restoreAll(); process.chdir(project);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('phoenix-episode-resume-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

test('49-minute episode keeps early silence boundaries and resumes completed clips and audio scans', async t => {
  let silenceScans = 0, audioScans = 0, encodes = 0, failEncode = 4, failAudio = 0;
  const durations = new Map();
  const spawn = mock.method(require('node:child_process'), 'spawn', (_command, args, options = {}) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    setImmediate(() => {
      let code = 0;
      if (args.includes('-show_entries')) {
        const file = args.at(-1), bytes = fs.readFileSync(file);
        const duration = Number(/^duration=(\d+(?:\.\d+)?)/.exec(bytes.toString('utf8', 0, 64))?.[1]) || 2940;
        durations.set(file, duration);
        child.stdout.end(JSON.stringify({ format: { duration: String(duration) }, streams: [
          { codec_type: 'video', width: 1280, height: 720, avg_frame_rate: '24/1' }, { codec_type: 'audio' },
        ] }));
      } else if (args.includes('--check')) child.stdout.end(JSON.stringify({ fasterWhisper: true, modelCached: true, model: 'base' }));
      else if (args.includes('--input')) {
        const transcript = args[args.indexOf('--output') + 1];
        fs.mkdirSync(path.dirname(transcript), { recursive: true });
        fs.writeFileSync(transcript, JSON.stringify({ model: 'base', complete: true, duration: 2940, segments: [] }));
        child.stdout.end();
      } else if (args.some(arg => String(arg).includes('silencedetect='))) {
        silenceScans++;
        // A valid early boundary followed by >128KiB diagnostics used to disappear.
        const lines = '[silencedetect] silence_start: 148\n[silencedetect] silence_end: 150\n' + 'A'.repeat(140000) + '\n'
          + '[silencedetect] silence_start: 2939\n[silencedetect] silence_end: 2940';
        for (let at = 0; at < lines.length; at += 17) child.stderr.write(lines.slice(at, at + 17));
        child.stderr.end();
      } else if (args.includes('volumedetect')) {
        audioScans++;
        if (failAudio && audioScans === failAudio) { code = 1; child.stderr.end('Synthetic interrupted audio measurement'); }
        else child.stderr.end('mean_volume: -20.0 dB\nmax_volume: -3.0 dB\n');
      } else if (args.at(-1)?.endsWith('.mp4')) {
        encodes++;
        if (encodes === failEncode) { code = 1; child.stderr.end('Synthetic interrupted fourth encode'); }
        else {
          const duration = Number(args[args.indexOf('-t') + 1]), output = path.resolve(options.cwd || temporary, args.at(-1));
          assert.ok(output.startsWith(temporary + path.sep));
          const bytes = Buffer.alloc(4096); bytes.write(`duration=${duration}\n`); fs.writeFileSync(output, bytes);
          child.stdout.end(`out_time=00:02:${String(duration - 120).padStart(6, '0')}\n`);
        }
      } else child.stdout.end('Fixture tool version');
      child.emit('close', code);
    });
    return child;
  });
  const slot = mock.method(resources, 'tryWithLocalRenderSlot', async operation => ({ acquired: true, value: await operation() }));
  const priority = mock.method(resources, 'lowerChildProcessPriority', () => undefined);
  t.after(() => { spawn.mock.restore(); slot.mock.restore(); priority.mock.restore(); });
  const job = await source.createSourceJob(Readable.toWeb(Readable.from(Buffer.alloc(2048))), 'episode.mp4', 'coverage', 'Isolated 49-minute fixture', 2048);
  await source.processNextSourceJob();
  let current = await source.getSourceJob(job.id);
  assert.equal(current.status, 'FAILED'); assert.equal(current.completedClips, 3);
  assert.match(current.error, /Synthetic interrupted fourth encode/);
  const firstIds = [...current.reviewIds];
  const firstOutputs = firstIds.map(id => ({ id, bytes: fs.readFileSync(reviews.outputPath(id, 'instagram')), stamp: fs.statSync(reviews.outputPath(id, 'instagram')).mtimeMs }));
  const checkpoint = path.join(temporary, 'storage/Phoenix Studio Review Files/work', `source-${job.id}`, 'episode-audio-analysis.json');
  const analysis = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
  assert.deepEqual(analysis.quiet, [{ start: 148, end: 150 }, { start: 2939, end: 2940 }]);
  assert.equal(analysis.cuts.length, 20); assert.equal(analysis.cuts[0].end, 149, 'Early silence guides the natural first boundary');
  assert.equal(audioScans, 20); assert.equal(silenceScans, 1);
  failEncode = 0;
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  current = await source.getSourceJob(job.id);
  assert.equal(current.status, 'COMPLETED', current.error); assert.equal(current.completedClips, 20);
  assert.equal(current.reviewIds.length, 20); assert.equal(new Set(current.reviewIds).size, 20);
  assert.deepEqual(current.reviewIds.slice(0, 3), firstIds);
  assert.equal(audioScans, 20, 'Completed interval measurements are not decoded again');
  assert.equal(silenceScans, 1, 'Completed long-episode silence scan is reused');
  assert.equal(encodes, 21, 'Three finished clips are retained, one failed encode is retried');
  for (const output of firstOutputs) {
    assert.deepEqual(fs.readFileSync(reviews.outputPath(output.id, 'instagram')), output.bytes);
    assert.equal(fs.statSync(reviews.outputPath(output.id, 'instagram')).mtimeMs, output.stamp);
  }
  const files = await Promise.all(current.reviewIds.map(id => reviews.getReviewFile(id)));
  assert.equal(files[0].processing.start, 0); assert.equal(files.at(-1).processing.end, 2940);
  files.forEach((file, index) => {
    const interval = file.processing;
    assert.ok(interval.end - interval.start >= 120 && interval.end - interval.start <= 180);
    if (index) assert.equal(interval.start, files[index - 1].processing.end);
  });
  const corrupt = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
  corrupt.cuts[0].audio = { usable: true, mean: -99, max: -99 };
  fs.writeFileSync(checkpoint, JSON.stringify(corrupt));
  await source.updateJob(job.id, { status: 'FAILED' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  assert.equal((await source.getSourceJob(job.id)).status, 'COMPLETED');
  assert.equal(silenceScans, 2); assert.equal(audioScans, 40, 'Inconsistent checkpoint measurements are recomputed, never trusted');
  // A source change must stop before an old transcript or clip can be reused.
  const original = reviews.sourcePath(job.id, job.sourceFile);
  fs.appendFileSync(original, 'changed');
  await source.updateJob(job.id, { status: 'FAILED' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  current = await source.getSourceJob(job.id); assert.equal(current.status, 'FAILED');
  assert.match(current.error, /staged episode changed.*new upload.*old transcript or clips/);
  assert.equal(silenceScans, 2); assert.equal(audioScans, 40); assert.equal(encodes, 21);
  for (const output of firstOutputs) {
    assert.deepEqual(fs.readFileSync(reviews.outputPath(output.id, 'instagram')), output.bytes);
    assert.equal(fs.statSync(reviews.outputPath(output.id, 'instagram')).mtimeMs, output.stamp);
  }
  // Interruption during the scan itself retains each completed measurement.
  const second = await source.createSourceJob(Readable.toWeb(Readable.from(Buffer.alloc(2048))), 'second-episode.mp4', 'coverage', 'Second isolated fixture', 2048);
  failAudio = audioScans + 3;
  await source.processNextSourceJob();
  assert.equal((await source.getSourceJob(second.id)).status, 'FAILED');
  assert.equal(silenceScans, 3); assert.equal(audioScans, 43);
  failAudio = 0;
  await source.retrySourceJob(second.id); await source.processNextSourceJob();
  assert.equal((await source.getSourceJob(second.id)).status, 'COMPLETED');
  assert.equal(silenceScans, 3); assert.equal(audioScans, 61, 'The first two completed interval checks are retained');
});

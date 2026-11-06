// Real long-duration render/resume mechanics in CI; never loads owner stores or a model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { mock } = require('node:test');
const { Readable } = require('node:stream');
const project = path.resolve(__dirname, '..');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Run this long-duration proof on the standard remote runner, not the owner laptop.');
assert.equal(process.platform, 'win32');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-episode-proof-'));
const ffmpeg = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const ffprobe = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
process.env.PHOENIX_FFMPEG_PATH = ffmpeg;
process.env.PHOENIX_FFPROBE_PATH = ffprobe;
process.env.PHOENIX_WHISPER_PYTHON = 'python';
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
process.chdir(temporary);
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const originalSpawn = childProcess.spawn;
const activeChildren = new Set();
let timedOut = false, deadline;
function launch(binary, args, options) {
  assert.ok(!timedOut, 'Long-episode mechanics proof exceeded its eight-minute budget.');
  const child = originalSpawn(binary, args, options);
  activeChildren.add(child); child.once('close', () => activeChildren.delete(child));
  return child;
}
function tool(binary, args) {
  return new Promise((resolve, reject) => {
    const child = launch(binary, args, { windowsHide: true });
    resources.lowerChildProcessPriority(child.pid);
    let output = '', diagnostic = '';
    child.stdout.on('data', part => { output = (output + part).slice(-65536); });
    child.stderr.on('data', part => { diagnostic = (diagnostic + part).slice(-8000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(diagnostic || `Tool failed: ${code}`)));
  });
}
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 64 * 1024 })) digest.update(chunk);
  return digest.digest('hex');
}
async function main() {
  deadline = setTimeout(() => {
    timedOut = true;
    for (const child of activeChildren) child.kill();
  }, 8 * 60 * 1000);
  deadline.unref();
  assert.ok(os.freemem() >= 900 * 1024 * 1024, 'Retain normal rendering memory admission.');
  global.fetch = async () => { throw new Error('Network forbidden in long-episode mechanics proof.'); };
  // The silent synthetic video never invokes speech recognition. This stub only
  // admits that model-free fixture through the normal dependency preflight.
  fs.mkdirSync(path.join(temporary, 'scripts'));
  fs.writeFileSync(path.join(temporary, 'scripts/transcribe-local.py'),
    'import json,sys\nassert "--check" in sys.argv, "No transcription/model is permitted in this silent fixture"\nprint(json.dumps({"fasterWhisper":True,"modelCached":True,"model":"base"}))\n');
  const original = path.join(temporary, '49-minute-synthetic.mp4');
  await tool(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...resources.FFMPEG_FILTER_RESOURCE_ARGS,
    '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=1', '-t', '2940', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
    ...resources.FFMPEG_ENCODER_RESOURCE_ARGS, '-pix_fmt', 'yuv420p', original]);
  let renders = 0, killed = false;
  mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = launch(command, args, options);
    if (command === ffmpeg && args.includes('-progress') && args.at(-1)?.includes('.partial-')) {
      renders++;
      if (renders === 4) child.stdout.once('data', () => { killed = child.kill(); });
    }
    return child;
  });
  const created = await source.createSourceJob(Readable.toWeb(fs.createReadStream(original)), path.basename(original), 'coverage',
    'Synthetic 49-minute resume proof', fs.statSync(original).size);
  await source.processNextSourceJob();
  const stopped = await source.getSourceJob(created.id);
  assert.ok(killed, 'Fourth real FFmpeg process must have been interrupted.');
  assert.equal(stopped.status, 'FAILED', stopped.error); assert.equal(stopped.completedClips, 3);
  const retained = await Promise.all(stopped.reviewIds.map(async id => ({ id, hash: await hash(reviews.outputPath(id, 'instagram')),
    mtimeMs: fs.statSync(reviews.outputPath(id, 'instagram')).mtimeMs })));
  await source.retrySourceJob(created.id); await source.processNextSourceJob();
  const completed = await source.getSourceJob(created.id);
  assert.equal(completed.status, 'COMPLETED', completed.error);
  assert.equal(completed.reviewIds.length, 20); assert.equal(new Set(completed.reviewIds).size, 20);
  assert.equal(renders, 21, 'Retry performs the failed encode and remaining17, retaining the first three completed outputs.');
  for (const clip of retained) {
    assert.equal(await hash(reviews.outputPath(clip.id, 'instagram')), clip.hash);
    assert.equal(fs.statSync(reviews.outputPath(clip.id, 'instagram')).mtimeMs, clip.mtimeMs);
  }
  const outputs = [];
  for (const id of completed.reviewIds) {
    const file = await reviews.getReviewFile(id), instagram = reviews.outputPath(id, 'instagram'), youtube = reviews.outputPath(id, 'youtube');
    const metadata = JSON.parse(await tool(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,duration,nb_read_frames,width,height', '-of', 'json', instagram]));
    const video = metadata.streams.find(stream => stream.codec_type === 'video');
    assert.ok(video && metadata.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(Number(video.nb_read_frames) > 0);
    assert.ok(Math.abs(Number(metadata.format.duration) - (file.processing.end - file.processing.start)) < 1);
    await tool(ffmpeg, ['-v', 'error', '-xerror', ...resources.FFMPEG_FILTER_RESOURCE_ARGS, '-threads', '1', '-i', instagram, '-f', 'null', '-']);
    assert.equal(await hash(instagram), await hash(youtube), 'Both platform copies retain the same validated video.');
    assert.equal(file.quality.subtitles.decision, 'none', 'No captions are invented for a silent source.');
    outputs.push({ id, start: file.processing.start, end: file.processing.end, frames: Number(video.nb_read_frames), width: video.width, height: video.height });
  }
  assert.equal(outputs[0].start, 0); assert.equal(outputs.at(-1).end, 2940);
  outputs.forEach((clip, index) => {
    assert.ok(clip.end - clip.start >= 120 && clip.end - clip.start <= 180);
    if (index) assert.equal(clip.start, outputs[index - 1].end);
  });
  const proof = { syntheticMechanicsOnly: true, sourceDurationSeconds: 2940, sourceFramesPerSecond: 1,
    actualFfmpegInterrupted: true, retainedClips: retained.length, clips: outputs, fullOutputDecodePassed: true,
    realSpeechOrSubjectTrackingTested: false, providerCalls: 0 };
  console.log(JSON.stringify(proof));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  clearTimeout(deadline);
  for (const child of activeChildren) child.kill();
  mock.restoreAll(); process.chdir(project);
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('phoenix-episode-proof-'));
  fs.rmSync(temporary, { recursive: true, force: true });
});

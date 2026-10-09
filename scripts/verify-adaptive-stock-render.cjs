// Isolated synthetic mechanics proof only. Never reads owner jobs, keys or media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const project = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-adaptive-render-'));
const ffmpeg = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const ffprobe = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
process.env.PHOENIX_FFMPEG_PATH = ffmpeg;
process.env.PHOENIX_FFPROBE_PATH = ffprobe;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
// Resolve all runtime stores only after changing into the isolated fixture.
process.chdir(temp);
const resources = require('../src/lib/renderResources.ts');
const source = require('../src/lib/sourceProcessing.ts');
const reviews = require('../src/lib/reviewFiles.ts');
const automatic = require('../src/lib/automaticStockReel.ts');
function tool(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    resources.lowerChildProcessPriority(child.pid);
    let output = '', error = '';
    child.stdout.on('data', part => { output = (output + part).slice(-65536); });
    child.stderr.on('data', part => { error = (error + part).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(error)));
  });
}
async function main() {
  assert.ok(os.freemem() / 1048576 >= 900, 'Real render proof requires safe memory headroom; do not lower the limit.');
  global.fetch = async () => { throw new Error('Network forbidden in render mechanics proof.'); };
  const downloads = [];
  for (let index = 0; index < 8; index++) {
    const filename = path.join(temp, `source-${index}.mp4`);
    const color = ['forestgreen', 'blue', 'yellow', 'purple'][index % 4];
    await tool(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...resources.FFMPEG_FILTER_RESOURCE_ARGS,
      '-f', 'lavfi', '-i', index % 2 ? 'testsrc2=s=180x320:r=24' : `color=c=${color}:s=180x320:r=24`,
      '-t', '8', '-an', '-c:v', 'libx264', '-preset', 'veryfast', ...resources.FFMPEG_ENCODER_RESOURCE_ARGS, '-pix_fmt', 'yuv420p', filename]);
    downloads.push({ provider: 'pexels', mediaId: String(index + 1), sourcePage: `https://www.pexels.com/video/synthetic-fixture-${index + 1}/`,
      creator: 'Synthetic test fixture only', title: 'Synthetic test fixture', start: 0, end: 8, trimMode: 'auto',
      open: async () => ({ stream: Readable.toWeb(fs.createReadStream(filename)), expectedBytes: fs.statSync(filename).size }) });
  }
  const job = await source.createStockReelJob(downloads, { requestId: crypto.randomUUID(), caption: '', theme: 'mechanics only', maxDuration: 40, options: automatic.automaticStockReelOptions('forest') });
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id);
  assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  const output = reviews.outputPath(file.id, 'instagram');
  const media = JSON.parse(await tool(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,duration,nb_read_frames,width,height', '-of', 'json', output]));
  const picture = media.streams.find(stream => stream.codec_type === 'video');
  assert.ok(Number(picture.duration) >= 12 && Number(picture.duration) <= 32);
  assert.equal(Number(picture.nb_read_frames), Math.round(Number(picture.duration) * 24));
  assert.equal(picture.width, 720); assert.equal(picture.height, 1280);
  assert.ok(media.streams.some(stream => stream.codec_type === 'audio'));
  assert.deepEqual(file.quality.captions, []);
  assert.ok(file.quality.checks.some(check => /1\.25× playback/.test(check)), 'Measured still shots receive bounded acceleration');
  assert.ok(file.quality.checks.some(check => /1× playback/.test(check)), 'Meaningful movement keeps native speed');
  const checks = file.quality.checks.join(' ');
  assert.match(checks, /adaptive cadence/); assert.match(checks, /no fixed 45-second target/);
  const assembly = path.join(temp, 'storage', 'Phoenix Studio Review Files', 'work', `source-${job.id}`, 'stock-assembly-v2');
  assert.equal(fs.existsSync(path.join(assembly, 'shot-1.mp4')), false, 'Completed per-shot scratch is cleaned automatically');
  assert.equal(fs.existsSync(path.join(assembly, 'editable-master.mp4')), true, 'Editable master survives scratch cleanup');
  assert.equal(fs.existsSync(path.join(assembly, 'original-assembly.mp4')), true, 'Original assembly survives scratch cleanup');
  const before = fs.readFileSync(output);
  await source.updateJob(job.id, { status: 'FAILED', error: 'Synthetic interrupted-finalization fixture' });
  await source.retrySourceJob(job.id);
  await source.processNextSourceJob();
  const retried = await source.getSourceJob(job.id);
  assert.equal(retried.status, 'COMPLETED', retried.error);
  assert.deepEqual(retried.reviewIds, done.reviewIds);
  assert.deepEqual(fs.readFileSync(output), before, 'Retry reuses verified output and stable sampled movement');
  console.log(JSON.stringify({ syntheticMechanicsOnly: true, duration: Number(picture.duration), frames: Number(picture.nb_read_frames), speedAndAudioVerified: true, retryIdempotent: true, providerCalls: 0 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  process.chdir(project);
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('phoenix-adaptive-render-'));
  fs.rmSync(temp, { recursive: true, force: true });
});

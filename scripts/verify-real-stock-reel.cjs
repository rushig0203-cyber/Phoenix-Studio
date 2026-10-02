// Opt-in real portrait-footage proof through the production stock API/queue.
// No paid provider, replacement visuals, old failed-job retry or publication.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
assert.equal(path.resolve(process.cwd()), project, 'Use the canonical Phoenix project.');
require('@next/env').loadEnvConfig(project);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const source = require('../src/lib/sourceProcessing.ts');
const reviews = require('../src/lib/reviewFiles.ts');
const resources = require('../src/lib/renderResources.ts');
const route = require('../src/app/api/stock-reels/route.ts');
const ffmpeg = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const ffprobe = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
const proofDirectory = path.join(reviews.reviewRoot(), 'work', 'real-waterfall-reel-proof');
const requestId = '61b4a43c-40f1-4a2c-8552-4d12292b41ce';
const input = {
  requestId, caption: 'Water in motion: four different views of rushing water, rocky cascades and green forest.',
  theme: 'Different waterfall views; no claim that these are the same location', duration: 45,
  options: { audio: 'ambience-music', mood: 'reflective', transition: 'soft', framing: 'auto' },
  shots: [
    { provider: 'pixabay', id: 228847, start: 2, end: 12 },
    { provider: 'pexels', id: 37097027, start: 2, end: 10 },
    { provider: 'pexels', id: 19147886, start: 3, end: 15 },
    { provider: 'pexels', id: 28798096, start: 13, end: 28 },
  ],
};
function command(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true }); resources.lowerChildProcessPriority(child.pid);
    let output = '', error = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-128000); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-3000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(error || `Media tool exited ${code}`)));
  });
}
async function main() {
  const planOnly = process.argv.includes('--plan');
  if (!planOnly && os.freemem() < 1100 * 1048576) throw new Error('Real-footage verification defers below 1100 MiB free after imports; no apps were closed.');
  if ((await resources.heavyWorkStatus()).lease) throw new Error('Another heavy operation is active; no competing proof started.');
  await fs.mkdir(proofDirectory, { recursive: true });
  let job = await source.findStockSourceJob(requestId);
  const competing = (await source.readSourceJobs()).find(item => ['QUEUED', 'PROCESSING'].includes(item.status) && item.id !== job?.id);
  if (competing) throw new Error('An existing source job is waiting; it was not retried or reordered by this proof.');
  if (!job) {
    if (planOnly) throw new Error('Stage this proof first; --plan only updates its already-staged metadata.');
    const response = await route.POST(new Request('http://localhost:3000/api/stock-reels', {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The production stock API rejected this proof.');
    job = result.job;
  }
  if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status) || job.archivedAt) throw new Error(`Proof is ${job.status}: ${job.error || job.stage}. No automatic retry requested.`);
  if (job.status === 'QUEUED') {
    // Only this explicitly identified proof may refine its owner-selected trims
    // after the staged frames expose a slow opening. No other queue record changes.
    const shots = input.shots.map(wanted => {
      const saved = job.stockSource.shots.find(shot => shot.provider === wanted.provider && shot.mediaId === String(wanted.id));
      assert.ok(saved, 'A proof source changed; do not invent or substitute an asset.');
      return { ...saved, start: wanted.start, end: wanted.end };
    });
    job = await source.updateJob(job.id, { title: input.caption, stockSource: { ...job.stockSource, caption: input.caption, shots } });
  }
  const originalShots = job.stockSource.shots;
  await fs.writeFile(path.join(proofDirectory, 'staged-proof.json'), JSON.stringify({ requestId, jobId: job.id, input, shots: originalShots }, null, 2));
  if (planOnly) { console.log(JSON.stringify({ jobId: job.id, status: job.status, selectedSeconds: originalShots.map(shot => shot.end - shot.start), note: 'Only this queued proof plan was refined; no download/render/provider request.' })); return; }
  if (process.argv.includes('--stage')) {
    const result = await resources.tryWithLocalRenderSlot(async () => {
      for (const [index, shot] of originalShots.entries()) {
        await command(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-threads', '1', '-ss', String(shot.start + 1), '-i', reviews.sourcePath(job.id, shot.sourceFile), '-vf', 'scale=270:480', '-frames:v', '1', `source-${index + 1}.png`], proofDirectory);
      }
    }, 'Small real-footage proof previews');
    if (!result.acquired) throw new Error('Preview extraction deferred behind another operation. Staged footage remains saved.');
    console.log(JSON.stringify({ jobId: job.id, status: job.status, proofDirectory, shots: originalShots.length })); return;
  }
  let minimumFree = os.freemem();
  const sampler = setInterval(() => { minimumFree = Math.min(minimumFree, os.freemem()); }, 500);
  let last = '';
  const progress = setInterval(() => { void source.getSourceJob(job.id).then(current => {
    const message = `${current.progress}% ${current.stage}`;
    if (message !== last) { last = message; console.log(message); }
  }).catch(() => {}); }, 2000);
  try {
    if (job.status !== 'COMPLETED') await source.processNextSourceJob();
    job = await source.getSourceJob(job.id);
    assert.equal(job.status, 'COMPLETED', job.error || job.stage);
    const file = await reviews.getReviewFile(job.reviewIds[0]);
    const output = reviews.outputPath(file.id, 'instagram');
    const admitted = await resources.tryWithLocalRenderSlot(async () => {
      const media = JSON.parse(await command(ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,width,height,nb_read_frames', '-of', 'json', output]));
      const video = media.streams.find(stream => stream.codec_type === 'video');
      assert.equal(video.width, 720); assert.equal(video.height, 1280); assert.equal(Number(video.nb_read_frames), 1080);
      assert.ok(Math.abs(Number(media.format.duration) - 45) < .15);
      assert.equal(file.quality.visualSources.length, 4);
      for (const seconds of [5, 19, 28, 40]) await command(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-threads', '1', '-ss', String(seconds), '-i', output, '-vf', 'scale=270:480', '-frames:v', '1', `output-${seconds}.png`], proofDirectory);
      return { requestId, jobId: job.id, reviewId: file.id, output, duration: Number(media.format.duration), frames: Number(video.nb_read_frames),
        credits: file.quality.visualSources, audio: file.quality.audio, subtitles: file.quality.subtitles, postCopy: file.quality.postCopy,
        hashtags: file.quality.hashtags, checks: file.quality.checks, minimumFreeMiB: Math.floor(minimumFree / 1048576),
        note: 'Actual portrait footage, production stock API and local renderer; no automatic publication. Four representative stills do not establish full motion/audio quality.' };
    }, 'Completed real-footage validation');
    if (!admitted.acquired) throw new Error('Output ready; verification deferred behind another operation.');
    await fs.writeFile(path.join(proofDirectory, 'proof.json'), JSON.stringify(admitted.value, null, 2));
    console.log(JSON.stringify({ output, reviewId: file.id, duration: admitted.value.duration, frames: admitted.value.frames, minimumFreeMiB: admitted.value.minimumFreeMiB }));
  } finally { clearInterval(sampler); clearInterval(progress); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

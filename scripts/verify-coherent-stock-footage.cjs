// Opt-in real licensed-footage proof, isolated from owner jobs/settings/providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...options }); resources.lowerChildProcessPriority(child.pid);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-32768); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Tool failed: ${code}`)));
  });
}
async function fixture(inputFile) {
  global.fetch = async () => { throw new Error('Provider/network access is forbidden in this proof.'); };
  const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
  const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
  const automatic = require(path.join(project, 'src/lib/automaticStockReel.ts'));
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const metadata = [];
  for (const shot of input.shots) {
    const media = JSON.parse(await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', shot.filename]));
    const picture = media.streams.find(stream => stream.codec_type === 'video');
    metadata.push({ provider: shot.provider, id: Number(shot.mediaId), title: shot.title, creator: shot.creator, sourcePage: shot.sourcePage,
      width: picture.width, height: picture.height, duration: Number(picture.duration || media.format.duration), previewUrl: shot.filename });
  }
  const candidates = [metadata[0], ...automatic.automaticStockCompanions(metadata[0], metadata.slice(1), input.query)];
  assert.ok(candidates.length >= 4, 'Existing related sources must support four real shots; do not substitute footage.');
  const selected = candidates.map(video => input.shots.find(shot => shot.provider === video.provider && shot.mediaId === String(video.id)));
  const options = automatic.automaticStockReelOptions(input.query);
  assert.equal(options.continuity, 'visual-v1');
  const job = await source.createStockReelJob(selected.map((shot, index) => ({ ...shot, start: 0, end: candidates[index].duration, trimMode: 'auto',
    open: async () => ({ stream: Readable.toWeb(fs.createReadStream(shot.filename)), expectedBytes: fs.statSync(shot.filename).size }) })),
    { requestId: require('node:crypto').randomUUID(), caption: '', theme: input.query, maxDuration: 40, options });
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id);
  assert.equal(done.status, 'COMPLETED', done.error || done.stage);
  const file = await reviews.getReviewFile(done.reviewIds[0]);
  const output = reviews.outputPath(file.id, 'instagram');
  await command(process.env.PHOENIX_FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  assert.equal(file.outputs.instagram.width, 720); assert.equal(file.outputs.instagram.height, 1280);
  assert.ok(file.outputs.instagram.videoDuration >= 12 && file.outputs.instagram.videoDuration <= 32);
  assert.equal(file.quality.captions.length, 0);
  assert.ok(file.quality.checks.some(check => /companions ordered by sampled boundary/.test(check)), 'Real appearance samples must work, not an unknown fallback.');
  assert.ok(file.quality.checks.some(check => /BPM instrumental/.test(check)));
  const visual = require(path.join(project, 'src/lib/stockVisualContinuity.ts'));
  const assembly = path.join(reviews.reviewRoot(), 'work', `source-${job.id}`, 'stock-assembly-v2');
  const expectedOrder = visual.stockVisualOrder(selected.map((_shot, index) => JSON.parse(fs.readFileSync(path.join(assembly, `appearance-${index + 1}.json`), 'utf8')).pair));
  assert.deepEqual(file.quality.visualSources.map(credit => credit.providerMediaId), expectedOrder.map(index => selected[index].mediaId), 'Real sampled order must be reflected in the finished footage/credits');
  assert.ok(!file.quality.visualSources.some(credit => /parking|ferris|amusement/.test(credit.providerUrl)));
  const before = fs.readFileSync(output);
  await source.updateJob(job.id, { status: 'FAILED', error: 'Isolated proof interrupted-finalization fixture' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  assert.equal((await source.getSourceJob(job.id)).status, 'COMPLETED');
  assert.deepEqual(fs.readFileSync(output), before, 'Saved measured order and completed output must be idempotent.');
  await command(process.env.PHOENIX_FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', output,
    '-vf', 'fps=1/2,scale=160:284,tile=4x2', '-frames:v', '1', '-filter_threads', '1', path.join(process.cwd(), 'after.png')]);
  return { output, screenshot: path.join(process.cwd(), 'after.png'), duration: file.outputs.instagram.videoDuration,
    selected: selected.map(shot => shot.title), excluded: input.shots.filter(shot => !selected.includes(shot)).map(shot => shot.title),
    checks: file.quality.checks, credits: file.quality.visualSources, fullyDecoded: true, retryIdempotent: true, providerCalls: 0,
    note: 'Real existing licensed footage, isolated queue only; no owner jobs retried or posted. Colour matching is not semantic recognition or a views prediction.' };
}
async function main() {
  if (process.argv.includes('--fixture')) {
    const result = await fixture(process.argv[process.argv.indexOf('--fixture') + 1]); console.log(JSON.stringify(result)); return;
  }
  assert.equal(path.resolve(process.cwd()), project);
  assert.ok(os.freemem() / 1048576 >= 900, 'The isolated real-footage proof needs 900 MiB free after imports; no guard is lowered.');
  const jobId = process.argv[process.argv.indexOf('--job') + 1]; assert.match(jobId || '', /^[a-f0-9-]{36}$/i);
  const review = path.join(project, 'storage', 'Phoenix Studio Review Files');
  const job = JSON.parse(fs.readFileSync(path.join(review, 'source-processing-jobs.json'), 'utf8')).find(item => item.id === jobId);
  assert.equal(job?.status, 'COMPLETED', 'Only an explicitly named completed source can supply a read-only proof.');
  assert.ok(!job.archivedAt && job.stockSource?.shots?.length >= 4);
  const proof = fs.mkdtempSync(path.join(project, 'storage', 'work', 'coherent-stock-proof-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-coherent-footage-'));
  const input = { query: job.stockSource.theme || job.title, shots: job.stockSource.shots.map(shot => {
    assert.equal(path.basename(shot.sourceFile), shot.sourceFile);
    const filename = path.join(review, 'sources', `${job.id}-${shot.sourceFile}`);
    assert.ok(fs.statSync(filename).isFile()); return { ...shot, filename };
  }) };
  const inputFile = path.join(proof, 'input.json'); fs.writeFileSync(inputFile, JSON.stringify(input));
  try {
    const result = await resources.tryWithLocalRenderSlot(async () => {
      const evidence = JSON.parse(await command(process.execPath, ['--max-old-space-size=192', __filename, '--fixture', inputFile], { cwd: scratch }));
      for (const [key, filename] of [['output', 'coherent-reel.mp4'], ['screenshot', 'after.png']]) {
        const retained = path.join(proof, filename); fs.copyFileSync(evidence[key], retained); evidence[key] = retained;
      }
      fs.writeFileSync(path.join(proof, 'proof.json'), JSON.stringify(evidence, null, 2));
      return { proof, output: evidence.output, duration: evidence.duration, selected: evidence.selected, excluded: evidence.excluded, fullyDecoded: true, retryIdempotent: true, providerCalls: 0 };
    }, 'Isolated real footage quality verification');
    assert.ok(result.acquired, 'Shared heavy-work slot unavailable; no competing render started.');
    console.log(JSON.stringify(result.value));
  } finally {
    assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(scratch).startsWith('phoenix-coherent-footage-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

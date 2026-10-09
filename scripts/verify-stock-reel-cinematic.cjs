// Opt-in real-footage proof. Reuses four already staged licensed sources;
// no network/provider calls, existing-job changes, model loads or publication.
// The canonical heavy-work lease covers the isolated short-path fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...options });
    resources.lowerChildProcessPriority(child.pid);
    const chunks = []; let error = '';
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || `Media tool exited ${code}`)));
  });
}
const ffmpeg = args => command(process.env.PHOENIX_FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', ...resources.FFMPEG_FILTER_RESOURCE_ARGS, ...args]);
async function fixture() {
  // Keep this artistic/technical proof independent of quotas and credentials.
  global.fetch = async () => { throw new Error('Network is disabled for this local proof.'); };
  const input = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--fixture') + 1], 'utf8'));
  const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
  const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
  const options = input.minimum40
    ? { ...require(path.join(project, 'src/lib/automaticStockReel.ts')).automaticStockReelOptions(input.cadence40 ? 'sun' : 'waterfall'), ...(input.cadence40 ? { audio: 'music' } : {}) }
    : { audio: 'auto', mood: 'reflective', transition: 'cut', framing: 'auto', pacing: 'cinematic' };
  // These documented five/seven-source proofs exercise the original saved
  // 40s recipe, not the new eight-to-ten-source brisk/reuse admission policy.
  if (input.minimum40) { delete options.shotCadence; delete options.reusePolicy; }
  const job = await source.createStockReelJob(input.shots.map(shot => ({
    provider: shot.provider, mediaId: shot.mediaId, title: shot.title, creator: shot.creator,
    sourcePage: shot.sourcePage, start: shot.start, end: shot.end, trimMode: 'auto',
    open: async () => ({ stream: Readable.toWeb(fs.createReadStream(shot.filename)), expectedBytes: fs.statSync(shot.filename).size }),
  })), { requestId: crypto.randomUUID(), caption: input.cadence40 ? 'Sunlight across skies and landscapes.' : 'Water flowing through forest and over rocky cascades.', theme: input.cadence40 ? 'Sunlight and landscapes; technical native-cadence proof' : 'Related waterfall moments; not a claim of one location', maxDuration: 45, options });
  let minimumFree = os.freemem();
  const sampler = setInterval(() => { minimumFree = Math.min(minimumFree, os.freemem()); }, 250);
  const startedAt = Date.now();
  try {
    await source.processNextSourceJob();
    const done = await source.getSourceJob(job.id);
    assert.equal(done.status, 'COMPLETED', done.error || done.stage);
    const file = await reviews.getReviewFile(done.reviewIds[0]);
    const output = reviews.outputPath(file.id, 'instagram');
    const media = JSON.parse((await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames,sample_rate,channels', '-of', 'json', output])).toString());
    const video = media.streams.find(stream => stream.codec_type === 'video');
    const audio = media.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(video.width, 720); assert.equal(video.height, 1280);
    assert.equal(video.codec_name, 'h264'); assert.equal(video.pix_fmt, 'yuv420p');
    const expectedFrames = input.minimum40 ? 960 : 528;
    assert.equal(Number(video.nb_read_frames), expectedFrames);
    assert.ok(Math.abs(Number(media.format.duration) - expectedFrames / 24) < .15);
    assert.equal(audio.codec_name, 'aac'); assert.equal(Number(audio.sample_rate), 48000); assert.equal(audio.channels, 2);
    assert.equal(file.quality.visualSources.length, input.shots.length); assert.equal(file.quality.captions.length, 0);
    assert.equal(file.quality.postCopy, input.cadence40 ? 'Sunlight across skies and landscapes.' : 'Water flowing through forest and over rocky cascades.');
    assert.doesNotMatch(file.quality.postCopy, /Shot \d+:|pexels\.com|pixabay\.com|Footage source/);
    // Decode every frame and audio packet, not only a metadata header/still.
    await ffmpeg(['-threads', '1', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    const master = path.join(reviews.reviewRoot(), file.artifacts.editing.video);
    const pictureHash = filename => ffmpeg(['-threads', '1', '-i', filename, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);
    const masterProbe = JSON.parse((await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels', '-of', 'json', master])).toString());
    assert.equal((await pictureHash(output)).toString(), (await pictureHash(master)).toString(), `Caption-free picture must survive as a remux, not another encode: ${JSON.stringify(masterProbe)}`);
    const stillTimes = input.minimum40 ? [2, 10, 18, 34] : [2, 7, 12.5, 18];
    for (const [index, seconds] of stillTimes.entries()) {
      await ffmpeg(['-y', '-ss', String(seconds), '-threads', '1', '-i', output, '-vf', 'scale=270:480', '-frames:v', '1', `shot-${index + 1}.png`]);
    }
    console.log(JSON.stringify({ output, stills: [1, 2, 3, 4].map(index => path.join(process.cwd(), `shot-${index}.png`)),
      music: path.join(reviews.reviewRoot(), file.artifacts.music), duration: Number(media.format.duration), frames: Number(video.nb_read_frames),
      sourceSeconds: input.cadence40 ? undefined : input.minimum40 ? [8, 8, 8, 8, 8] : [5, 5.5, 4.5, 7], format: '720x1280 / 24 fps / H.264 / stereo AAC',
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), minimumFreeMiB: Math.floor(minimumFree / 1048576),
      pictureRemuxVerified: true, fullyDecoded: true, credits: file.quality.visualSources, copy: file.quality.postCopy, hashtags: file.quality.hashtags,
      note: 'Real licensed footage at native speed, no subtitles for silent nature footage. Related sources are not claimed to be the same location. This is not a views/income prediction.' }));
  } finally { clearInterval(sampler); }
}
async function main() {
  if (process.argv.includes('--fixture')) return fixture();
  assert.equal(path.resolve(process.cwd()), project, 'Use the canonical project to reserve its heavy-work slot.');
  const freeMiB = Math.floor(os.freemem() / 1048576);
  assert.ok(freeMiB >= 1100, `Only ${freeMiB} MiB free after imports; the real-footage proof needs 1100 MiB.`);
  assert.equal((await resources.heavyWorkStatus()).lease, null, 'Another heavy operation is active; proof deferred.');
  const root = path.join(project, 'storage', 'Phoenix Studio Review Files');
  const cadence40 = process.argv.includes('--cadence40');
  const minimum40 = process.argv.includes('--minimum40') || cadence40;
  const staged = JSON.parse(fs.readFileSync(path.join(root, 'work/real-waterfall-reel-proof/staged-proof.json'), 'utf8'));
  assert.equal(staged.requestId, '61b4a43c-40f1-4a2c-8552-4d12292b41ce');
  assert.equal(staged.shots.length, 4);
  let selections = staged.shots.map(shot => ({ ...shot, jobId: staged.jobId }));
  if (cadence40) {
    const jobs = JSON.parse(fs.readFileSync(path.join(root, 'source-processing-jobs.json'), 'utf8'));
    const saved = jobs.find(job => job.id === 'b86db042-aeee-417b-bc97-d215130131e3');
    assert.equal(saved?.stockSource?.shots?.length, 7, 'The previously saved cadence sources are required; no owner job is retried.');
    selections = saved.stockSource.shots.map(shot => ({ ...shot, jobId: saved.id }));
  } else if (minimum40) {
    const jobs = JSON.parse(fs.readFileSync(path.join(root, 'source-processing-jobs.json'), 'utf8'));
    // Five distinct, previously downloaded waterfall sources; no redownload,
    // synthetic picture, repeat, canonical queue change or failed-job retry.
    const wanted = ['pexels:28798096', 'pexels:19181145', 'pexels:34257551', 'pixabay:228847', 'pexels:37097027'];
    selections = wanted.map(identity => {
      for (const job of jobs) {
        const shot = job.stockSource?.shots?.find(shot => `${shot.provider}:${shot.mediaId}` === identity);
        if (shot) return { ...shot, jobId: job.id, start: 0, trimMode: 'auto' };
      }
      throw new Error(`Saved related source ${identity} is unavailable; no provider request attempted.`);
    });
  }
  const input = { minimum40, cadence40, shots: selections.map(shot => {
    assert.match(shot.jobId, /^[a-f0-9-]{36}$/i);
    assert.equal(path.basename(shot.sourceFile), shot.sourceFile);
    const filename = path.resolve(root, 'sources', `${shot.jobId}-${shot.sourceFile}`);
    assert.ok(filename.startsWith(path.join(root, 'sources') + path.sep));
    assert.ok(fs.statSync(filename).isFile(), 'Previously staged source is missing; no redownload was attempted.');
    return { ...shot, filename };
  }) };
  const proof = fs.mkdtempSync(path.join(root, 'work', 'cinematic-stock-proof-'));
  const inputPath = path.join(proof, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-cinematic-'));
  try {
    await resources.withLocalRenderSlot(async () => {
      const evidence = JSON.parse((await command(process.execPath, ['--max-old-space-size=192', __filename, '--fixture', inputPath], { cwd: scratch })).toString().trim());
      for (const [key, filename] of [['output', cadence40 ? 'sun-cadence-reel.mp4' : 'waterfall-reel.mp4'], ['music', 'original-instrumental.wav']]) {
        const retained = path.join(proof, filename); fs.copyFileSync(evidence[key], retained); evidence[key] = retained;
      }
      evidence.stills = evidence.stills.map((filename, index) => {
        const retained = path.join(proof, `shot-${index + 1}.png`); fs.copyFileSync(filename, retained); return retained;
      });
      fs.writeFileSync(path.join(proof, 'proof.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
    }, 'Real cinematic stock reel verification');
  } finally {
    // Delete only this isolated, newly created test workspace after evidence is retained.
    assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(scratch).startsWith('ps-cinematic-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

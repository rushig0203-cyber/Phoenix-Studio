// Opt-in, public licensed Pexels proof. No owner media, settings, keys or jobs.
// Run on an isolated CI runner with PHOENIX_QUALITY_PROOF_DIR=<absent absolute
// path outside this project named phoenix-public-quality-...>. Never post.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const project = fs.realpathSync(path.resolve(__dirname, '..'));
assert.equal(process.env.CI, 'true', 'This public quality proof runs only on an isolated CI runner.');
assert.equal(process.argv.length, 2, 'The public fixture accepts no source URLs or other command arguments.');
const within = (child, parent) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const requested = process.env.PHOENIX_QUALITY_PROOF_DIR;
assert.ok(requested && path.isAbsolute(requested), 'Set an absolute isolated proof output directory.');
const destination = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
assert.match(path.basename(destination), /^phoenix-public-quality-[A-Za-z0-9-]+$/);
assert.ok(!within(destination, project) && !fs.existsSync(destination), 'Proof output must be new and outside the project.');
fs.mkdirSync(destination);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-public-footage-'));
assert.equal(path.dirname(fs.realpathSync(scratch)), fs.realpathSync(os.tmpdir()));
process.chdir(scratch); // Resolve every runtime store only inside this fixture.
const ffmpeg = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const ffprobe = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
process.env.PHOENIX_FFMPEG_PATH = ffmpeg; process.env.PHOENIX_FFPROBE_PATH = ffprobe;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const automatic = require(path.join(project, 'src/lib/automaticStockReel.ts'));
const planning = require(path.join(project, 'src/lib/stockReel.ts'));
const visual = require(path.join(project, 'src/lib/stockVisualContinuity.ts'));
const movement = require(path.join(project, 'src/lib/stockMotion.ts'));
const fixtures = [
  [36918287, 'man strolling in lush green park with blossoming trees', 'Nishant Aneja', '36918287/15639615_720_1280_60fps.mp4'],
  [13712406, 'city park and skyscrapers', 'Julio Lopez', '13712406/13712406-hd_720_1280_30fps.mp4'],
  [31980579, 'tranquil walk through a green city park', 'Earth Photart', '31980579/13627386_720_1280_30fps.mp4'],
  [3699513, 'people enjoying their day in a park', 'George Morina', '3699513/3699513-hd_1280_720_30fps.mp4'],
  [4085166, 'people flowers garden park', 'George Morina', '4085166/4085166-hd_1280_720_30fps.mp4'],
  [13439228, 'park in city in birds eye view', 'Marc Espejo', '13439228/13439228-hd_1280_720_30fps.mp4'],
  [37195943, 'aerial view of lush green urban park with fountain', 'Juan Camilo Trujillo Botero', '37195943/15757011_1280_720_30fps.mp4'],
  [36659594, 'tree by roadside in sunny park setting', 'BJ Zurc', '36659594/15541679_720_958_30fps.mp4'],
  [35995053, 'tranquil park scene with lush greenery', 'Raaj Ugar', '35995053/15262479_720_1280_30fps.mp4'],
  [4085318, 'people flowers garden park', 'George Morina', '4085318/4085318-hd_1280_720_30fps.mp4'],
  [39633057, 'sunny park with picnic tables and trees', 'Sururi Ballıdağ Director', '39633057/16895589_1280_720_50fps.mp4'],
].map(([id, title, creator, cdn]) => ({ provider: 'pexels', id, title, creator,
  sourcePage: `https://www.pexels.com/video/${title.replaceAll(' ', '-')}-${id}/`, previewUrl: `https://videos.pexels.com/video-files/${cdn}` }));
function tool(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true }); resources.lowerChildProcessPriority(child.pid);
    let output = '', error = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-65536); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(output) : reject(new Error(error || `Media tool failed (${code}).`)));
  });
}
async function probe(filename, count = false) {
  const data = JSON.parse(await tool(ffprobe, ['-v', 'error', ...(count ? ['-count_frames'] : []), '-show_entries',
    'format=duration:stream=codec_type,avg_frame_rate,width,height,duration,nb_frames,nb_read_frames', '-of', 'json', filename]));
  const video = data.streams.find(stream => stream.codec_type === 'video'); assert.ok(video, 'Public fixture has no picture.');
  const [numerator, denominator] = (video.avg_frame_rate || '0/1').split('/').map(Number);
  const frameRate = denominator ? numerator / denominator : undefined;
  const seconds = Number(video.duration), frameSeconds = frameRate && Number(video.nb_frames) / frameRate;
  return { duration: Number(data.format.duration), videoDuration: seconds > 0 ? seconds : frameSeconds > 0 ? frameSeconds : undefined,
    width: video.width, height: video.height, frameRate, frames: Number(video.nb_read_frames), hasAudio: data.streams.some(stream => stream.codec_type === 'audio') };
}
let totalBytes = 0;
async function download(video) {
  const url = new URL(video.previewUrl);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'videos.pexels.com'); assert.ok(!url.username && !url.password);
  let response;
  try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(90000) }); }
  catch { throw new Error(`Public fixture ${video.id} could not be downloaded.`); }
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('video/')) {
    await response.body?.cancel(); throw new Error(`Public fixture ${video.id} is unavailable.`);
  }
  const maximum = 40 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) { await response.body.cancel(); throw new Error('Public fixture exceeds its bounded download size.'); }
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length; totalBytes += chunk.length;
    callback(bytes > maximum || totalBytes > 200 * 1024 * 1024 ? new Error('Public fixture download exceeds the proof byte limit.') : null, chunk);
  } });
  const filename = path.join(scratch, `public-${video.id}.mp4`);
  await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(filename, { flags: 'wx' }));
  const info = await probe(filename); assert.ok(Math.min(info.width, info.height) >= 720 && info.videoDuration > 0);
  return { ...video, width: info.width, height: info.height, duration: info.videoDuration, filename, bytes };
}
async function main() {
  assert.ok(os.freemem() / 1048576 >= 900, 'Public proof needs 900 MiB free after runtime imports; no safety limit is lowered.');
  const downloaded = [];
  for (const fixture of fixtures) downloaded.push(await download(fixture)); // One streamed download at a time.
  global.fetch = async () => { throw new Error('Further network/provider calls are forbidden in the isolated render.'); };
  const selected = [downloaded[0], ...automatic.automaticStockCompanions(downloaded[0], downloaded.slice(1), 'Parks').slice(0, 9)];
  assert.ok(selected.length >= 4 && selected.length <= 10); assert.equal(selected[0].id, 36918287);
  assert.ok(!selected.some(video => [13712406, 36659594].includes(video.id)), 'Skyline and roadside footage must not pass the chosen green-park setting.');
  const options = automatic.automaticStockReelOptions('Parks'); assert.equal(options.continuity, 'visual-v1');
  assert.equal(automatic.automaticStockGreeneryFocus(selected[0]), true); options.sceneFocus = 'greenery'; options.background = 'soft-v1';
  const job = await source.createStockReelJob(selected.map(video => ({ provider: video.provider, mediaId: String(video.id), title: video.title,
    creator: video.creator, sourcePage: video.sourcePage, start: 0, end: video.duration, trimMode: 'auto',
    open: async () => ({ stream: Readable.toWeb(fs.createReadStream(video.filename)), expectedBytes: video.bytes }) })),
    { requestId: crypto.randomUUID(), caption: '', theme: 'Parks', maxDuration: 40, options });
  await source.processNextSourceJob(); const done = await source.getSourceJob(job.id);
  assert.equal(done.status, 'COMPLETED', done.error || done.stage);
  const file = await reviews.getReviewFile(done.reviewIds[0]), output = reviews.outputPath(file.id, 'instagram');
  const info = await probe(output, true);
  assert.equal(info.width, 720); assert.equal(info.height, 1280); assert.equal(info.frameRate, 24);
  assert.ok(info.videoDuration >= 12 && info.videoDuration <= 32 && info.hasAudio);
  assert.equal(info.frames, Math.round(info.videoDuration * 24)); assert.deepEqual(file.quality.captions, []);
  assert.ok(file.quality.checks.some(check => /one continuous bed across every shot/.test(check)));
  await tool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const assembly = path.join(reviews.reviewRoot(), 'work', `source-${job.id}`, 'stock-assembly-v2');
  let shots = job.stockSource.shots, bounds = [], motion = [], stats = [];
  for (let index = 0; index < shots.length; index++) {
    const filename = path.join(reviews.reviewRoot(), 'sources', `${job.id}-${shots[index].sourceFile}`);
    bounds.push(source.stockSourcePictureInterval(shots[index], await probe(filename), 12, index + 1)); stats.push(fs.statSync(filename));
    motion.push(JSON.parse(fs.readFileSync(path.join(assembly, `motion-${index + 1}.json`), 'utf8')).windows);
  }
  assert.ok(motion.every(windows => windows.length && windows.every(window => Number.isFinite(window.greenFraction))), 'Real tiny RGB evidence must decode for each public source.');
  const greenery = movement.stockGreenerySelection(motion);
  console.log(JSON.stringify({ publicColourSamples: shots.map((shot, index) => ({ id: shot.mediaId, windows: motion[index] })), threshold: greenery.threshold, retainedIndices: greenery.indices }));
  const omittedAtRender = shots.filter((_shot, index) => !greenery.indices.includes(index)).map(shot => shot.mediaId);
  shots = greenery.indices.map(index => shots[index]); bounds = greenery.indices.map(index => bounds[index]);
  stats = greenery.indices.map(index => stats[index]); motion = greenery.windows;
  assert.ok(shots.length >= 4 && omittedAtRender.includes('3699513'), 'The grey bare-tree source must not survive green-context sampling.');
  const provisional = planning.planStockIntervals(bounds.map((part, index) => ({ ...part, motionWindows: motion[index] })), 40, 'cinematic', undefined,
    'adaptive-v2', { bpm: planning.stockMusicArrangement(options.mood, job.id).bpm });
  const appearance = shots.map((shot, index) => {
    const cache = JSON.parse(fs.readFileSync(path.join(assembly, `appearance-${index + 1}.json`), 'utf8'));
    const identity = crypto.createHash('sha256').update(JSON.stringify({ version: 1, filename: shot.sourceFile, bytes: stats[index].size,
      modified: stats[index].mtimeMs, start: provisional[index].start, end: provisional[index].end })).digest('hex');
    assert.equal(cache.identity, identity, 'Appearance evidence must identify the exact sampled source bounds.'); return cache.pair;
  });
  const order = visual.stockVisualOrder(appearance), intervals = planning.reorderStockIntervals(provisional, order);
  assert.deepEqual(file.quality.visualSources.map(credit => credit.providerMediaId), order.map(index => shots[index].mediaId));
  intervals.forEach((interval, index) => {
    const check = file.quality.checks.find(text => text.startsWith(`Shot ${index + 1}:`) && text.includes('playback;'));
    assert.ok(check?.includes(`; ${interval.start.toFixed(3)}s–${interval.end.toFixed(3)}s;`), 'Finished cuts must preserve the measured appearance endpoints.');
  });
  const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), before = hash(output);
  await source.updateJob(job.id, { status: 'FAILED', error: 'Isolated public proof interrupted-finalization fixture' });
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  const retried = await source.getSourceJob(job.id); assert.equal(retried.status, 'COMPLETED'); assert.deepEqual(retried.reviewIds, done.reviewIds);
  assert.equal(hash(output), before, 'Fixture retry must retain the verified output exactly.');
  const edited = path.join(destination, 'coherent-reel.mp4'), contact = path.join(destination, 'after.jpg');
  fs.copyFileSync(output, edited);
  const midpointFrames = intervals.map(interval => Math.floor((interval.outputStart + interval.outputEnd) / 2 * planning.STOCK_REEL_FPS));
  assert.equal(new Set(midpointFrames).size, intervals.length, 'Each source interval needs its own midpoint preview.');
  assert.ok(midpointFrames.every(frame => Number.isSafeInteger(frame) && frame >= 0 && frame < info.frames));
  const columns = Math.ceil(intervals.length / 2), rows = 2;
  const midpointSelect = midpointFrames.map(frame => `eq(n,${frame})`).join('+');
  await tool(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', output, '-vf',
    `select='${midpointSelect}',setpts=N/FRAME_RATE/TB,scale=160:284,tile=${columns}x${rows}:nb_frames=${intervals.length}:padding=2:margin=2`,
    '-frames:v', '1', '-filter_threads', '1', '-q:v', '3', contact]);
  fs.writeFileSync(path.join(destination, 'proof.json'), JSON.stringify({ publicLicensedFixture: true, licence: 'https://www.pexels.com/license/',
    selected: selected.map(({ id, title, creator, sourcePage, previewUrl, width, height, duration }) => ({ id, title, creator, sourcePage, previewUrl, width, height, duration })),
    excludedAtSelection: downloaded.filter(video => !selected.includes(video)).map(({ id, title }) => ({ id, title })),
    omittedAtRender, greeneryThreshold: greenery.threshold,
    duration: info.videoDuration, frames: info.frames, order, sourceIntervals: intervals, checks: file.quality.checks, sha256: before,
    contactSheet: { sampling: 'One midpoint frame from every final source interval, in output order', columns, rows, midpointFrames },
    fullyDecoded: true, retryIdempotent: true, ownerJobsRead: 0, ownerMediaUploaded: 0,
    note: 'Public licensed source proof only; pixel statistics do not prove semantic continuity or predict audience performance.' }, null, 2));
  assert.deepEqual(fs.readdirSync(destination).sort(), ['after.jpg', 'coherent-reel.mp4', 'proof.json']);
  console.log(JSON.stringify({ publicLicensedFixture: true, duration: info.videoDuration, frames: info.frames, shots: shots.length,
    fullyDecoded: true, retryIdempotent: true, ownerMediaUploaded: 0, retainedArtifacts: 3 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  process.chdir(project);
  assert.equal(path.dirname(fs.realpathSync(scratch)), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(scratch), /^phoenix-public-footage-[A-Za-z0-9]+$/);
  assert.ok(!fs.lstatSync(scratch).isSymbolicLink()); fs.rmSync(scratch, { recursive: true, force: true });
});

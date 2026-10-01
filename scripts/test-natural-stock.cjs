const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const project = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-natural-stock-'));
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(temporary);
const stock = require(path.join(project, 'src/lib/naturalStock.ts'));
const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
const ideas = require(path.join(project, 'src/lib/contentIdeas.ts'));
const realFetch = global.fetch;
test('source captions use actual canvas pixels and a restrained two-line lower placement', () => {
  const ass = source.sourceCaptionAss([{ start: 0, end: 60, lines: ['A waterfall flowing', 'through a green valley'] }], 720, 1280);
  assert.match(ass, /PlayResX: 720\nPlayResY: 1280/);
  assert.match(ass, /Style: Default,Arial,30,/);
  assert.match(ass, /,2,50,50,102,1/);
  assert.match(ass, /A waterfall flowing\\Nthrough a green valley/);
  assert.match(source.sourceCaptionAss([], 1920, 1080), /Default,Arial,45,/);
});
after(() => { global.fetch = realFetch; process.chdir(project); fs.rmSync(temporary, { recursive: true, force: true }); });

test('ideas cover ten categories with balanced initial suggestions and reviewed topics demoted', () => {
  assert.ok(ideas.CONTENT_IDEAS.length >= 40);
  assert.equal(new Set(ideas.CONTENT_IDEAS.map(idea => idea.category)).size, 10);
  assert.equal(new Set(ideas.contentIdeas([]).slice(0, 6).map(idea => idea.category)).size, 6);
  const first = ideas.CONTENT_IDEAS[0];
  assert.notEqual(ideas.contentIdeas([first.title])[0].id, first.id);
  assert.ok(ideas.contentIdeas([], 'Small business').every(idea => idea.workflow === 'business'));
});

test('stock feedback does not instruct business videos to use two animal characters', () => {
  const { guidanceFromFeedback } = require(path.join(project, 'src/lib/qualityManager.ts'));
  const feedback = [{ reviewId: 'fixture', creationType: 'business', decision: 'revise', ratings: { story: 1, visuals: 1, audio: 3, captions: 3 } }];
  const guidance = guidanceFromFeedback(feedback, 'business');
  assert.match(guidance.rules.join(' '), /coherent visual treatment/);
  assert.match(guidance.rules.join(' '), /Preserve a setting and subject for a continuing action/);
  assert.match(guidance.rules.join(' '), /comparisons may show different relevant examples/);
  assert.doesNotMatch(guidance.rules.join(' '), /animal|kite/);
});

test('Pixabay chooses a 720p-class rendition and rejects arbitrary media hosts', () => {
  const result = stock.pixabayChoice({ id: 10, duration: 20, tags: 'waterfall, forest', pageURL: 'https://pixabay.com/videos/waterfall-10/', user: 'Test creator', videos: { large: { width: 3840, height: 2160, url: 'https://cdn.pixabay.com/video/large.mp4' }, medium: { width: 1280, height: 720, url: 'https://cdn.pixabay.com/video/medium.mp4' } } });
  assert.equal(result.width, 1280); assert.equal(result.provider, 'pixabay');
  assert.throws(() => stock.trustedStockUrl('http://localhost/private', 'pixabay'), /untrusted/);
  assert.throws(() => stock.trustedStockUrl('https://cdn.pixabay.com.evil.test/file.mp4', 'pixabay'), /untrusted/);
});

test('unified search uses both providers and retains successful results when one is unavailable', async () => {
  process.env.PEXELS_API_KEY = 'test-only-key'; process.env.PIXABAY_API_KEY = 'test-only-key';
  global.fetch = async url => {
    if (new URL(url).hostname === 'pixabay.com') return new Response('', { status: 429 });
    return Response.json({ videos: [{ id: 20, duration: 30, image: 'https://images.pexels.com/videos/20/preview.jpg', url: 'https://www.pexels.com/video/waterfall-20/', user: { name: 'Test creator' }, video_files: [{ width: 1280, height: 720, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/20/720.mp4' }] }] });
  };
  const api = require(path.join(project, 'src/app/api/stock-reels/route.ts'));
  const response = await api.GET(new Request('http://localhost/api/stock-reels?q=waterfall'));
  const body = await response.json();
  assert.equal(body.videos.length, 1); assert.equal(body.videos[0].provider, 'pexels');
  assert.match(body.errors[0], /429/); assert.doesNotMatch(JSON.stringify(body), /test-only-key/);
  const denied = await api.POST(new Request('http://localhost/api/stock-reels', { method: 'POST', headers: { origin: 'https://untrusted.example' }, body: '{}' }));
  assert.equal(denied.status, 400);
  global.fetch = realFetch;
});

for (const hasAudio of [true, false]) test(`real source footage exports without any AI calls, audio ${hasAudio ? 'preserved' : 'replaced with local music'}`, async () => {
  global.fetch = async () => { throw new Error('No model or external request should run while processing natural stock'); };
  const video = path.join(temporary, `fixture-${hasAudio}.mp4`);
  const args = ['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=12'];
  if (hasAudio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3');
  args.push('-t', '3', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p');
  if (hasAudio) args.push('-c:a', 'aac');
  args.push(video);
  const command = spawnSync(process.env.PHOENIX_FFMPEG_PATH, args, { windowsHide: true, encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  const details = { provider: 'pixabay', mediaId: hasAudio ? '100' : '101', sourcePage: 'https://pixabay.com/videos/green-fixture-100/', creator: 'Test fixture', requestId: crypto.randomUUID(), caption: 'A green video test fixture', maxDuration: 60 };
  const job = await source.createSourceJob(Readable.toWeb(fs.createReadStream(video)), path.basename(video), 'coverage', details.caption, fs.statSync(video).size, details);
  const duplicate = await source.createSourceJob(Readable.toWeb(fs.createReadStream(video)), path.basename(video), 'coverage', details.caption, fs.statSync(video).size, details);
  assert.equal(duplicate.id, job.id);
  await source.processNextSourceJob();
  const completed = await source.getSourceJob(job.id);
  assert.equal(completed.status, 'COMPLETED', completed.error);
  assert.equal(completed.reviewIds.length, 1);
  const file = await reviews.getReviewFile(completed.reviewIds[0]);
  assert.equal(file.source.kind, 'pixabay');
  assert.equal(file.source.providerMediaId, details.mediaId);
  assert.equal(file.outputs.instagram.width, 720); assert.equal(file.outputs.instagram.height, 1280);
  assert.ok(Math.abs(file.outputs.instagram.duration - 3) < .2);
  assert.equal(file.quality.audio, hasAudio ? 'natural-audio-preserved' : 'local-music-replaced');
  assert.equal(file.quality.captions.length, 0, 'stock descriptions must never become speech subtitles');
  assert.equal(file.quality.subtitles.decision, hasAudio ? 'uncertain' : 'none');
  assert.ok(file.quality.postCopy.includes(details.caption));
  assert.ok(file.quality.hashtags.length > 1);
  assert.deepEqual(fs.readFileSync(reviews.sourcePath(job.id, job.sourceFile)), fs.readFileSync(video));
  // Simulate an interruption after the MP4 finished but before queue completion.
  file.quality.postCopy = 'Copy written from this particular finished video.';
  file.quality.hashtags = ['#SpecificVideo'];
  file.quality.postingAnalysis = { status: 'COMPLETE', fingerprint: 'fixture', attempts: 1, updatedAt: new Date().toISOString(), detail: 'Sampled frames checked.' };
  await reviews.saveReviewFile(file);
  const queuePath = path.join(reviews.reviewRoot(), 'source-processing-jobs.json');
  const savedJobs = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  savedJobs.find(item => item.id === job.id).status = 'FAILED';
  fs.writeFileSync(queuePath, JSON.stringify(savedJobs));
  await source.retrySourceJob(job.id); await source.processNextSourceJob();
  const retained = await reviews.getReviewFile(file.id);
  assert.equal(retained.quality.postCopy, file.quality.postCopy);
  assert.deepEqual(retained.quality.hashtags, file.quality.hashtags);
  assert.equal(retained.quality.postingAnalysis.status, 'COMPLETE');
  global.fetch = realFetch;
});

// Verify the public-footage/offline-voice proof through Phoenix's review and posting-copy paths.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');

const project = fs.realpathSync(path.resolve(__dirname, '..'));
const output = fs.realpathSync(process.env.PHOENIX_NATURE_PROOF_DIR || '');
assert.match(path.basename(output), /^phoenix-nature-mini-doc-[A-Za-z0-9-]+$/);
assert.ok(output !== project && !output.startsWith(project + path.sep));
const proof = JSON.parse(fs.readFileSync(path.join(output, 'proof.json'), 'utf8'));
const originalFetch = global.fetch;
process.chdir(output);
process.env.MPT_BASE_URL = 'http://127.0.0.1:8080';
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require(path.join(project, 'node_modules/ts-node')).register({ project: path.join(project, 'tsconfig.json'),
  transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require(path.join(project, 'node_modules/tsconfig-paths')).register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
const load = name => require(path.join(project, 'src/lib', name + '.ts'));

async function verify() {
  const { resolveCreationRecommendation } = load('creationRecommendations');
  const { readStockShots, assertMeasuredStockRender } = load('stockStoryboard');
  const { rankFootage } = load('automaticFootage');
  const { retainStockArtifacts, validatePublishingOutput } = load('generation');
  const { parseSrt } = load('timedCaptions');
  const { extractPostingFrame, timedNarrationSamples, visualPostingQuality } = load('videoPostingAnalysis');
  const { getReviewEditState } = load('reviewEdits');
  const reviews = load('reviewFiles');
  assert.equal(proof.recommendationId, 'catalogue-8-0');
  const idea = resolveCreationRecommendation(proof.recommendationId);
  assert.equal(idea.visualSubject, 'park');
  const media = JSON.parse(execFileSync(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', 'final.mp4'], { encoding: 'utf8', timeout: 15000, windowsHide: true }));
  const picture = media.streams.find(stream => stream.codec_type === 'video');
  assert.ok(picture && media.streams.some(stream => stream.codec_type === 'audio'));
  const duration = Number(media.format.duration);
  assert.ok(Math.abs(proof.duration - duration) <= .15);
  const input = { topic: idea.title, autoDuration: true, aspect: '9:16', publishingFormat: 'youtube-short', targetPlatform: 'YouTube' };
  const probe = { duration, width: picture.width, height: picture.height, hasAudio: true };
  const { format } = validatePublishingOutput(input, probe, true);
  const beats = proof.shots.map(({ assetId, narration, query }) => ({ assetId, narration, query }));
  const shots = readStockShots(proof.shots, duration, true);
  assertMeasuredStockRender(beats, shots);
  assert.equal(beats.map(beat => beat.narration).join(' '), proof.script);
  for (const shot of shots) {
    const candidate = { id: shot.assetId, sourcePage: shot.sourcePage, duration, width: probe.width, height: probe.height };
    assert.equal(rankFootage([candidate], shot.query, 1, '9:16', new Set(), undefined, undefined, { subject: idea.visualSubject }).length, 1);
  }

  const id = crypto.randomUUID();
  await reviews.ensureReviewFolders();
  const destination = reviews.outputPath(id, 'youtube');
  fs.copyFileSync('final.mp4', destination);
  const artifacts = { '/clean.mp4': 'clean.mp4', '/captions.srt': 'captions.srt', '/narration.wav': 'narration.wav' };
  global.fetch = async url => {
    const address = new URL(url);
    assert.equal(address.origin, 'http://127.0.0.1:8080');
    assert.ok(artifacts[address.pathname], 'Fixture accepts only its three offline artifact files.');
    return new Response(Readable.toWeb(fs.createReadStream(artifacts[address.pathname])));
  };
  const retained = await retainStockArtifacts(id, destination, probe, { version: 1, clean_video: '/clean.mp4',
    caption_file: '/captions.srt', narration_file: '/narration.wav', music_present: false,
    caption_count: parseSrt(fs.readFileSync('captions.srt', 'utf8')).length }, proof.script);
  global.fetch = originalFetch;
  assert.ok(duration - retained.cues.at(-1).end < .8);
  const review = reviews.makeReviewFile({ id, title: idea.title, targets: ['youtube'],
    source: { kind: 'pexels', filename: path.basename(destination), licence: 'Pexels fixture' }, audience: 'general',
    delivery: { publishingFormat: format, platform: 'youtube', aspect: '9:16', requestedDuration: duration, actualDuration: duration, creationType: 'general' },
    quality: { audio: 'local-narration', captions: retained.cues.map(cue => cue.text), hashtags: [], checks: [], storyboard: shots } });
  review.outputs = { youtube: { filename: path.basename(destination), duration, width: probe.width, height: probe.height } };
  review.captionCues = retained.cues; review.artifacts = retained.artifacts; review.editableMaster = true; review.status = 'READY';
  assert.ok(retained.cues.length >= 3);
  const selected = [retained.cues[0], retained.cues[Math.floor(retained.cues.length / 2)], retained.cues.at(-1)];
  const times = selected.map(cue => (cue.start + cue.end) / 2);
  const samples = timedNarrationSamples(retained.cues, times, duration);
  assert.ok(samples?.every(sample => sample.text));
  for (const time of times) assert.ok((await extractPostingFrame(destination, time)).length > 1000);
  const caption = 'Look for the changing light along this tree-lined park path.';
  review.quality = visualPostingQuality(review, { caption, captionVariants: [], hashtags: ['#ParkWalk', '#Trees'],
    observations: [{ frame: 1, visible: 'A park path framed by green trees' }], alignment: 'consistent',
    alignmentBasis: 'timed-caption-samples-v1', alignmentReason: 'Fixture observations match the measured park narration.',
    confidence: 'uncertain', model: 'offline-proof-caption' },
    { status: 'COMPLETE', attempts: 1, updatedAt: new Date().toISOString(), detail: 'Local fixture caption' }, times, []);
  await reviews.saveReviewFile(review);
  const saved = await reviews.getReviewFile(id), state = await getReviewEditState(id);
  assert.equal(saved.status, 'READY'); assert.equal(saved.title, idea.title); assert.equal(saved.quality.postCopy, caption);
  assert.equal(saved.quality.postingAnalysis.copyPolicy, 'narrated-editorial-line-v1');
  assert.ok(state.canReplaceCaptions && state.previewIsClean);
  assert.equal(state.draft.cues.map(cue => cue.text).join(' '), proof.script);
  console.log(JSON.stringify({ title: idea.title, duration, shots: shots.length, captions: retained.cues.length,
    measuredFrameSamples: times.length, review: saved.status, captionSource: 'offline editorial fixture', providersCalledByNode: false }));
}
verify().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });

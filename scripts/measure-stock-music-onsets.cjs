// Offline, bounded measurements of the committed recordings. No model or network.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SAMPLE_RATE = 8000, HOP = 160;

function recordingOnsets(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length > SAMPLE_RATE * 2 * 61 || pcm.length % 2) throw Error('Expected at most 61 seconds of mono 8 kHz PCM.');
  const energy = [];
  for (let start = 0; start + HOP * 2 <= pcm.length; start += HOP * 2) {
    let squared = 0;
    for (let index = start; index < start + HOP * 2; index += 2) squared += (pcm.readInt16LE(index) / 32768) ** 2;
    energy.push(Math.sqrt(squared / HOP));
  }
  const rising = energy.map((value, index) => index < 3 ? 0 : Math.max(0, value - (energy[index - 1] + energy[index - 2] + energy[index - 3]) / 3));
  const positive = rising.filter(value => value > .001).sort((a, b) => a - b);
  if (positive.length < 8) return [];
  const threshold = Math.max(.004, positive[Math.floor(positive.length * .65)]);
  const peaks = [];
  for (let index = 3; index < rising.length - 1; index++) {
    if (rising[index] < threshold || rising[index] < rising[index - 1] || rising[index] < rising[index + 1]) continue;
    const seconds = index * HOP / SAMPLE_RATE;
    const previous = peaks.at(-1);
    if (previous && seconds - previous.seconds < .2) {
      if (rising[index] > previous.strength) peaks[peaks.length - 1] = { seconds, strength: rising[index] };
    } else peaks.push({ seconds, strength: rising[index] });
  }
  // Sparse/quiet music supplies no defensible timing grid.
  return peaks.length >= 8 ? peaks.map(item => Number(item.seconds.toFixed(3))) : [];
}

function measureRecording(filename, ffmpeg) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-i', filename, '-t', '60', '-vn', '-af', 'highpass=f=40,lowpass=f=180', '-filter_threads', '1', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true, maxBuffer: 1_100_000, timeout: 20_000 });
  if (result.status !== 0 || result.error) throw Error('Recording measurement failed; no timing was invented.');
  return recordingOnsets(result.stdout);
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const manifest = require('../assets/music/lofi-cc0-v1/manifest.json');
  const ffmpeg = process.env.PHOENIX_FFMPEG_PATH || path.join(root, 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const measured = Object.fromEntries(manifest.recordings.map(track => [track.id, { version: 'low-band-onsets-v1', seconds: measureRecording(path.join(root, 'assets/music/lofi-cc0-v1', track.filename), ffmpeg) }]));
  process.stdout.write(JSON.stringify(measured, null, 2) + '\n');
}
module.exports = { recordingOnsets, measureRecording, SAMPLE_RATE };

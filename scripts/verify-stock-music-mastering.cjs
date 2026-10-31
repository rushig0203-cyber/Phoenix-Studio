// Actual FFmpeg/AAC proof using only tiny generated music, never owner media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const music = require('../src/lib/stockReel.ts');
const recordings = require('../src/lib/stockMusicLibrary.ts');
const libraryManifest = require('../assets/music/lofi-cc0-v1/manifest.json');
const resources = require('../src/lib/renderResources.ts');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-music-mastering-'));
function tool(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostats', ...resources.FFMPEG_FILTER_RESOURCE_ARGS, '-threads', '1', ...args], { windowsHide: true });
    resources.lowerChildProcessPriority(child.pid);
    let log = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log = (log + bytes).slice(-65536); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(log) : reject(new Error(log.slice(-2000))));
  });
}
async function main() {
  const results = [];
  const result = await resources.tryWithLocalRenderSlot(async () => {
    for (const [index, mood] of ['reflective', 'warm', 'journey', 'reflective', 'warm', 'journey'].entries()) {
      const input = path.join(scratch, `music-${index}.wav`), output = path.join(scratch, `mastered-${index}.m4a`);
      const duration = [12, 18, 32, 40, 16, 24][index];
      fs.writeFileSync(input, music.stockMusicWav(duration, mood, `loudness-proof-${index}`, 2));
      const scan = filename => tool(['-i', filename, '-vn', '-af', `${music.STOCK_MUSIC_LOUDNESS_FILTER}:print_format=json`, '-f', 'null', '-']).then(music.stockMusicLoudness);
      const before = await scan(input);
      await tool(['-y', '-i', input, '-af', music.stockMusicMasteringFilter(before), '-c:a', 'aac', '-threads', '1', '-ar', '48000', '-ac', '2', '-b:a', '160k', output]);
      const after = await scan(output);
      music.assertStockMusicLoudness(after);
      assert.ok(after.integratedLufs > before.integratedLufs + 5, 'Quiet music must actually become audible, not just gain a metadata label.');
      results.push({ mood, duration, beforeLufs: before.integratedLufs, afterLufs: after.integratedLufs, truePeakDb: after.truePeakDb });
    }
    for(const [index,track] of libraryManifest.recordings.entries()){
      const selection={library:'cc0-lofi-v1',trackId:track.id,offsetSeconds:12};
      const input=path.join(scratch,`recording-${index}.flac`),output=path.join(scratch,`recorded-master-${index}.m4a`),duration=[12,18,24,32,40,22][index];
      await tool(recordings.stockRecordingPreparationArgs(await recordings.stockRecordingFile(selection),input,selection,duration));
      const scan=filename=>tool(['-i',filename,'-vn','-af',`${music.STOCK_MUSIC_LOUDNESS_FILTER}:print_format=json`,'-f','null','-']).then(music.stockMusicLoudness);
      const before=await scan(input);
      await tool(['-y','-i',input,'-af',music.stockMusicMasteringFilter(before),'-c:a','aac','-threads','1','-ar','48000','-ac','2','-b:a','160k',output]);
      const after=await scan(output);music.assertStockMusicLoudness(after);
      results.push({recording:track.id,licence:'CC0-1.0',duration,beforeLufs:before.integratedLufs,afterLufs:after.integratedLufs,truePeakDb:after.truePeakDb});
    }
  }, 'Isolated audio loudness verification');
  assert.equal(result.acquired, true, 'Verification deferred: the heavy-work slot or its memory reserve is unavailable.');
  console.log(JSON.stringify({ realFfmpeg: true, sequential: true, fixtures: results }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  assert.equal(fs.realpathSync(path.dirname(scratch)), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(scratch), /^phoenix-music-mastering-/);
  fs.rmSync(scratch, { recursive: true, force: true });
});

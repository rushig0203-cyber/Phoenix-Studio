// Structural test only: a test tone is NOT proof of singing quality.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
process.env.PHOENIX_RENDER_THREADS = '1';
process.env.PHOENIX_KIDS_STOCK_BACKGROUNDS = '0';
process.env.PHOENIX_FFMPEG_PATH = path.join(project,'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project,'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const root = fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-song-proof-'));
try { os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
(async()=>{
  process.chdir(root);
  try {
    fs.mkdirSync(path.join(root,'scripts'));
    fs.copyFileSync(path.join(project,'scripts/synthesize-local-voice.ps1'),path.join(root,'scripts/synthesize-local-voice.ps1'));
    const { renderKidsVideo } = require(path.join(project,'src/lib/kidsRenderer'));
    const { stageSongAudio } = require(path.join(project,'src/lib/songAudio'));
    const fixture=path.join(root,'fixture.wav');
    const tone=spawnSync(process.env.PHOENIX_FFMPEG_PATH,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=21','-threads','1',fixture],{windowsHide:true,encoding:'utf8'});
    assert.equal(tone.status,0,tone.stderr);
    const track=await stageSongAudio(new ReadableStream({start(controller){controller.enqueue(fs.readFileSync(fixture));controller.close();}}),'fixture.wav');
    const lyrics='Bunny claps beside the flowers. Bird waves hello beneath the sun. Happy friends hop down the garden. Together they share a gentle hug.';
    const result=await renderKidsVideo(crypto.randomUUID(),{topic:'Bunny and Bird in the garden',duration:20,creationType:'children-song',songAudioId:track.id,script:lyrics,aspect:'16:9'},async(percent,stage)=>console.log(`${percent}% ${stage}`));
    assert.equal(result.script,lyrics);
    assert.ok(Math.abs(result.duration-20)<.15);
    const info=spawnSync(process.env.PHOENIX_FFPROBE_PATH,['-v','error','-show_streams','-of','json',result.file],{windowsHide:true,encoding:'utf8'});
    assert.equal(info.status,0,info.stderr);
    const streams=JSON.parse(info.stdout).streams;
    assert.ok(streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac'));
    assert.ok(streams.some(s=>s.codec_type==='video'&&s.codec_name==='h264'));
    assert.ok(fs.existsSync(path.join(path.dirname(result.file),'clean.mp4')));
    assert.match(fs.readFileSync(path.join(path.dirname(result.file),'captions.srt'),'utf8'),/Bunny claps/);
    console.log('PASS: 20-second supplied-audio pipeline, original lyrics, captions, editable master, H264/AAC. Singing quality is not tested by this tone fixture.');
  } finally {
    process.chdir(project);
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'phoenix-song-proof-')));
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

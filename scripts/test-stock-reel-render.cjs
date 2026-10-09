// Opt-in three-second FFmpeg compatibility proof. Holds the canonical heavy-work
// lease; all queue/media fixtures live in one ignored, isolated work directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const project = path.resolve(__dirname, '..');
process.env.PHOENIX_FFMPEG_PATH = path.join(project, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
process.env.PHOENIX_FFPROBE_PATH = path.join(project, 'node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...options }); resources.lowerChildProcessPriority(child.pid);
    const chunks = []; let error = '';
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-8000); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || `Tool exited ${code}`)));
  });
}
const ffmpeg = args => command(process.env.PHOENIX_FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', ...resources.FFMPEG_FILTER_RESOURCE_ARGS, ...args]);
async function fixture() {
  const source = require(path.join(project, 'src/lib/sourceProcessing.ts'));
  const reviews = require(path.join(project, 'src/lib/reviewFiles.ts'));
  const first = path.join(process.cwd(), 'portrait-green.mp4'), second = path.join(process.cwd(), 'landscape-blue.mp4');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=forestgreen:s=360x640:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5', '-t', '1.5', '-vf', 'setsar=1', '-af', 'volume=0.01', '-c:v', 'libx264', '-preset', 'veryfast', ...resources.FFMPEG_ENCODER_RESOURCE_ARGS, '-pix_fmt', 'yuv420p', '-c:a', 'aac', first]);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=480x270:r=24', '-t', '1.5', '-vf', 'drawbox=x=0:y=0:w=32:h=270:color=yellow:t=fill,drawbox=x=448:y=0:w=32:h=270:color=red:t=fill,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', ...resources.FFMPEG_ENCODER_RESOURCE_ARGS, '-pix_fmt', 'yuv420p', '-an', second]);
  const originals = [first, second], settings = { requestId: crypto.randomUUID(), caption: 'This posting description must never appear in the pixels.', theme: 'isolated compatibility fixture', maxDuration: 60, options: { audio: 'auto', mood: 'warm', transition: 'soft', framing: 'auto', pacing: 'selected' } };
  const job = await source.createStockReelJob(originals.map((filename, index) => ({ provider: index ? 'pixabay' : 'pexels', mediaId: String(index + 1), title: index ? 'Blue landscape fixture' : 'Green portrait fixture', creator: 'Synthetic test fixture only', sourcePage: index ? 'https://pixabay.com/videos/fixture-2/' : 'https://www.pexels.com/video/fixture-1/', start: 0, end: 1.5, trimMode: 'manual', open: async () => ({ stream: Readable.toWeb(fs.createReadStream(filename)), expectedBytes: fs.statSync(filename).size }) })), settings);
  assert.equal(job.stockSource.editVersion, 2);
  await source.processNextSourceJob();
  const done = await source.getSourceJob(job.id); assert.equal(done.status, 'COMPLETED', done.error);
  const file = await reviews.getReviewFile(done.reviewIds[0]), output = reviews.outputPath(file.id, 'instagram');
  const probe = JSON.parse((await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,width,height,nb_read_frames', '-of', 'json', output])).toString());
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(video.width, 720); assert.equal(video.height, 1280); assert.equal(Number(video.nb_read_frames), 72);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < .15);
  assert.equal(file.quality.audio, 'natural-audio-preserved'); assert.deepEqual(file.quality.captions, []);
  const frame = async at => ffmpeg(['-ss', String(at), '-threads', '1', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  const green = await frame(.75), blue = await frame(2.25);
  const rgb = (pixels, x, y) => Array.from(pixels.subarray((y * 720 + x) * 3, (y * 720 + x) * 3 + 3));
  assert.ok(rgb(green, 360, 1150)[1] > 90 && rgb(green, 360, 1150)[0] < 60, 'Posting title creates no lower-screen dark box or white text');
  assert.ok(rgb(blue, 12, 640)[0] > 180 && rgb(blue, 12, 640)[1] > 180, 'Left yellow edge survives safe landscape fitting');
  assert.ok(rgb(blue, 708, 640)[0] > 180 && rgb(blue, 708, 640)[2] < 80, 'Right red edge survives safe landscape fitting');
  assert.ok(rgb(blue, 360, 100).every(channel => channel < 35), 'Landscape is surrounded by the dark-neutral matte');
  const originalAudio = await ffmpeg(['-ss', '0.2', '-t', '1', '-threads', '1', '-i', first, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const resultAudio = await ffmpeg(['-ss', '0.2', '-t', '1', '-threads', '1', '-i', output, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const toneAmplitude = audio => {
    let sin = 0, cos = 0, count = audio.length / 2;
    for (let index = 0; index < count; index += 1) { const sample = audio.readInt16LE(index * 2); sin += sample * Math.sin(2 * Math.PI * 440 * index / 16000); cos += sample * Math.cos(2 * Math.PI * 440 * index / 16000); }
    return Math.hypot(sin, cos) * 2 / count;
  };
  const ratio = toneAmplitude(resultAudio) / toneAmplitude(originalAudio);
  assert.ok(ratio > .65 && ratio < 1.35, `The quiet source tone remains audible at its original level (ratio ${ratio})`);
  const rms = (audio, label = 'source interval') => {
    assert.ok(audio.length >= 100, `Audio sample must contain decoded PCM (${label}: ${audio.length} bytes).`);
    let sumSquares = 0;
    for (let index = 0; index < audio.length / 2; index += 1) sumSquares += audio.readInt16LE(index * 2) ** 2;
    return Math.sqrt(sumSquares / (audio.length / 2));
  };
  const originalRmsRatio = rms(resultAudio) / rms(originalAudio);
  assert.ok(Math.abs(originalRmsRatio - ratio) < .08, 'Auto mode adds no significant off-tone music energy over the original-sound interval');
  const silentSection = await ffmpeg(['-ss', '1.8', '-t', '0.8', '-threads', '1', '-i', output, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const silentSectionRms = rms(silentSection);
  assert.ok(silentSectionRms > 50, 'Automatic music fills the silent second shot despite usable sound in the first');
  const finalSection = await ffmpeg(['-threads', '1', '-i', output, '-ss', '2.75', '-t', '0.15', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-']);
  const audioProbe = JSON.parse((await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration,nb_frames', '-of', 'json', output])).toString());
  const tailRms = rms(finalSection, `tail; ${JSON.stringify(audioProbe)}`);
  assert.ok(tailRms > 10, 'The final music fade remains audible before the intended ending, not an accidentally blank tail');
  const master = path.join(reviews.reviewRoot(), file.artifacts.editing.video);
  const pictureHash = filename => ffmpeg(['-threads', '1', '-i', filename, '-map', '0:v:0', '-c:v', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);
  const masterProbe = JSON.parse((await command(process.env.PHOENIX_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels', '-of', 'json', master])).toString());
  assert.equal((await pictureHash(output)).toString(), (await pictureHash(master)).toString(), `Caption-free export remuxes the encoded master picture without another encode: ${JSON.stringify(masterProbe)}`);
  // Exercise the actual caption-burn fallback too. These are explicit synthetic
  // test cues, not invented production speech or a transcription-model call.
  const captionedId=crypto.randomUUID();
  await source.renderClip(master,{...file,id:captionedId},{start:0,end:3,metrics:{audio:{usable:true}}},
    {width:720,height:1280,filter:'scale=720:1280,setsar=1'},[{start:0,end:2.9,lines:['Caption test only']}],
    path.join(reviews.reviewRoot(),'work','captioned-check'),async()=>undefined,{mood:'warm',seed:'fixture'});
  const captioned=reviews.outputPath(captionedId,'instagram');
  const captionedTail=await ffmpeg(['-threads','1','-i',captioned,'-ss','2.75','-t','0.15','-vn','-ac','1','-ar','16000','-f','s16le','-']);
  const captionedTailRms=rms(captionedTail,'captioned fallback tail');assert.ok(captionedTailRms>10);
  const captionedPixels=await ffmpeg(['-ss','2.25','-threads','1','-i',captioned,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);
  let white=0;for(let y=850;y<1250;y++)for(let x=120;x<600;x++){
    const p=(y*720+x)*3;if(captionedPixels[p]>180&&captionedPixels[p+1]>180&&captionedPixels[p+2]>180)white++;
  }
  assert.ok(white>100,'Actual caption text is visible on the synthetic blue frame');
  for (let index = 0; index < originals.length; index += 1) assert.deepEqual(fs.readFileSync(reviews.sourcePath(job.id, job.stockSource.shots[index].sourceFile)), fs.readFileSync(originals[index]));
  await ffmpeg(['-y', '-ss', '0.75', '-threads', '1', '-i', output, '-frames:v', '1', path.join(process.cwd(), 'portrait-frame.png')]);
  await ffmpeg(['-y', '-ss', '2.25', '-threads', '1', '-i', output, '-frames:v', '1', path.join(process.cwd(), 'landscape-frame.png')]);
  console.log(JSON.stringify({ output, portraitFrame: path.join(process.cwd(), 'portrait-frame.png'), landscapeFrame: path.join(process.cwd(), 'landscape-frame.png'), width: video.width, height: video.height, frames: Number(video.nb_read_frames), duration: Number(probe.format.duration), quietSourceAmplitudeRatio: ratio, originalRmsRatio, silentSectionRms, tailRms, captionedTailRms, captionBurnVerified:true, pictureRemuxVerified: true, credits: file.quality.visualSources.length, subtitles: file.quality.subtitles.decision }));
}
async function main() {
  if (process.argv.includes('--fixture')) return fixture();
  assert.equal(path.resolve(process.cwd()), project, 'The wrapper must reserve the canonical project heavy-work slot.');
  const freeMiB = Math.floor(os.freemem() / 1024 / 1024); assert.ok(freeMiB >= 900, `Only ${freeMiB} MiB free; proof requires 900 MiB.`);
  const work = path.join(project, 'storage', 'Phoenix Studio Review Files', 'work'); fs.mkdirSync(work, { recursive: true });
  const directory = fs.mkdtempSync(path.join(work, 'stock-quality-proof-'));
  // The bundled 2018 Windows FFmpeg does not handle >260-character output paths.
  // Encode in a short isolated workspace, then retain its evidence in ignored work.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-stock-'));
  try {
    await resources.withLocalRenderSlot(async () => {
      const output = await command(process.execPath, ['--max-old-space-size=128', __filename, '--fixture'], { cwd: scratch });
      const evidence = JSON.parse(output.toString().trim());
      for (const [key, filename] of [['output', 'proof.mp4'], ['portraitFrame', 'portrait-frame.png'], ['landscapeFrame', 'landscape-frame.png']]) {
        const retained = path.join(directory, filename); fs.copyFileSync(evidence[key], retained); evidence[key] = retained;
      }
      fs.writeFileSync(path.join(directory, 'proof.json'), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
    }, 'Isolated three-second stock reel compatibility proof');
  } finally {
    assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(scratch).startsWith('ps-stock-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

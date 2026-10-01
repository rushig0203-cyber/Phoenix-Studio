// Deliberately opt-in: listing a hardware encoder does not prove the installed
// GPU/driver can run it, and a fast fixture does not establish final-video quality.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const FIXTURE = Object.freeze({ duration: 3, width: 1280, height: 720, fps: 24 });
const TIMEOUT_MS = 25000;

function resolveBinary(name) {
  const override = process.env[name === 'ffmpeg' ? 'PHOENIX_FFMPEG_PATH' : 'PHOENIX_FFPROBE_PATH']?.trim();
  return override || path.join(root, 'node_modules', `@${name}-installer`, `${process.platform}-${process.arch}`, process.platform === 'win32' ? `${name}.exe` : name);
}

function hasEncoder(output, name) {
  return output.split(/\r?\n/).some(line => /^\s*V\S{5}\s+/.test(line) && line.trim().split(/\s+/)[1] === name);
}

function encodeArguments(encoder, output) {
  if (!['libx264', 'h264_amf'].includes(encoder)) throw new Error('Unsupported benchmark encoder.');
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'info', '-benchmark', '-n',
    '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', `testsrc2=size=${FIXTURE.width}x${FIXTURE.height}:rate=${FIXTURE.fps}`,
    '-t', String(FIXTURE.duration), '-an', '-c:v', encoder, '-threads', '1',
    ...(encoder === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '20', '-qp_b', '20']),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ];
}

function parseUsage(stderr) {
  const rss = /maxrss=(\d+)kB/.exec(stderr);
  const cpu = /utime=([\d.]+)s\s+stime=([\d.]+)s\s+rtime=([\d.]+)s/.exec(stderr);
  return {
    peakProcessRssMiB: rss && Number(rss[1]) > 0 ? Number((Number(rss[1]) / 1024).toFixed(1)) : null,
    cpuSeconds: cpu ? Number((Number(cpu[1]) + Number(cpu[2])).toFixed(3)) : null,
    encoderWallSeconds: cpu ? Number(cpu[3]) : null,
  };
}

function verifyProbe(probe) {
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(probe.format?.duration ?? video?.duration);
  const frames = Number(video?.nb_read_frames ?? video?.nb_frames);
  if (!video || video.codec_name !== 'h264' || video.width !== FIXTURE.width || video.height !== FIXTURE.height
    || !Number.isFinite(duration) || Math.abs(duration - FIXTURE.duration) > 0.12
    || !Number.isFinite(frames) || frames !== FIXTURE.duration * FIXTURE.fps) {
    throw new Error('Encoded fixture has an unexpected codec, duration, dimensions, or decoded frame count.');
  }
  return { duration, frames, width: video.width, height: video.height, codec: video.codec_name };
}

async function runProcess(executable, args, lowerPriority = () => {}) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', timedOut = false, spawnError;
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    lowerPriority(child.pid);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    const append = (value, chunk) => (value + chunk.toString()).slice(-128 * 1024);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => { spawnError = error; });
    // Keep the shared lease until the actual child exit, including timeout.
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (spawnError) return reject(spawnError);
      resolve({ code, signal, timedOut, stdout, stderr, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)) });
    });
  });
}

async function runBenchmark() {
  process.chdir(root);
  require('@next/env').loadEnvConfig(root);
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
  const resources = require('../src/lib/renderResources.ts');
  const admitted = await resources.tryWithLocalRenderSlot(async () => {
    const ffmpeg = resolveBinary('ffmpeg'), ffprobe = resolveBinary('ffprobe');
    await fs.access(ffmpeg);
    await fs.access(ffprobe);
    const listing = await runProcess(ffmpeg, ['-hide_banner', '-encoders'], resources.lowerChildProcessPriority);
    if (listing.code !== 0 || listing.timedOut) throw new Error('FFmpeg encoder inventory failed.');
    const available = listing.stdout + listing.stderr;
    if (!hasEncoder(available, 'libx264')) throw new Error('Bundled FFmpeg does not expose the CPU baseline libx264.');
    const diagnostics = path.join(root, 'storage', 'diagnostics');
    await fs.mkdir(diagnostics, { recursive: true });
    const directory = await fs.mkdtemp(path.join(diagnostics, 'encoder-benchmark-'));
    const report = {
      timestamp: new Date().toISOString(), fixture: FIXTURE, freeMemoryBeforeMiB: Math.floor(os.freemem() / 1048576),
      encoderAutomaticSelection: false,
      scope: 'Tiny synthetic encode/decode smoke test. Does not measure visual equivalence, shared GPU memory, real caption/filter pipelines, or sustained thermal load.',
      runs: [],
    };
    for (const encoder of ['libx264', 'h264_amf']) {
      if (!hasEncoder(available, encoder)) { report.runs.push({ encoder, status: 'not-listed' }); continue; }
      const output = path.join(directory, `${encoder}.mp4`);
      console.log(`Testing ${encoder}: one ${FIXTURE.duration}s 720p fixture, one encoder thread.`);
      const result = await runProcess(ffmpeg, encodeArguments(encoder, output), resources.lowerChildProcessPriority);
      const run = { encoder, status: 'failed', elapsedSeconds: result.elapsedSeconds, ...parseUsage(result.stderr) };
      await fs.writeFile(path.join(directory, `${encoder}.log`), result.stderr);
      if (result.code !== 0 || result.timedOut) {
        run.error = result.timedOut ? `Timed out after ${TIMEOUT_MS / 1000}s; child stopped.` : result.stderr.trim().split(/\r?\n/).slice(-8).join('\n');
      } else {
        try {
          const probed = await runProcess(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', output], resources.lowerChildProcessPriority);
          if (probed.code !== 0 || probed.timedOut) throw new Error('FFprobe could not count decoded video frames.');
          run.video = verifyProbe(JSON.parse(probed.stdout));
          const decoded = await runProcess(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '1', '-i', output, '-map', '0:v:0', '-f', 'null', '-'], resources.lowerChildProcessPriority);
          if (decoded.code !== 0 || decoded.timedOut || decoded.stderr.trim()) throw new Error('Full decode verification failed.');
          run.status = 'verified';
          run.output = output;
        } catch (error) { run.error = error.message; }
      }
      report.runs.push(run);
    }
    report.freeMemoryAfterMiB = Math.floor(os.freemem() / 1048576);
    const cpu = report.runs.find(run => run.encoder === 'libx264');
    const hardware = report.runs.find(run => run.encoder === 'h264_amf');
    report.recommendation = hardware?.status !== 'verified'
      ? 'Keep libx264. The installed AMD encoder did not pass the real encode/decode check.'
      : cpu?.status === 'verified' && hardware.elapsedSeconds < cpu.elapsedSeconds * 0.8
        ? 'AMF is a candidate for a representative captioned-video quality/resource test; keep libx264 until that comparison passes.'
        : 'Keep libx264. This short test did not establish a meaningful AMF speed improvement.';
    const reportFile = path.join(directory, 'report.json');
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, reportFile }, null, 2));
    return report;
  }, 'Testing video encoder resource use');
  if (!admitted.acquired) throw new Error(`Encoder test not started: ${(await resources.heavyWorkStatus()).reason}.`);
  return admitted.value;
}

module.exports = { FIXTURE, encodeArguments, hasEncoder, parseUsage, verifyProbe, runBenchmark };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) console.log('Dry run: --run tests sequential 3-second 720p libx264/AMD AMF fixtures under Phoenix\'s shared heavy-work slot. No production encoder is changed. Results and tiny test files remain in storage/diagnostics.');
  else if (args.length === 1 && args[0] === '--run') runBenchmark().catch(error => { console.error(error.message); process.exitCode = 1; });
  else { console.error('Usage: node scripts/benchmark-encoders.cjs [--run]'); process.exitCode = 1; }
}

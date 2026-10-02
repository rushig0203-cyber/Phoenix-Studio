// Small visual proof only: no voice process, video encode, model or live job.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const sharp = require('sharp');
const { kidsAnimationSvg, planKidsAnimationScene } = require('../src/lib/kidsAnimation');
sharp.concurrency(1); sharp.cache({ memory: 16, files: 0, items: 16 });
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-expressive-stills-'));
  const options = { topic: 'Bunny and Bear share a letter', caption: 'Bunny hands the letter to Bear.', index: 1, cast: ['bunny', 'bear'], castNames: ['Bunny', 'Bear'], frame: 0 };
  const held = planKidsAnimationScene(options.topic, 'Bunny held the letter.');
  const scene = planKidsAnimationScene(options.topic, options.caption, 1, held);
  const composite = [];
  for (const [i, progress] of [.08, .48, .9].entries()) {
    const image = await sharp(Buffer.from(kidsAnimationSvg({ ...options, aspect: '16:9', scene, sceneProgress: progress, performance: { speaker: 1, mouthOpen: i === 1 ? .9 : 0 } }))).resize(480, 270).png().toBuffer();
    composite.push({ input: image, left: i * 480, top: 0 });
  }
  const file = path.join(folder, 'letter-anticipation-transfer-reaction.png');
  await sharp({ create: { width: 1440, height: 270, channels: 4, background: '#fff5e4' } }).composite(composite).png().toFile(file);
  const portrait = path.join(folder, 'kite-profile-portrait.png');
  await sharp(Buffer.from(kidsAnimationSvg({ ...options, topic: 'Bunny and Tika untangle a kite', caption: 'Bunny reaches for the tangled kite while Tika watches.', cast: ['bunny', 'bird'], castNames: ['Bunny', 'Tika'], aspect: '9:16', sceneProgress: .58, performance: { speaker: -1, mouthOpen: 0 } }))).resize(360, 640).png().toFile(portrait);
  console.log(JSON.stringify({ folder, file, portrait }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

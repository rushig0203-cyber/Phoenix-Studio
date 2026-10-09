const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Isolated module evaluation only: never import Phoenix's application graph,
// load native Sharp, write frames, call providers, or start a service/encoder.
const project = path.resolve(__dirname, '..');
function compile(relative) {
  const filename = path.join(project, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  return { source, output, filename };
}
const animationModule = compile('src/lib/kidsAnimation.ts');
const configModule = compile('next.config.ts');
function evaluate(compiled, load) {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, require: load, Buffer, process: { env: {} } });
  new vm.Script(compiled.output, { filename: compiled.filename }).runInContext(context, { timeout: 1000 });
  return module.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const unit = value => Math.max(0, Math.min(1, value));
function animationHarness({ failFrame = false } = {}) {
  const loads = [], cache = [], concurrency = [], frames = [], writes = [], directories = [], progress = [];
  function sharp(input) {
    assert.ok(Buffer.isBuffer(input), 'The raster boundary receives a bounded SVG buffer');
    return { png(options) {
      assert.equal(options.compressionLevel, 1);
      return { async toFile(filename) {
        if (failFrame) throw new Error('Mock raster failure');
        frames.push({ filename, bytes: input.length });
      } };
    } };
  }
  sharp.concurrency = value => { concurrency.push(value); };
  sharp.cache = value => { cache.push(clone(value)); };
  const planning = {
    kidsMouthState: (performance, fallback, song) => ({ speaker: song ? -1 : performance?.speaker ?? fallback ?? -1, mouthOpen: performance?.mouthOpen ?? 0 }),
    kidsPoseBudgets: signatures => signatures.map(() => 8),
    kidsShotFor: () => 'wide',
    kidsStoryBeat: () => ({ stage: 'hold', action: 0 }),
    mix: (start, end, amount) => start + (end - start) * amount,
    ramp: (value, start, end) => unit((value - start) / (end - start)),
    quantizeKidsProgress: value => unit(value),
    unit,
    KIDS_MAX_UNIQUE_FRAMES: 900,
  };
  const fakeFs = {
    async mkdir(directory) { directories.push(directory); },
    async writeFile(filename, contents) { writes.push({ filename, contents }); },
  };
  const api = evaluate(animationModule, name => {
    loads.push(name);
    if (name === 'node:fs/promises') return fakeFs;
    if (name === 'node:path') return path;
    if (name === 'node:crypto') return require('node:crypto');
    if (name === './kidsCharacterRig') return {
      kidsCharacterSvg: () => '<g data-mocked-character="true"/>',
      kidsRigMotion: () => ({ lift: 0, hands: [[0, 0], [0, 0]] }),
    };
    if (name === './kidsObjectEvents') return {
      kidsNarratedActions: text => text,
      reportsKiteFlight: () => false,
      reportsKiteResolution: () => false,
    };
    if (name === './kidsAnimationTimeline') return planning;
    if (name === 'sharp') return { __esModule: true, default: sharp };
    throw new Error(`Unexpected isolated animation import: ${name}`);
  });
  return {
    api, loads, cache, concurrency, frames, writes, directories, progress,
    options: () => ({
      directory: path.join(project, 'unused-mocked-animation-directory'),
      topic: 'Friends wave hello', duration: 1 / 12, aspect: '9:16',
      cues: [{ text: 'Pip waves hello.', start: 0, end: 1 / 12 }],
      cast: ['dog', 'cat'], castNames: ['Pip', 'Coco'], song: false,
      onProgress: async value => { progress.push(value); },
    }),
  };
}

test('Next avoids eager route preloading while retaining build memory safeguards', () => {
  const configure = evaluate(configModule, name => {
    if(name==='./scripts/next-build-selection.cjs') return {selectNextBuild:()=>'.next-fixture-current'};
    throw new Error(`Unexpected runtime config import: ${name}`);
  }).default;
  const config=configure('phase-production-server');
  assert.equal(config.experimental.preloadEntriesOnStart, false);
  assert.equal(config.experimental.cpus, 1);
  assert.equal(config.experimental.webpackMemoryOptimizations, true);
  assert.equal(config.distDir, '.next-fixture-current');
  assert.equal(config.env.NEXT_PUBLIC_PHOENIX_RELEASE,'.next-fixture-current');
  assert.ok(config.outputFileTracingExcludes['*'].includes('./storage/**/*'));
  assert.ok(config.outputFileTracingExcludes['*'].includes('./work/**/*'));
});

test('animation import and pure scene planning never load native Sharp', () => {
  const ast = ts.createSourceFile(animationModule.filename, animationModule.source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.some(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'sharp'), false);
  const h = animationHarness();
  assert.equal(h.loads.includes('sharp'), false);
  const scene = h.api.planKidsAnimationScene('Friends in the garden', 'Pip waves hello.');
  assert.equal(scene.action, 'wave');
  assert.equal(scene.theme, 'garden');
  const performance = h.api.planKidsPerformance('Pip waves hello.', ['dog', 'cat'], ['Pip', 'Coco']);
  assert.equal(performance.active[0], true);
  assert.equal(h.loads.includes('sharp'), false);
  assert.equal(h.frames.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.directories.length, 0);
});

test('invalid duration rejects before requesting Sharp or writing any frame', async () => {
  const h = animationHarness();
  for (const duration of [0, -1, NaN, Infinity, 211]) {
    await assert.rejects(h.api.prepareKidsAnimation({ ...h.options(), duration }), /Animation duration must be positive/);
  }
  assert.equal(h.loads.includes('sharp'), false);
  assert.equal(h.directories.length, 0);
  assert.equal(h.cache.length, 0);
});

test('invalid narration cues reject before requesting Sharp or touching disk', async () => {
  const h = animationHarness();
  for (const cues of [[], [{ text: 'Bad cue', start: 1, end: 1 }], [{ text: 'Bad cue', start: NaN, end: 1 }], [{ text: 'Bad cue', start: 0, end: Infinity }]]) {
    await assert.rejects(h.api.prepareKidsAnimation({ ...h.options(), cues }), /Animation needs valid timed narration scenes/);
  }
  assert.equal(h.loads.includes('sharp'), false);
  assert.equal(h.frames.length, 0);
  assert.equal(h.writes.length, 0);
});

test('one valid mocked frame lazily loads Sharp with existing native memory limits and releases its cache', async () => {
  const h = animationHarness();
  const result = await h.api.prepareKidsAnimation(h.options());
  assert.equal(h.loads.filter(name => name === 'sharp').length, 1);
  assert.deepEqual(h.concurrency, [1]);
  assert.deepEqual(h.cache, [{ memory: 24, files: 0, items: 32 }, false]);
  assert.equal(result.frames, 1);
  assert.equal(result.uniqueFrames, 1);
  assert.equal(h.frames.length, 1);
  assert.ok(h.frames[0].bytes > 0);
  assert.equal(h.directories.length, 1);
  const manifest = h.writes.find(write => path.basename(write.filename) === 'animation-plan.json');
  assert.ok(manifest);
  const plan = JSON.parse(manifest.contents);
  assert.equal(plan.frames, 1);
  assert.equal(plan.uniqueFrames, 1);
  assert.equal(plan.timeline, 'finite-action-reaction-hold');
  assert.equal(h.writes.filter(write => path.basename(write.filename) === 'scenes.txt').length, 1);
  assert.equal(h.progress.at(-1), 100);
});

test('mock raster rejection still clears Sharp cache and cannot write a completed timeline', async () => {
  const h = animationHarness({ failFrame: true });
  await assert.rejects(h.api.prepareKidsAnimation(h.options()), /Mock raster failure/);
  assert.equal(h.loads.filter(name => name === 'sharp').length, 1);
  assert.deepEqual(h.concurrency, [1]);
  assert.deepEqual(h.cache, [{ memory: 24, files: 0, items: 32 }, false]);
  assert.equal(h.frames.length, 0);
  assert.equal(h.writes.length, 0);
});

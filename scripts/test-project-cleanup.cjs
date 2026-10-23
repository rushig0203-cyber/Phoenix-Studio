const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const retired = ['@base-ui/react', '@ffmpeg/ffmpeg', '@ffmpeg/util', 'date-fns', 'framer-motion', 'zustand'];

test('unused packages are absent from both direct dependencies and locked installation', () => {
  const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const name of retired) {
    assert.equal(pkg.dependencies[name], undefined, name);
    assert.equal(lock.packages[`node_modules/${name}`], undefined, name);
  }
  for (const name of ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe', 'ts-node', 'tsconfig-paths']) {
    assert.ok(pkg.dependencies[name], `${name} is still needed by native rendering/worker startup`);
  }
});

test('retired buffering, mock UI, WASM assets and unsupported deployment paths stay absent', () => {
  for (const file of ['Dockerfile', 'docker-compose.yml', '.dockerignore', '.github/workflows/deploy.yml',
    'src/components/UploadZone.tsx', 'src/components/UploadTabConsole.tsx', 'src/components/ContentIdeas.tsx',
    'src/components/ultimate/BrandKit.tsx', 'src/components/ultimate/ViralAnalytics.tsx',
    'src/app/dashboard/project/[id]/editor/workspace.tsx', 'src/store/editorStore.ts',
    'src/lib/ffmpeg.ts', 'src/lib/clipExporter.ts', 'src/lib/transcriber.ts', 'src/lib/clipAnalyzer.ts',
    'src/app/api/analyze/route.ts', 'src/app/api/clips/analyze/route.ts',
    'src/app/api/stock/pexels/route.ts', 'src/app/api/stock/pixabay/route.ts',
    'src/app/api/content-ideas/route.ts', 'src/app/api/review-files/ideas/route.ts', 'src/app/api/creation-drafts/footage/route.ts',
    'public/ffmpeg.js', 'public/814.ffmpeg.js', 'GENERATION_AUTOPILOT.md', 'LUMINA_MANAGER.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}
test('retained source imports resolve after deleting the legacy graph', () => {
  for (const filename of sourceFiles(path.join(root, 'src'))) {
    const imports = ts.preProcessFile(fs.readFileSync(filename, 'utf8'), true, true).importedFiles;
    for (const { fileName: name } of imports) {
      assert.ok(!retired.some(pkg => name === pkg || name.startsWith(`${pkg}/`)), name);
      const local = name.startsWith('@/') ? path.join(root, 'src', name.slice(2))
        : name.startsWith('.') ? path.resolve(path.dirname(filename), name) : null;
      if (!local) continue;
      const candidates = [local, ...['.ts', '.tsx', '.js', '.cjs', '/index.ts', '/index.tsx'].map(ext => local + ext)];
      assert.ok(candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()), `${path.relative(root, filename)} -> ${name}`);
    }
  }
});

function evaluate(relative, load) {
  const mod = { exports: {} };
  const output = ts.transpileModule(read(relative), { fileName: relative,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new vm.Script(output, { filename: relative }).runInNewContext({ module: mod, exports: mod.exports, require: load }, { timeout: 1000 });
  return mod.exports;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null ? '' : String(node);
}
test('old bookmarks show an honest server-only native-editor handoff, without touching saved data', async () => {
  const relative = 'src/app/dashboard/project/[id]/editor/page.tsx';
  const editor = evaluate(relative, name => {
    assert.equal(name, 'react/jsx-runtime', 'Compatibility page must not import the old renderer, database or upload code');
    return require(name);
  });
  const tree = editor.default();
  const links = tree.props.children.props.children.filter(child => child?.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, '/dashboard#library');
  assert.match(text(tree), /Edit video/);
  assert.match(text(tree), /not been deleted or changed/);
  assert.match(text(tree), /not automatically converted/);
  const review = evaluate('src/app/dashboard/review/[id]/page.tsx', name => {
    assert.equal(name, '@/app/dashboard/project/[id]/editor/page'); return editor;
  });
  assert.equal(review.default, editor.default);
  for (const page of ['src/app/dashboard/project/[id]/page.tsx', 'src/app/dashboard/project/[id]/ultimate/page.tsx']) {
    let destination;
    const route = evaluate(page, name => { assert.equal(name, 'next/navigation'); return { redirect: value => { destination = value; } }; });
    await route.default({ params: Promise.resolve({ id: 'old-project' }) });
    assert.equal(destination, '/dashboard/project/old-project/editor');
  }
});

test('current creation, review editing, publishing and native release paths remain wired', () => {
  const dashboard = read('src/app/dashboard/DashboardClient.tsx');
  for (const name of ['SourceProcessor', 'AICreation', 'StockReels', 'ReviewLibrary', 'CreationDrafts', 'ChannelConnections']) {
    assert.match(dashboard, new RegExp(`import ${name} from`), name);
  }
  assert.match(read('src/app/dashboard/edit/[id]/page.tsx'), /<ReviewEditor id=/);
  assert.match(read('src/components/ReviewEditor.tsx'), /\/api\/review-files\/\$\{id\}\/edit/);
  assert.match(read('src/components/ReviewLibrary.tsx'), /PostingActions/);
  const workflow = read('.github/workflows/phoenix-windows-build.yml');
  for (const name of ['test-project-cleanup.cjs', 'test-local-mutation-boundaries.cjs', 'test-editor-controls.cjs',
    'test-file-lock.cjs', 'test-runtime-lazy-loading.cjs', 'test-workflow-admission.cjs']) assert.ok(workflow.includes(name), name);
  assert.ok(fs.existsSync(path.join(root, '.github/workflows/phoenix-vercel-build.yml')));
});

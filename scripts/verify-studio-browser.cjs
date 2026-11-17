// CI-only proof of the built UI. Every API response and media item is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const date = '2026-11-17T12:00:00Z';
const templateTitles = ['Owls', 'Pandas', 'Rabbits', 'Waterfall', 'Switzerland', 'Lake'];
const templates = templateTitles.map(title => ({ id: `footage-${title.toLowerCase()}`, title, query: title,
  workflow: 'stock-reel', category: 'Nature & wildlife', reason: `A fresh ${title.toLowerCase()} idea inspired by your saved wildlife and outdoor videos.` }));
const request = { requestId: '11111111-1111-4111-8111-111111111111', templateId: templates[0].id,
  title: templates[0].title, query: templates[0].query, jobId: 'fixture-template-job' };
const file = {
  id: 'fixture-quiet-river', title: 'Quiet river study', status: 'READY', audience: 'general', createdAt: date, updatedAt: date,
  targets: ['instagram', 'youtube'], source: { kind: 'pexels', filename: 'fixture.mp4', licence: 'Synthetic CI fixture' },
  outputs: Object.fromEntries(['instagram', 'youtube'].map(target => [target, { filename: `fixture-${target}.mp4`, width: 1080, height: 1920, duration: 12 }])),
  delivery: { platform: 'instagram', publishingFormat: 'instagram-reel', aspect: '9:16', requestedDuration: 12, actualDuration: 12, creationType: 'general' },
  processing: { jobId: request.jobId, status: 'COMPLETED', start: 0, end: 12, format: '9:16', score: 80, rank: 1, reason: 'Synthetic UI proof' },
  quality: { audio: 'local-music-replaced', musicRecording: { timing: 'onset-v1', title: 'Fixture instrumental' },
    postCopy: 'A quiet moment beside the river.', hashtags: ['#River', '#Nature'], captions: [], checks: [] },
};
const channels = ['instagram', 'youtube', 'facebook'].map(platform => ({ platform, configured: true, connected: true,
  state: 'connected', oauthAvailable: false, name: platform === 'instagram' ? '@fixture_wildlife' : `Fixture ${platform} channel`,
  accountId: `fixture-${platform}`, connectionRevision: `fixture-${platform}-revision`, publishReady: true, verifiedAt: date }));
const poster = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#aebfba"/><circle cx="480" cy="78" r="36" fill="#ead6aa"/><path d="M0 230Q160 80 330 235T640 200V360H0Z" fill="#657f78"/><path d="M0 290Q200 180 360 300T640 250V360H0Z" fill="#354e50"/><path d="M230 360Q390 290 330 230Q500 300 450 360" fill="#a7c2c7"/></svg>';

function checkFixtures() {
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
  const catalogue = new Map(require('../src/lib/stockFootageSuggestions.ts').stockTopicPool().map(idea => [idea.id, idea]));
  for (const template of templates) {
    assert.equal(catalogue.get(template.id)?.title, template.title);
    assert.equal(catalogue.get(template.id)?.query, template.query);
  }
  const helpers = require('../src/lib/quickTemplates.ts');
  assert.deepEqual(helpers.parseQuickTemplateRequest(JSON.stringify(request)), request);
  assert.equal(helpers.quickTemplateReview([file], request.jobId), file);
  assert.equal(new Set(templates.map(template => template.id)).size, 6);
  console.log('Six catalogue fixtures and the exact saved-request/completed-output match verified.');
}

async function run() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This proof runs only in GitHub Actions, never on the owner laptop.');
  assert.equal(process.env.GITHUB_REPOSITORY, 'rushig0203-cyber/Phoenix-Studio');
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  const temporaryRoot = path.resolve(process.env.RUNNER_TEMP || '');
  const output = path.resolve(process.env.PHOENIX_UI_PROOF_DIR || '');
  assert.ok(process.env.RUNNER_TEMP && process.env.PHOENIX_UI_PROOF_DIR && output.startsWith(`${temporaryRoot}${path.sep}`), 'Proof output must be inside runner.temp.');
  const directory = process.env.PHOENIX_BUILD_DIR;
  assert.match(directory || '', /^\.next-[a-z0-9-]+$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'storage/active-build.json'), 'utf8')).directory, directory);
  const buildId = fs.readFileSync(path.join(root, directory, 'BUILD_ID'), 'utf8').trim();
  assert.ok(buildId);
  const playwrightModule = path.resolve(process.env.PHOENIX_PLAYWRIGHT_MODULE || '');
  assert.ok(process.env.PHOENIX_PLAYWRIGHT_MODULE && playwrightModule.startsWith(`${temporaryRoot}${path.sep}`), 'Playwright must come from the temporary CI install.');
  const { chromium } = require(playwrightModule);
  const port = Number(process.env.PHOENIX_UI_PORT || 3107);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const origin = `http://127.0.0.1:${port}`;
  fs.mkdirSync(output, { recursive: true });
  const temporaryMedia = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-ui-smoke-'));
  const movie = path.join(temporaryMedia, 'synthetic.mp4');
  let server, browser, page, serverLog = '', pendingTemplate = false, releaseSuggestions;
  const suggestionsGate = new Promise(resolve => { releaseSuggestions = resolve; });
  const proof = { status: 'running', synthetic: true, source: process.env.GITHUB_SHA, directory, buildId,
    assertions: [], screenshots: [], stylesheets: [], apiReads: [], deniedRequests: [], pageErrors: [] };
  const verify = (name, condition, detail) => { assert.ok(condition, `${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`); proof.assertions.push({ name, ...(detail ? { detail } : {}) }); };
  const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  try {
    const rendered = spawnSync(require('@ffmpeg-installer/ffmpeg').path,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x657f78:s=360x640:r=12', '-t', '2', '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', movie],
      { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
    const media = fs.readFileSync(movie);
    server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)],
      { cwd: root, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=384', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupError;
    server.on('error', error => { startupError = error; });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog = `${serverLog}${chunk}`.slice(-100000); });
    const deadline = Date.now() + 60000;
    while (true) {
      if (startupError) throw startupError;
      assert.equal(server.exitCode, null, `Next stopped before verification: ${serverLog}`);
      try { if ((await fetch(`${origin}/dashboard`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* Wait for the isolated Next server. */ }
      assert.ok(Date.now() < deadline, `Next did not become ready: ${serverLog}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const stylesheetUrls = new Set();
    context.on('page', active => {
      active.on('pageerror', error => proof.pageErrors.push(error.message));
      active.on('response', response => { if (new URL(response.url()).pathname.endsWith('.css') && response.ok()) stylesheetUrls.add(response.url()); });
    });
    await context.route('**/*', async route => {
      const incoming = route.request(), url = new URL(incoming.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(incoming.method())) {
        proof.deniedRequests.push(`${incoming.method()} ${incoming.url()}`);
        return route.abort('blockedbyclient');
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      proof.apiReads.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/review-files') return json(route, pendingTemplate ? [] : [file]);
      if (url.pathname === '/api/source-processing') return json(route, { jobs: pendingTemplate ? [{ id: request.jobId, title: request.title, status: 'PROCESSING', progress: 37, stage: 'Preparing the next scene', createdAt: date }] : [] });
      if (['/api/generations', '/api/review-edits', '/api/creation-drafts'].includes(url.pathname)) return json(route, []);
      if (url.pathname === '/api/studio-health') return json(route, { build: directory, worker: { state: 'healthy', heartbeatAt: date }, resources: { busy: false, waitingForMemory: false, freeMiB: 4096, reason: 'Synthetic CI service status' },
        services: { writerProvider: 'groq', writer: { state: 'ready', detail: 'Fixture writer' }, renderer: { state: 'ready', detail: 'Fixture renderer' } } });
      if (url.pathname === '/api/content-suggestions') { await suggestionsGate; return json(route, { ideas: templates, nextCursor: 6 }); }
      if (url.pathname === '/api/channels') return json(route, { channels });
      if (url.pathname === '/api/writing-provider') return json(route, { provider: 'groq', model: 'fixture', configured: true, hasKey: false, freePlanConfirmed: true, detail: 'Synthetic CI writer settings. No provider requests are made.' });
      if (url.pathname === '/api/instagram-performance') return json(route, { status: 'ready', account: { name: '@fixture_wildlife' }, detail: 'Synthetic saved results for UI verification.', lastSuccessfulSyncAt: date, historyComplete: true, scannedVideos: 1,
        videos: [{ id: 'fixture-post', topic: 'A quiet river', timestamp: date, metricsUpdatedAt: date, metrics: { views: 120, likes: 8, comments: 2, saves: 3, shares: 1, reach: 100, averageWatchTimeMs: 5200 } }], summary: { assessments: [], rules: [], attentionCohorts: [] } });
      if (url.pathname === `/api/review-files/${file.id}`) return json(route, file);
      if (url.pathname === `/api/review-files/${file.id}/poster`) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: poster });
      if (url.pathname === `/api/review-files/${file.id}/media`) return route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'Content-Length': String(media.length), 'Accept-Ranges': 'bytes' }, body: media });
      if (url.pathname === `/api/review-files/${file.id}/publish`) {
        if (url.searchParams.get('check') === 'story') return json(route, { story: { ready: false, reason: 'Synthetic fixture: optional Stories are unavailable.' } });
        if (url.searchParams.get('check') === 'posting-defaults') return json(route, { defaults: { userTags: [] } });
        if (!url.searchParams.has('check')) return json(route, { jobs: [] });
      }
      proof.deniedRequests.push(`${incoming.method()} ${url.pathname}${url.search}`);
      return route.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"Unmocked CI request"}' });
    });
    const capture = async name => {
      const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
        dialog: document.querySelector('dialog[open]')?.scrollWidth, dialogClient: document.querySelector('dialog[open]')?.clientWidth }));
      verify(`${name}: no horizontal overflow`, widths.document <= widths.viewport + 1 && (!widths.dialog || widths.dialog <= widths.dialogClient + 1), widths);
      const openDialog = page.getByRole('dialog');
      verify(`${name}: named screen heading`, await openDialog.count() ? await openDialog.getByRole('heading', { level: 2 }).count() === 1 : await page.getByRole('heading', { level: 1 }).count() === 1);
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
      proof.screenshots.push(`${name}.png`);
    };
    page = await context.newPage();
    await page.goto(`${origin}/dashboard#create`);
    await page.locator('[data-quick-templates][aria-busy="true"]').getByRole('status').waitFor();
    await capture('studio-loading');
    releaseSuggestions();
    await page.waitForFunction(() => document.querySelectorAll('[data-quick-template]').length === 6 && document.querySelector('[data-quick-templates]')?.getAttribute('aria-busy') === 'false');
    verify('Six named template actions', await page.getByRole('button', { name: /^Make video: / }).count() === 6);
    await page.keyboard.press('Tab');
    await page.locator('[data-quick-template]').first().focus();
    const style = await page.locator('[data-quick-template]').first().evaluate(element => { const css = getComputedStyle(element); return { radius: css.borderRadius, outline: css.outlineStyle, outlineWidth: css.outlineWidth, background: getComputedStyle(document.body).backgroundColor }; });
    verify('Actual compiled CSS: open rows, warm canvas and keyboard focus', style.radius === '0px' && style.background === 'rgb(245, 243, 237)' && style.outline !== 'none' && parseFloat(style.outlineWidth) >= 2, style);
    await page.locator('[data-quick-template]').first().blur();
    await capture('studio-create-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('studio-create-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const navigate = async section => { await page.locator(`nav[aria-label="Studio sections"] a[href="#${section}"]`).click(); await page.locator(`nav[aria-label="Studio sections"] a[href="#${section}"][aria-current="page"]`).waitFor(); };
    await navigate('library');
    await page.getByRole('button', { name: `Preview ${file.title}`, exact: true }).waitFor();
    await capture('studio-library');
    await navigate('insights');
    await page.getByRole('region', { name: 'Instagram insights', exact: true }).getByText('Synthetic saved results for UI verification.').waitFor();
    await capture('studio-insights');
    await navigate('settings');
    await page.locator('#channels').getByText('Fixture youtube channel', { exact: true }).waitFor();
    await capture('studio-settings');
    pendingTemplate = true;
    page = await context.newPage();
    await page.addInitScript(value => localStorage.setItem('phoenix-quick-template-v1', JSON.stringify(value)), request);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${origin}/dashboard#create`);
    await page.locator('[data-template-progress] progress[value="37"]').waitFor();
    await capture('studio-progress');
    pendingTemplate = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Preview: ${file.title}`, exact: true });
    await dialog.waitFor();
    await page.waitForFunction(() => { const video = document.querySelector('dialog[open] video'); return video && video.readyState >= 2; });
    await dialog.locator('video').evaluate(video => video.pause());
    const post = dialog.getByRole('button', { name: 'Post to Instagram', exact: true });
    await post.waitFor();
    await page.waitForFunction(() => { const button = document.querySelector('dialog[open] section[aria-label="Instagram upload confirmation"] button[type="submit"]'); return button && !button.disabled; });
    await post.scrollIntoViewIfNeeded();
    verify('Exact completed output automatically opens from saved template request', await dialog.isVisible() && await page.evaluate(() => localStorage.getItem('phoenix-quick-template-v1')) === null);
    verify('Direct final Post is visible and enabled', await post.isVisible() && await post.isEnabled());
    verify('Final review has no intermediate Post / export action', await dialog.getByRole('button', { name: 'Post / export', exact: true }).count() === 0);
    verify('Video preview uses the focused dark stage', await dialog.locator('video').evaluate(video => getComputedStyle(video.parentElement).backgroundColor) === 'rgb(21, 30, 36)');
    await capture('studio-final-review');
    await page.setViewportSize({ width: 390, height: 844 });
    await post.scrollIntoViewIfNeeded();
    await capture('studio-final-review-mobile');
    verify('No browser runtime errors', proof.pageErrors.length === 0, proof.pageErrors);
    verify('No provider, external or mutating browser requests', proof.deniedRequests.length === 0, proof.deniedRequests);
    verify('Actual built stylesheets loaded', stylesheetUrls.size > 0);
    proof.stylesheets = [...stylesheetUrls];
    proof.status = 'passed';
    console.log(`Built UI proof passed: ${proof.screenshots.length} screenshots, ${proof.assertions.length} assertions. No publishing action was clicked.`);
  } catch (error) {
    proof.status = 'failed'; proof.error = error.stack || String(error);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'studio-ui-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    releaseSuggestions();
    fs.writeFileSync(path.join(output, 'studio-ui-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    if (browser) await browser.close();
    if (server && server.exitCode === null) { server.kill(); await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.writeFileSync(path.join(output, 'studio-ui-server.log'), serverLog);
    assert.ok(path.resolve(temporaryMedia).startsWith(`${path.resolve(os.tmpdir())}${path.sep}phoenix-ui-smoke-`));
    fs.rmSync(temporaryMedia, { recursive: true, force: true });
  }
}
if (require.main === module) {
  if (process.argv.includes('--check-fixtures')) checkFixtures();
  else run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

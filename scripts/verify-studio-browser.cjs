// CI-only UI proof with synthetic APIs and WebM preview; real MP4 export is verified separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const date = '2026-11-17T12:00:00Z';
const templateTitles = ['Owls', 'Pandas', 'Rabbits', 'Waterfall', 'Switzerland', 'Lake'];
const templates = templateTitles.map((title, index) => ({ id: `footage-${title.toLowerCase()}`, title, query: title,
  workflow: 'stock-reel', category: 'Nature & wildlife', reason: `A fresh ${title.toLowerCase()} idea inspired by your saved wildlife and outdoor videos.`,
  opening: { provider: 'pexels', id: index + 1, image: `https://images.pexels.com/fixture-opening-${index + 1}.jpg` } }));
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
  const origin = `http://localhost:${port}`;
  fs.mkdirSync(output, { recursive: true });
  const temporaryMedia = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-ui-smoke-'));
  const movie = path.join(temporaryMedia, 'synthetic.webm');
  let server, browser, page, serverLog = '', pendingTemplate = false, releaseSuggestions, showPostingProgress = false;
  const suggestionsGate = new Promise(resolve => { releaseSuggestions = resolve; });
  const proof = { status: 'running', synthetic: true, source: process.env.GITHUB_SHA, directory, buildId,
    assertions: [], screenshots: [], stylesheets: [], apiReads: [], deniedRequests: [], pageErrors: [] };
  const verify = (name, condition, detail) => { assert.ok(condition, `${name}${detail ? `: ${JSON.stringify(detail)}` : ''}`); proof.assertions.push({ name, ...(detail ? { detail } : {}) }); };
  const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  const publicationJobs = () => {
    if (!showPostingProgress) return [];
    const updatedAt = new Date().toISOString();
    return [
      { id: 'fixture-upload-ig', reviewId: file.id, platform: 'instagram', status: 'UPLOADING', percent: 87, bytesUploaded: 92, totalBytes: 100, accountName: '@fixture_wildlife', detail: 'Sending the saved Reel.', privacy: 'public', updatedAt },
      { id: 'fixture-upload-fb', reviewId: file.id, platform: 'facebook', status: 'COMPLETE', percent: 100, bytesUploaded: 100, totalBytes: 100, accountName: 'Fixture Facebook Page', detail: 'Reel published.', privacy: 'public', updatedAt },
      { id: 'fixture-upload-yt', reviewId: file.id, platform: 'youtube', status: 'PROCESSING', percent: 96, bytesUploaded: 100, totalBytes: 100, accountName: 'Fixture YouTube Channel', detail: 'YouTube is processing the upload.', privacy: 'public', updatedAt },
    ];
  };
  try {
    const rendered = spawnSync(require('@ffmpeg-installer/ffmpeg').path,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x657f78:s=360x640:r=12', '-t', '2', '-an', '-c:v', 'libvpx', '-deadline', 'realtime', '-threads', '1', '-pix_fmt', 'yuv420p', movie],
      { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
    const media = fs.readFileSync(movie);
    server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(port)],
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
    const fallback = await fetch(origin + '/api/studio-wallpaper', { signal: AbortSignal.timeout(5000) });
    verify('A fresh installation has a valid empty wallpaper response', fallback.status === 204);
    const logoFallback = await fetch(origin + '/api/studio-logo', { signal: AbortSignal.timeout(5000) });
    verify('A fresh installation has a valid empty logo response', logoFallback.status === 204);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const stylesheetUrls = new Set();
    context.on('page', active => {
      active.on('pageerror', error => proof.pageErrors.push(error.message));
      active.on('response', response => { if (new URL(response.url()).pathname.endsWith('.css') && response.ok()) stylesheetUrls.add(response.url()); });
    });
    await context.route('**/*', async route => {
      const incoming = route.request(), url = new URL(incoming.url());
      if (incoming.method() === 'GET' && templates.some(template => template.opening.image === url.href)) {
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: poster });
      }
      if (url.origin !== origin || !['GET', 'HEAD'].includes(incoming.method())) {
        proof.deniedRequests.push(`${incoming.method()} ${incoming.url()}`);
        return route.abort('blockedbyclient');
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      proof.apiReads.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/review-files') return json(route, pendingTemplate ? [] : [file]);
      if (url.pathname === '/api/source-processing') return json(route, { preflight: { ready: true, summary: 'Synthetic video tools ready', dependencies: { ffmpeg: true, ffprobe: true, python: true, fasterWhisper: true }, details: {}, firstModelDownloadRequired: false, whisperModel: { message: '' } }, jobs: pendingTemplate ? [{ id: request.jobId, title: request.title, status: 'PROCESSING', progress: 37, stage: 'Preparing the next scene', createdAt: date }] : [] });
      if (['/api/generations', '/api/review-edits', '/api/creation-drafts'].includes(url.pathname)) return json(route, []);
      if (url.pathname === '/api/studio-wallpaper' || url.pathname === '/api/studio-logo') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: poster });
      if (url.pathname === '/api/studio-health') return json(route, { build: directory, worker: { state: 'healthy', heartbeatAt: date }, resources: { busy: false, waitingForMemory: false, freeMiB: 4096, reason: 'Synthetic CI service status' },
        services: { writerProvider: 'groq', writer: { state: 'ready', detail: 'Fixture writer' }, renderer: { state: 'ready', detail: 'Fixture renderer' } } });
      if (url.pathname === '/api/content-suggestions') {
        // Creation recommendations are a bounded local metadata read on this empty CI installation.
        if (url.searchParams.get('workflow') === 'creation') return route.continue();
        await suggestionsGate; return json(route, { ideas: templates, nextCursor: 6 });
      }
      if (url.pathname === '/api/singing/status') return json(route, { available: false, reason: 'Synthetic CI: no singing provider is contacted.' });
      if (url.pathname === '/api/channels') return json(route, { channels });
      if (url.pathname === '/api/manager/status') return json(route, {
        mode: 'local-feedback', checkedAt: date, queued: 0, running: 0, failed: 0, reviewReady: 1,
        guidance: { feedbackCount: 0, revision: 'synthetic-night', rules: [] },
        assessments: [{ reviewId: file.id, title: file.title, createdAt: date, creationType: 'source', decision: 'AWAITING_REVIEW', blockers: [], checks: ['Synthetic UI fixture.'] }],
        capabilities: { singing: false, animation: 'Synthetic UI fixture', learning: 'No provider or owner feedback is used.' },
      });
      if (url.pathname === '/api/writing-provider') return json(route, { provider: 'groq', model: 'fixture', configured: true, hasKey: false, freePlanConfirmed: true, detail: 'Synthetic CI writer settings. No provider requests are made.' });
      if (url.pathname === '/api/instagram-performance') return json(route, { status: 'ready', account: { name: '@fixture_wildlife' }, detail: 'Synthetic saved results for UI verification.', lastSuccessfulSyncAt: date, historyComplete: true, scannedVideos: 1,
        videos: [{ id: 'fixture-post', topic: 'A quiet river', timestamp: date, metricsUpdatedAt: date, metrics: { views: 120, likes: 8, comments: 2, saves: 3, shares: 1, reach: 100, averageWatchTimeMs: 5200 } }], summary: { assessments: [], rules: [], attentionCohorts: [] } });
      if (url.pathname === '/api/facebook-performance' || url.pathname === '/api/youtube-performance') {
        const youtube = url.pathname.includes('youtube');
        return json(route, { status: 'ready', account: { name: youtube ? 'Fixture YouTube counts' : 'Fixture Facebook counts' },
          detail: 'Synthetic basic video results.', lastSuccessfulSyncAt: date, videos: [{ id: youtube ? 'Abcdef_1234' : '12345',
            caption: youtube ? 'YouTube count fixture' : 'Facebook count fixture', timestamp: date,
            metrics: { views: youtube ? 73 : 61, likes: 3, comments: 1, shares: null } }] });
      }
      if (url.pathname === `/api/review-files/${file.id}`) return json(route, file);
      if (url.pathname === `/api/review-files/${file.id}/edit`) return json(route, {
        duration: 12, width: 1080, height: 1920, canReplaceCaptions: true, previewIsClean: true,
        mediaUrl: `/api/review-files/${file.id}/media?target=instagram`, jobs: [],
        draft: { title: file.title, postCopy: file.quality.postCopy, hashtags: file.quality.hashtags,
          trimStart: 0, trimEnd: 12, format: 'original', framing: 'fit', cropPosition: .5, volume: 1,
          captionsEnabled: true, captionPosition: 'bottom', captionSize: 36, captionColor: '#ffffff',
          cues: [{ start: 0, end: 2, text: 'Synthetic subtitle color stays white.' }] },
      });
      if (url.pathname === `/api/review-files/${file.id}/poster`) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: poster });
      if (url.pathname === `/api/review-files/${file.id}/media`) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Content-Length': String(media.length), 'Accept-Ranges': 'bytes' }, body: media });
      if (url.pathname === '/api/review-publications') return json(route, { jobs: publicationJobs(), titles: { [file.id]: file.title } });
      if (url.pathname === `/api/review-files/${file.id}/publish`) {
        if (url.searchParams.get('check') === 'story') return json(route, { story: { ready: true, reason: 'Synthetic eligible Business account.' } });
        if (url.searchParams.get('check') === 'posting-defaults') return json(route, { defaults: { userTags: [] } });
        if (!url.searchParams.has('check')) return json(route, { jobs: publicationJobs() });
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
      const theme = await page.evaluate(() => {
        const scope = document.querySelector('[data-studio-theme="night"]');
        if (!scope) return { missing: true };
        const style = getComputedStyle(scope), area = document.querySelector('dialog[open]') || document.querySelector('main');
        const lightSurfaces = area ? [area, ...area.querySelectorAll('section, article, fieldset, details, label, select, textarea, input:not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="range"])')]
          .filter(element => element.getClientRects().length > 0).flatMap(element => {
            const background = getComputedStyle(element).backgroundColor;
            const channels = background.match(/[\d.]+/g)?.map(Number) || [];
            return channels.length >= 3 && channels.slice(0, 3).every(value => value > 175) && (channels[3] ?? 1) > .9
              ? [{ tag: element.tagName, label: element.getAttribute('aria-label'), background }] : [];
          }) : [];
        return { canvas: style.backgroundColor, scheme: style.colorScheme, lightSurfaces };
      });
      verify(`${name}: The charcoal palette covers panels and native fields`, theme.canvas === 'rgb(16, 16, 19)' && theme.scheme === 'dark' && theme.lightSurfaces.length === 0, theme);
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
      proof.screenshots.push(`${name}.png`);
    };
    page = await context.newPage();
    await page.goto(`${origin}/dashboard#create`);
    await page.locator('[data-quick-templates][aria-busy="true"]').getByRole('status').waitFor();
    verify('Recommendation loading uses shared indeterminate activity', await page.locator('[data-quick-templates] .studio-activity progress:not([value])').count() === 1);
    await capture('studio-loading');
    releaseSuggestions();
    await page.waitForFunction(() => document.querySelectorAll('[data-quick-template]').length === 6 && document.querySelector('[data-quick-templates]')?.getAttribute('aria-busy') === 'false');
    verify('Six named template actions', await page.getByRole('button', { name: /^Make video: / }).count() === 6);
    await page.keyboard.press('Tab');
    await page.locator('[data-quick-template]').first().focus();
    const style = await page.locator('[data-quick-template]').first().evaluate(element => { const css = getComputedStyle(element); return { radius: css.borderRadius, outline: css.outlineStyle, outlineWidth: css.outlineWidth, background: getComputedStyle(element.closest('[data-studio-theme]')).backgroundColor }; });
    verify('Cards stay in focus above the space backdrop', parseFloat(style.radius) >= 12 && style.background === 'rgba(0, 0, 0, 0)' && style.outline !== 'none' && parseFloat(style.outlineWidth) >= 2, style);
    await page.locator('[data-quick-template]').first().blur();
    const hero = await page.locator('[data-studio-hero="create"]').evaluate(element => {
      const panel = getComputedStyle(element);
      return { panel: panel.backgroundColor, image: panel.backgroundImage,
        before: getComputedStyle(element, '::before').backgroundImage, border: panel.borderTopColor };
    });
    verify('The Create controls sit directly over the starfield without a separate picture panel',
      hero.image === 'none' && hero.before === 'none' && hero.panel === 'rgba(0, 0, 0, 0)' && hero.border === 'rgba(0, 0, 0, 0)', hero);
    const artworkOnly = await page.locator('[data-studio-hero="create"]').evaluate(element => {
      const heading = element.querySelector('h1');
      return { heading: heading.textContent, headingSize: heading.parentElement.getBoundingClientRect().height,
        actionCount: element.querySelectorAll('a,button').length };
    });
    verify('Create keeps the headline visually hidden and exposes all three workflows',
      artworkOnly.heading === 'Create' && artworkOnly.headingSize <= 1 && artworkOnly.actionCount === 3, artworkOnly);
    const reelFont = await page.locator('[data-template-title]').first().evaluate(element => getComputedStyle(element).fontFamily);
    verify('Reel cards use the new serif title style', reelFont.includes('Georgia'), reelFont);
    const stars = page.locator('[data-studio-starfield]');
    const starLayers = () => stars.evaluate(element => ({
      hidden: element.getAttribute('aria-hidden'), perspective: getComputedStyle(element).perspective,
      pointerEvents: getComputedStyle(element).pointerEvents,
      artwork: getComputedStyle(element, '::before').backgroundImage,
      artworkSize: getComputedStyle(element, '::before').backgroundSize,
      animations: [...element.querySelectorAll('[data-star-depth]')].map(layer => getComputedStyle(layer).animationName),
    }));
    const stillStars = await starLayers();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const movingStars = await starLayers();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    verify('The original artwork covers the starfield behind the dashboard',
      stillStars.artwork.includes('/api/studio-wallpaper') && stillStars.artworkSize === 'cover', stillStars);
    verify('Three perspective layers drift only when motion is allowed and stay behind interactive content',
      movingStars.hidden === 'true' && movingStars.pointerEvents === 'none' && parseFloat(movingStars.perspective) > 0
      && movingStars.animations.length === 3 && movingStars.animations.every(name => name !== 'none')
      && stillStars.animations.length === 3 && stillStars.animations.every(name => name === 'none'), { stillStars, movingStars });
    const covers = await page.locator('[data-quick-template]').evaluateAll(cards => cards.map(card =>
      [...card.querySelectorAll('img')].map(image => image.src)));
    verify('Each suggestion has exactly one image from its selected opening clip', covers.length === templates.length
      && covers.every((images, index) => images.length === 1 && images[0] === templates[index].opening.image), covers);
    const logo = await page.locator('[data-studio-topbar] .studio-brand-mark').evaluate(mark => {
      const image = getComputedStyle(mark, '::after');
      return { image: image.backgroundImage, zoom: image.backgroundSize, label: mark.parentElement.textContent };
    });
    verify('The brand mark shows the local logo with a tight crop and the Phoenix name', logo.image.includes('/api/studio-logo')
      && ['230%', '230% auto'].includes(logo.zoom) && logo.label.endsWith('Phoenix Studio'), logo);
    await capture('studio-create-desktop');
    const workflows = page.getByRole('navigation', { name: 'Creation workflows', exact: true });
    await workflows.getByRole('link', { name: 'Clip a Video', exact: true }).click();
    const highlights = page.getByRole('radio', { name: 'Best highlights', exact: true });
    await highlights.check();
    verify('Clipping has its own workspace with real mode suggestions and no automatic upload', await page.getByRole('heading', { level: 1, name: 'Clip your video', exact: true }).isVisible()
      && await highlights.isChecked() && await page.getByRole('button', { name: /^Make video:/ }).count() === 0);
    await capture('studio-clips');
    await workflows.getByRole('link', { name: 'Create a Video', exact: true }).click();
    await page.getByRole('button', { name: /^Use idea:/ }).first().waitFor();
    verify('Create a Video has its own six registered suggestions', await page.getByRole('button', { name: /^Use idea:/ }).count() === 6
      && await page.getByRole('heading', { level: 1, name: 'Create a video', exact: true }).isVisible());
    await capture('studio-create-video');
    await page.getByText('Describe your video', { exact: true }).click();
    await page.getByLabel('Your idea').fill('Krishna and Meera watch stars at night');
    await page.getByRole('button', { name: /^Use idea:/ }).first().waitFor();
    verify('A new Krishna idea stays editable and does not force a series or the Butter Pot starter', await page.getByLabel('Your idea').inputValue() === 'Krishna and Meera watch stars at night'
      && await page.getByLabel('Output quantity').inputValue() === '1');
    await capture('studio-create-krishna');
    await page.getByLabel('Your idea').fill('An original Krishna flower song for children');
    await page.getByRole('button', { name: /^Use idea:/ }).first().waitFor();
    await page.getByLabel('Song language').selectOption('Hindi');
    verify('Hindi songs keep lyrics optional and engine instructions collapsed', await page.getByRole('button', { name: /^Use idea:/ }).count() === 6
      && await page.getByLabel('Lyrics, one line at a time').getAttribute('required') === null
      && await page.getByText('Song options & engine details', { exact: true }).locator('..').getAttribute('open') === null);
    await capture('studio-create-song');
    await workflows.getByRole('link', { name: 'Clip a Video', exact: true }).click();
    verify('Switching creation workspaces retains the selected clip style', await highlights.isChecked());
    await workflows.getByRole('link', { name: 'Make a Reel', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNav = await page.locator('nav[aria-label="Studio sections"]').evaluate(nav => {
      const bounds = nav.getBoundingClientRect();
      return { viewport: innerWidth, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth,
        items: [...nav.querySelectorAll('a')].map(link => { const item = link.getBoundingClientRect(); return { label: link.innerText.trim(), left: item.left, right: item.right,
          fits: link.scrollWidth <= link.clientWidth + 1 && item.left >= bounds.left - 1 && item.right <= bounds.right + 1 }; }) };
    });
    verify('All four mobile navigation labels fit without swiping', mobileNav.items.length === 4 && mobileNav.scrollWidth <= mobileNav.clientWidth + 1
      && mobileNav.items.every(item => item.fits && item.left >= 0 && item.right <= mobileNav.viewport)
      && mobileNav.items[3].label === 'Settings', mobileNav);
    const mobileCreation = await workflows.evaluate(nav => {
      const links = [...nav.querySelectorAll('a')].map(link => link.getBoundingClientRect());
      const firstTemplate = document.querySelector('[data-quick-template]').getBoundingClientRect();
      return { rows: new Set(links.map(link => Math.round(link.top))).size,
        minHeight: Math.min(...links.map(link => link.height)), lastRight: Math.max(...links.map(link => link.right)),
        viewport: innerWidth, firstTemplateBottom: firstTemplate.bottom, viewportHeight: innerHeight };
    });
    verify('Mobile creation paths are one tappable row and the first template is in reach', mobileCreation.rows === 1
      && mobileCreation.minHeight >= 44 && mobileCreation.lastRight <= mobileCreation.viewport
      && mobileCreation.firstTemplateBottom < mobileCreation.viewportHeight, mobileCreation);
    await capture('studio-create-mobile');
    await page.locator('a[data-queue-state][href="#jobs"]').click();
    await page.waitForFunction(() => {
      const heading = document.querySelector('#jobs h2').getBoundingClientRect();
      const nav = document.querySelector('[data-studio-topbar]').getBoundingClientRect();
      return location.hash === '#jobs' && heading.top >= nav.bottom - 1 && heading.bottom <= innerHeight;
    });
    verify('Jobs jump opens the queue below the sticky mobile navigation', await page.getByRole('heading', { name: 'Jobs', exact: true }).isVisible());
    await page.setViewportSize({ width: 1440, height: 1000 });
    const navigate = async section => { await page.locator(`nav[aria-label="Studio sections"] a[href="#${section}"]`).click(); await page.locator(`nav[aria-label="Studio sections"] a[href="#${section}"][aria-current="page"]`).waitFor(); };
    await navigate('library');
    await page.getByRole('button', { name: `Preview ${file.title}`, exact: true }).waitFor();
    await capture('studio-library');
    await navigate('insights');
    await page.getByRole('region', { name: 'Instagram insights', exact: true }).getByText('Synthetic saved results for UI verification.').waitFor();
    await capture('studio-insights');
    const insightPlatforms = page.getByRole('group', { name: 'Insight platforms' });
    for (const [platform, count] of [['Facebook', '61'], ['YouTube', '73']]) {
      await insightPlatforms.getByRole('button', { name: platform, exact: true }).click();
      const sample = page.locator('dl[aria-label="Saved ' + platform + ' sample"]');
      await sample.waitFor();
      verify(platform + ' displays its own measured counts', (await sample.locator('dd').allTextContents()).join(',') === '1,' + count + ',3,1');
      verify(platform + ' uses distinct readable metric tiles', await sample.locator('div').first().evaluate(tile => {
        const style = getComputedStyle(tile);
        return style.backgroundColor === 'rgb(36, 35, 41)' && parseFloat(style.borderRadius) >= 8;
      }));
      await capture('studio-insights-' + platform.toLowerCase());
    }
    await insightPlatforms.getByRole('button', { name: 'Rumble', exact: true }).click();
    verify('Rumble links to its creator dashboard without invented metrics', await page.getByRole('link', { name: /Open Rumble dashboard/ }).getAttribute('href') === 'https://rumble.com/account/dashboard'
      && await page.locator('#channel-insights dl').count() === 0);
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
    const nativePreview = () => dialog.locator('video').evaluate(video => {
      const bounds = video.getBoundingClientRect();
      return { background: getComputedStyle(video.parentElement).backgroundColor, renderedRatio: bounds.width / bounds.height,
        nativeRatio: video.videoWidth / video.videoHeight };
    });
    const desktopPreview = await nativePreview();
    verify('Preview fits the complete frame without a dark stage', desktopPreview.background === 'rgba(0, 0, 0, 0)'
      && Math.abs(desktopPreview.renderedRatio - desktopPreview.nativeRatio) < .02, desktopPreview);
    await capture('studio-final-review');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePreview = await nativePreview();
    verify('Mobile preview preserves the source aspect ratio', Math.abs(mobilePreview.renderedRatio - mobilePreview.nativeRatio) < .02, mobilePreview);
    const strip = dialog.locator('[data-posting-status-strip]');
    const stripBounds = await strip.evaluate(element => { const bounds = element.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom, viewport: innerHeight }; });
    verify('Mobile posting strip is visible before scrolling', stripBounds.top >= 0 && stripBounds.bottom <= stripBounds.viewport, stripBounds);
    const storyChoice = dialog.getByLabel(/Also publish one matching Story/);
    await page.waitForFunction(() => { const box = [...document.querySelectorAll('dialog label')].find(label => label.textContent.includes('Also publish one matching Story'))?.querySelector('input'); return box && !box.disabled; });
    verify('Matching Story is visible and off by default', await storyChoice.isVisible() && !await storyChoice.isChecked());
    await storyChoice.check();
    verify('Matching Story stays an explicit optional choice', (await dialog.locator('[data-posting-summary]').innerText()).includes('Reel + matching Story'));
    await storyChoice.uncheck();
    await post.scrollIntoViewIfNeeded();
    const postingSurfaces = await dialog.locator('section[aria-label^="Posting tools for"], section[aria-label$="upload confirmation"]').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return { label: element.getAttribute('aria-label'), background: style.backgroundColor, radius: style.borderRadius,
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], padding: [style.paddingLeft, style.paddingRight] };
    }));
    verify('Mobile final review uses open posting surfaces', postingSurfaces.length === 2 && postingSurfaces.every(surface => surface.background === 'rgba(0, 0, 0, 0)'
      && surface.radius === '0px' && surface.borders.every(width => width === '0px') && surface.padding.every(width => width === '0px')), postingSurfaces);
    await capture('studio-final-review-mobile');
    await page.setViewportSize({ width: 1440, height: 1200 });
    const instagram = dialog.getByRole('region', { name: 'Instagram upload confirmation', exact: true });
    await instagram.locator('[data-posting-details] > summary').click();
    await instagram.getByLabel('Caption and hashtags', { exact: true }).fill('Owner-reviewed caption kept while choosing platforms.');
    await instagram.locator('[data-posting-details] > summary').click();
    const destinations = dialog.getByRole('group', { name: 'Choose a platform', exact: true });
    await destinations.getByRole('button', { name: 'Facebook Page', exact: true }).click();
    await dialog.getByRole('region', { name: 'Facebook Page upload confirmation', exact: true }).waitFor();
    await destinations.getByRole('button', { name: 'YouTube', exact: true }).click();
    const youtube = dialog.getByRole('region', { name: 'YouTube upload confirmation', exact: true });
    await youtube.waitFor();
    verify('New YouTube uploads visibly default to public before final approval', /\bpublic\b/.test(await youtube.locator('[data-posting-summary]').innerText()));
    verify('Instagram Facebook and YouTube remain in one posting area together', await dialog.locator('[data-posting-panel]').count() === 1
      && await dialog.locator('[data-posting-destinations] > [data-posting-destination]').count() === 3
      && await dialog.locator('[data-posting-destinations] > [data-posting-destination]:not([hidden])').count() === 1);
    await destinations.getByRole('button', { name: 'Instagram', exact: true }).click();
    verify('Opening more platforms retains the Instagram caption and ready final action', await instagram.getByLabel('Caption and hashtags', { exact: true }).inputValue() === 'Owner-reviewed caption kept while choosing platforms.'
      && await instagram.getByRole('button', { name: 'Post to Instagram', exact: true }).isEnabled());
    await destinations.getByRole('button', { name: 'Rumble · assisted', exact: true }).click();
    const rumble = dialog.getByRole('region', { name: 'Rumble assisted upload', exact: true });
    verify('Rumble opens alongside Instagram and links to the creator dashboard', await rumble.isVisible() && await instagram.isVisible()
      && await rumble.getByRole('link', { name: /Open Rumble dashboard/ }).getAttribute('href') === 'https://rumble.com/account/dashboard');
    showPostingProgress = true;
    await instagram.getByRole('button', { name: 'Check status', exact: true }).click();
    const instagramIcon = strip.locator('[data-posting-platform="instagram"]');
    await instagramIcon.getByText('Uploading · 92%', { exact: true }).waitFor();
    verify('One compact strip shows measured transfer, confirmed completion and processing together', await instagramIcon.locator('svg').count() === 1
      && (await strip.locator('[data-posting-platform="facebook"]').getAttribute('aria-description')) === 'Done'
      && (await strip.locator('[data-posting-platform="youtube"]').getAttribute('aria-description')) === 'Processing');
    verify('Saved transfer detail starts collapsed', await instagram.locator('details').filter({ hasText: 'Upload details' }).getAttribute('open') === null);
    await capture('studio-parallel-posting');
    await dialog.getByRole('button', { name: 'Close video preview', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const dock = page.locator('[data-posting-dock]');
    await dock.locator('button[aria-expanded="false"]').click();
    verify('Closing the preview keeps the three distinct posting destinations available in the corner',
      await dock.locator('[data-posting-dock-job]').count() === 3
      && await dock.getByRole('progressbar', { name: 'Instagram Reel transfer', exact: true }).getAttribute('aria-valuenow') === '92');
    await dock.getByRole('button', { name: 'Open video', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Close video preview', exact: true }).click();
    showPostingProgress = false;
    await page.goto(`${origin}/dashboard/settings`);
    await page.getByRole('heading', { name: 'Publishing settings', exact: true }).waitFor();
    await page.getByText('Writer connection', { exact: true }).click();
    await page.getByText('Writing settings · preferred writer', { exact: true }).click();
    await page.getByLabel('Groq API key', { exact: true }).waitFor();
    await capture('studio-publishing-settings-night');
    await page.goto(`${origin}/dashboard/manager`);
    await page.getByRole('heading', { name: 'Quality manager', exact: true }).waitFor();
    await page.getByText('Ratings & optional note', { exact: true }).click();
    await page.getByRole('combobox').first().waitFor();
    await capture('studio-quality-manager-night');
    await page.goto(`${origin}/dashboard/edit/${file.id}`);
    await page.getByLabel('Trim start', { exact: true }).waitFor();
    await capture('studio-editor-night');
    verify('No browser runtime errors', proof.pageErrors.length === 0, proof.pageErrors);
    verify('No provider, external or mutating browser requests', proof.deniedRequests.length === 0, proof.deniedRequests);
    verify('Actual built stylesheets loaded', stylesheetUrls.size > 0);
    proof.stylesheets = [...stylesheetUrls];
    proof.status = 'passed';
    console.log(`Built UI proof passed: ${proof.screenshots.length} screenshots, ${proof.assertions.length} assertions. No publishing action was clicked.`);
  } catch (error) {
    proof.status = 'failed'; proof.error = error.stack || String(error);
    console.error(JSON.stringify({ apiReads: proof.apiReads, deniedRequests: proof.deniedRequests, pageErrors: proof.pageErrors }));
    if (page && !page.isClosed()) console.error((await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')).slice(-6000));
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

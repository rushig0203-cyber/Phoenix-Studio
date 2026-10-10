const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Inert JSX, isolated hooks, mocked fetch and manual intervals. Type-only
// channel/review/publishing imports disappear during transpilation: no provider,
// credential store, app server, media decoder, network or real timer is loaded.
const project = path.resolve(__dirname, '..');
function compiled(relative) {
  const filename = path.join(project, relative);
  return { filename, source: ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText };
}
const componentSource = compiled('src/components/ReviewPublishActions.tsx');
const postingSource = compiled('src/lib/posting.ts');
const postingPolicySource = compiled('src/lib/postingCopyPolicy.ts');
const storyIdeasSource = compiled('src/lib/instagramStoryIdeas.ts');
const locationSuggestionsSource = compiled('src/lib/instagramLocationSuggestions.ts');
const instagramAudioSource = compiled('src/lib/instagramAudio.ts');
const instagramTagsSource = compiled('src/lib/instagramTags.ts');
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [tree, ...nodes(tree.props.children)];
}
const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, async json() { return value; } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sampleFile = (extra = {}) => ({
  id: 'review video/one', title: 'Saved review video', status: 'READY', audience: 'general',
  updatedAt: '2026-10-03T00:00:00Z', source: { kind: 'local', filename: 'fixture.mp4' },
  outputs: {
    youtube: { width: 1920, height: 1080, duration: 12 },
    instagram: { width: 1080, height: 1920, duration: 12 },
  },
  quality: { postCopy: 'Saved caption', hashtags: ['#fixture', '#video'], captions: [] },
  ...extra,
});
const channel = (platform, extra = {}) => ({
  platform, configured: true, connected: true, state: 'connected', oauthAvailable: false,
  name: platform === 'youtube' ? 'Owned YouTube channel' : '@owned_instagram',
  accountId: `fixture-${platform}`, connectionRevision: `revision-${platform}`,
  publishReady: true, ...extra,
});
const job = (extra = {}) => ({
  id: 'saved-upload', fileId: 'review video/one', platform: 'youtube', accountName: 'Saved YouTube destination',
  status: 'COMPLETE', percent: 100, detail: 'Upload is complete.', privacy: 'private', canContinue: false,
  ...extra,
});
const recommendationResult = (extra = {}) => ({
  preference: 'english-and-instrumental', basis: 'sampled-frames', mood: 'calm', energy: 'low',
  reason: 'Sampled frames show still water and trees, suggesting a calm visual mood.', ...extra,
});

function uiHarness(options = {}) {
  let active, nextInterval = 0;
  const requests = [], intervals = new Map(), cleared = [], deadlines = [], copied = [];
  const document = { hidden: false };
  let file = options.file || sampleFile();
  const endpoint = `/api/review-files/${encodeURIComponent(file.id)}/publish`;
  const channels = options.channels || [channel('youtube'), channel('instagram')];
  const savedJobs = options.jobs || [];
  const hooks = {
    useState(initial) {
      assert.ok(active, 'State hooks require an isolated renderer');
      const renderer = active, index = renderer.index++;
      if (!Object.hasOwn(renderer.slots, index)) renderer.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [renderer.slots[index], next => {
        const value = typeof next === 'function' ? next(renderer.slots[index]) : next;
        if (!Object.is(value, renderer.slots[index])) { renderer.slots[index] = value; renderer.dirty = true; }
      }];
    },
    useRef(initial) {
      assert.ok(active, 'Ref hooks require an isolated renderer');
      const index = active.index++;
      if (!Object.hasOwn(active.slots, index)) active.slots[index] = { current: initial };
      return active.slots[index];
    },
    useEffect(callback, dependencies) {
      assert.ok(active, 'Effect hooks require an isolated renderer');
      const index = active.index++, previous = active.effects[index];
      const deps = dependencies ? Array.from(dependencies) : undefined;
      if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        active.pending.push({ index, callback, deps });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('MockFragment') },
  };
  const shared = {
    // The real posting helper validates catalogue URLs before stripping footers.
    // Node VM contexts do not include this browser global by default.
    document, AbortController, URL, TextEncoder,
    navigator: { clipboard: { async writeText(value) {
      if (options.clipboardUnavailable) throw new Error('Clipboard unavailable');
      copied.push(value);
    } } },
    AbortSignal: {
      timeout(duration) { deadlines.push(duration); return new AbortController().signal; },
      any(signals) {
        const controller = new AbortController();
        for (const signal of signals) {
          if (signal.aborted) { controller.abort(signal.reason); break; }
          signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
        }
        return controller.signal;
      },
    },
    setInterval(callback, duration) {
      const id = ++nextInterval;
      intervals.set(id, { callback, duration });
      return id;
    },
    clearInterval(id) { cleared.push(id); intervals.delete(id); },
    fetch(url, init = {}) {
      const request = { url, ...init, method: init.method || 'GET' };
      requests.push(request);
      const storyCheck = url.startsWith(`${endpoint}?check=story&connectionRevision=`);
      const locationCheck = url.startsWith(`${endpoint}?check=location&q=`);
      const audioCheck = url.startsWith(`${endpoint}?check=audio&q=`);
      const recommendationCheck = url.startsWith(`${endpoint}?check=audio-recommendations&connectionRevision=`);
      const defaultsCheck = url.startsWith(`${endpoint}?check=posting-defaults&connectionRevision=`);
      assert.ok(url === '/api/channels' || url === endpoint || storyCheck || locationCheck || audioCheck || recommendationCheck || defaultsCheck, `Unexpected isolated UI endpoint: ${url}`);
      if (request.method === 'GET') {
        const result = options.read?.(request, requests);
        return Promise.resolve(result === undefined ? response(url === '/api/channels' ? { channels } : storyCheck ? { story: options.story || { ready: false, reason: 'Stories unavailable in this fixture.' } } : defaultsCheck ? { defaults: options.defaults === undefined ? { userTags: [] } : options.defaults } : locationCheck ? { locations: options.locations || [] } : recommendationCheck ? { audio: options.audio || [], recommendation: options.recommendation === undefined ? recommendationResult() : options.recommendation } : audioCheck ? { audio: options.audio || [] } : { jobs: savedJobs }) : result);
      }
      assert.equal(request.method, 'POST', 'UI never authorizes, deletes or mutates channel configuration');
      assert.equal(url, endpoint);
      assert.ok(options.post, 'Only tests of an explicitly confirmed submission may supply a mocked POST response');
      return Promise.resolve(options.post(request, requests));
    },
  };
  function load(compiledSource) {
    const module = { exports: {} };
    const context = vm.createContext({ ...shared, module, exports: module.exports, require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected isolated publishing UI import: ${name}`);
      return dependencies[name];
    } });
    new vm.Script(compiledSource.source, { filename: compiledSource.filename }).runInContext(context, { timeout: 1000 });
    return module.exports;
  }
  dependencies['./postingCopyPolicy'] = dependencies['@/lib/postingCopyPolicy'] = load(postingPolicySource);
  dependencies['@/lib/posting'] = load(postingSource);
  dependencies['@/lib/instagramStoryIdeas'] = load(storyIdeasSource);
  dependencies['@/lib/instagramLocationSuggestions'] = load(locationSuggestionsSource);
  dependencies['@/lib/instagramAudio'] = load(instagramAudioSource);
  dependencies['@/lib/instagramTags'] = load(instagramTagsSource);
  const Component = load(componentSource).default;
  const renderer = { index: 0, slots: [], effects: [], pending: [], dirty: true, mounted: true, tree: undefined };
  function render() {
    if (!renderer.mounted) return;
    for (let pass = 0; renderer.dirty; pass++) {
      assert.ok(pass < 20, 'Mock effects settle without an update loop');
      renderer.dirty = false; renderer.index = 0; renderer.pending = [];
      active = renderer;
      try { renderer.tree = Component({ file }); }
      finally { active = undefined; }
      for (const effect of renderer.pending) {
        renderer.effects[effect.index]?.cleanup?.();
        renderer.effects[effect.index] = { deps: effect.deps, cleanup: effect.callback() };
      }
    }
  }
  render();
  const h = {
    get file() { return file; }, endpoint, requests, intervals, cleared, deadlines, copied, document, render,
    updateFile(next) { file = next; renderer.dirty = true; render(); },
    get tree() { return renderer.tree; }, get text() { return text(renderer.tree); },
    get posts() { return requests.filter(request => request.method === 'POST'); },
    async flush() { for (let pass = 0; pass < 50; pass++) { render(); await Promise.resolve(); } render(); },
    unmount() {
      renderer.mounted = false;
      for (const effect of renderer.effects) effect?.cleanup?.();
    },
    button(label) { return nodes(renderer.tree).find(node => node.type === 'button' && text(node) === label); },
    control(label, type) {
      const parent = nodes(renderer.tree).find(node => node.type === 'label' && text(node).startsWith(label));
      return parent && nodes(parent).find(node => node.type === type);
    },
    confirmation() { return h.control('I have reviewed this video', 'input'); },
    form() { return nodes(renderer.tree).find(node => node.type === 'form'); },
    click(label) {
      const target = h.button(label);
      assert.ok(target, `Expected button: ${label}`);
      assert.equal(Boolean(target.props.disabled), false, `User can click ${label}`);
      target.props.onClick();
    },
    choose(label) {
      if (!h.button(label)) { h.click('Post / export'); render(); }
      h.click(label);
    },
    change(control, value) {
      assert.ok(control, 'Expected a visible form control');
      assert.equal(Boolean(control.props.disabled), false, 'User can edit this control');
      control.props.onChange({ target: control.props.type === 'checkbox' ? { checked: value } : { value } });
    },
    submit(form = h.form()) {
      assert.ok(form, 'Expected a visible form');
      let prevented = false;
      form.props.onSubmit({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true, 'Form submits through the explicit UI handler');
    },
    tick() {
      assert.equal(intervals.size, 1, 'Only one upload progress poll is active');
      intervals.values().next().value.callback();
    },
  };
  return h;
}

test('mount is inert and opening or checking a platform only reads accounts and saved jobs', async t => {
  const h = uiHarness(); t.after(() => h.unmount());
  await h.flush();
  assert.equal(h.requests.length, 0);
  assert.equal(nodes(h.tree).filter(node => node.type === 'section').length, 0);
  assert.deepEqual(nodes(h.tree).filter(node => node.type === 'button').map(text), ['Post / export']);
  h.click('Post / export'); h.render();
  assert.equal(h.requests.length, 0, 'Opening the chooser does not even check accounts until a platform is chosen');
  assert.equal(h.button('Post / export').props['aria-expanded'], true);
  assert.equal(nodes(h.tree).filter(node => node.type === 'a').length, 0);
  h.choose('Upload to YouTube'); h.render();
  assert.match(h.text, /Checking saved account and previous uploads/);
  await h.flush();
  assert.deepEqual(h.requests.map(request => [request.method, request.url]), [
    ['GET', '/api/channels'], ['GET', '/api/review-files/review%20video%2Fone/publish'],
  ]);
  assert.ok(h.requests.every(request => request.cache === 'no-store' && request.signal));
  assert.match(h.text, /Destination: Owned YouTube channel/);
  assert.equal(h.confirmation().props.checked, false);
  assert.equal(h.button('Confirm upload').props.disabled, true);
  h.click('Check status'); await h.flush();
  assert.equal(h.requests.length, 4);
  assert.ok(h.requests.every(request => request.method === 'GET'));
  assert.equal(h.intervals.size, 0);
});

test('location ideas are optional, honest and inert until explicit Meta search', async t => {
  const h = uiHarness({ file: sampleFile({ title: 'Swiss mountain scenery' }) }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.match(h.text, /No verified filming location is saved/);
  assert.match(h.text, /Mentioned in the video description · unverified/);
  assert.match(h.text, /No location selected/);
  const count = h.requests.length;
  h.click('Switzerland'); await h.flush();
  assert.equal(h.control('Place name or Facebook location Page ID', 'input').props.value, 'Switzerland');
  assert.equal(h.requests.length, count, 'A country chip only fills search and does not call Meta or post');
  h.click('Find location'); await h.flush();
  const lookup = h.requests.at(-1);
  assert.equal(lookup.method, 'GET');
  assert.ok(lookup.url.includes('?check=location&q=Switzerland&connectionRevision=revision-instagram'));
  assert.match(h.text, /No eligible Meta location was found/);
  assert.equal(h.posts.length, 0);
  assert.equal(h.confirmation().props.checked, false);
});

test('eligible result requires selection and fresh final approval; only its ID joins the confirmed Reel', async t => {
  let saved;
  const h = uiHarness({ locations: [{ id: '123456', name: 'Zurich, Switzerland' }], post(request) {
    saved = JSON.parse(request.body);
    return response({ job: job({ platform: 'instagram', location: { id: '123456', name: 'Zurich, Switzerland' } }) });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  h.change(h.control('Place name or Facebook location Page ID', 'input'), 'Zurich'); h.render();
  h.click('Find location'); await h.flush();
  h.change(h.confirmation(), true); h.render();
  h.click('Zurich, Switzerland'); h.render();
  assert.equal(h.confirmation().props.checked, false, 'Changing posting location resets final approval');
  assert.equal(h.button('Confirm and publish Reel').props.disabled, true);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.location, { id: '123456' });
  assert.equal(h.posts.length, 1);
  assert.match(h.text, /Approved location tag: Zurich, Switzerland/);
});

test('Meta setup failure is actionable and does not block ordinary untagged posting or silently choose a country', async t => {
  let saved;
  const h = uiHarness({ read(request) {
    if (request.url.includes('?check=location')) return response({ locations: [], reason: 'Configure your Meta App Secret to search eligible locations. Add a location manually in Instagram meanwhile.' });
  }, post(request) {
    saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  h.click('Switzerland'); h.render(); h.click('Find location'); await h.flush();
  assert.match(h.text, /Configure your Meta App Secret/);
  assert.match(h.text, /Reel will post without a tag/);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.equal(saved.location, undefined);
  assert.equal(h.posts.length, 1);
});

test('editing or leaving during location lookup aborts and rejects stale result', async t => {
  const waiting = deferred();
  const h = uiHarness({ read(request) { if (request.url.includes('?check=location')) return waiting.promise; } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  h.click('Switzerland'); h.render(); h.click('Find location'); await h.flush();
  const request = h.requests.at(-1);
  assert.equal(h.button('Checking Meta locations…').props.disabled, true);
  h.change(h.control('Place name or Facebook location Page ID', 'input'), 'Norway'); await h.flush();
  assert.equal(request.signal.aborted, true);
  waiting.resolve(response({ locations: [{ id: '123456', name: 'Stale Zurich' }] })); await h.flush();
  assert.equal(h.button('Stale Zurich'), undefined);
  assert.equal(h.posts.length, 0);
});

test('saved location cannot be edited on continuation, and YouTube never shows or submits location choices', async t => {
  const h = uiHarness({ jobs: [job({ platform: 'instagram', location: { id: '123456', name: 'Approved place' } })] }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.match(h.text, /Approved location tag: Approved place/);
  assert.equal(h.button('Find location'), undefined);
  h.choose('Upload to YouTube'); await h.flush();
  assert.equal(h.control('Place name or Facebook location Page ID', 'input'), undefined);
  assert.ok(!h.requests.some(request => request.url.includes('?check=location')));
});

test('editing reviewed title, copy, privacy or kids audience invalidates previous final approval', async t => {
  const h = uiHarness(); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  for (const [label, type, value] of [['YouTube title', 'input', 'New title'], ['Description and hashtags', 'textarea', 'New reviewed copy'], ['Privacy', 'select', 'public'], ['This video is made for kids', 'input', true]]) {
    h.change(h.confirmation(), true); h.render();
    assert.equal(h.button('Confirm upload').props.disabled, false);
    h.change(h.control(label, type), value); h.render();
    assert.equal(h.confirmation().props.checked, false, `${label} resets approval`);
    assert.equal(h.button('Confirm upload').props.disabled, true);
    h.submit(); await h.flush();
    assert.equal(h.posts.length, 0, 'A stale approval never submits');
  }
});

test('YouTube uses its 5000-byte metadata limit and rejects forbidden brackets before a confirmed POST', async t => {
  const h = uiHarness({ post: () => response({ job: job() }) }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.equal(h.control('Description and hashtags', 'textarea').props.maxLength, 5000);
  for (const [label, type, value, issue] of [
    ['Description and hashtags', 'textarea', 'é'.repeat(2501), /5000 UTF-8 bytes/],
    ['Description and hashtags', 'textarea', 'A visible <tree>', /descriptions cannot contain/],
    ['YouTube title', 'input', 'A tree > another', /titles cannot contain/],
  ]) {
    h.change(h.control('YouTube title', 'input'), 'Reviewed title');
    h.change(h.control('Description and hashtags', 'textarea'), 'Reviewed description'); h.render();
    h.change(h.control(label, type), value); h.render();
    h.change(h.confirmation(), true); h.render();
    assert.match(h.text, issue);
    assert.equal(h.button('Confirm upload').props.disabled, true);
    h.submit(); await h.flush();
    assert.equal(h.posts.length, 0, 'Invalid metadata never reaches the local publishing API');
  }
  const caption = 'é'.repeat(2500);
  h.change(h.control('YouTube title', 'input'), 'Reviewed title');
  h.change(h.control('Description and hashtags', 'textarea'), caption); h.render();
  h.change(h.confirmation(), true); h.render();
  assert.equal(h.button('Confirm upload').props.disabled, false);
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 1); assert.equal(JSON.parse(h.posts[0].body).caption, caption);
});

test('a changed video revision invalidates approval and a retained old submit handler cannot upload it', async t => {
  const h = uiHarness({ post: () => response({ job: job() }) }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  h.change(h.confirmation(), true); h.render();
  assert.equal(h.button('Confirm upload').props.disabled, false);
  const oldForm = h.form();
  h.updateFile({ ...h.file, updatedAt: '2026-10-04T00:00:00Z', outputs: { ...h.file.outputs,
    youtube: { ...h.file.outputs.youtube, duration: 18 } } });
  assert.equal(h.confirmation().props.checked, false);
  assert.equal(h.button('Confirm upload').props.disabled, true);
  h.submit(oldForm); h.submit(); await h.flush();
  assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render();
  h.submit(oldForm); await h.flush();
  assert.equal(h.posts.length, 0, 'The old form cannot borrow approval for the changed video');
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 1, 'The current video can be explicitly approved again');
});

test('irrelevant new prop object does not cancel approval but unavailable output does', async t => {
  const h = uiHarness({ post: () => response({ job: job() }) }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  h.change(h.confirmation(), true); h.render();
  const available = h.file;
  h.updateFile({ ...h.file, quality: { ...h.file.quality } });
  assert.equal(h.confirmation().props.checked, true);
  h.updateFile({ ...h.file, status: 'NEEDS_RENDERER', outputs: {} });
  assert.equal(h.confirmation().props.checked, false);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.updateFile(available);
  assert.equal(h.confirmation().props.checked, false, 'Restoring the old metadata cannot restore an old approval');
});

test('missing or unready publishing permission offers setup without starting authorization or an upload', async t => {
  for (const channels of [[], [channel('youtube', { publishReady: false, publishReason: 'Uploading permission is missing.' })]]) {
    const h = uiHarness({ channels }); t.after(() => h.unmount());
    h.choose('Upload to YouTube'); await h.flush();
    const setup = nodes(h.tree).find(node => node.type === 'a' && text(node) === 'Open channel setup');
    assert.equal(setup.props.href, '/dashboard#settings');
    assert.equal(h.confirmation().props.disabled, true);
    assert.equal(h.button('Confirm upload').props.disabled, true);
    h.submit(); await h.flush();
    assert.equal(h.posts.length, 0);
    assert.ok(h.requests.every(request => request.method === 'GET'));
    assert.equal(h.requests.length, 2, 'No OAuth, verification or provider request starts automatically');
  }
});

test('manual export remains available without a connected account and platform copy uses the reviewed text', async t => {
  const tags = Array.from({length:20},(_,index)=>`#Waterfall${index}`);
  const file = sampleFile({quality:{postCopy:'Water flows over rocks.\nFootage source: https://pixabay.com/videos/fixture/',hashtags:tags,captions:[]}});
  const h = uiHarness({file,channels:[]});t.after(()=>h.unmount());
  h.choose('Post to Instagram');await h.flush();
  const manual = nodes(h.tree).find(node=>node.type==='details'&&text(node).startsWith('Manual export options'));
  assert.ok(manual);assert.equal(Boolean(manual.props.open),false);
  assert.match(text(manual),/do not upload or publish automatically/);
  const download = nodes(manual).find(node=>node.type==='a'&&text(node)==='Download for Instagram');
  assert.equal(download.props.href,'/api/review-files/review%20video%2Fone/media?target=instagram');
  const external = nodes(manual).find(node=>node.type==='a'&&text(node).startsWith('Open Instagram Create'));
  assert.equal(external.props.href,'https://www.instagram.com/');
  assert.equal(external.props.target,'_blank');assert.equal(external.props.rel,'noopener noreferrer');
  h.click('Copy Instagram text');await h.flush();
  assert.equal((h.copied[0].match(/#Waterfall\d+/g)||[]).length,5);
  assert.doesNotMatch(h.copied[0],/Footage source:/);
  h.change(h.control('Caption and hashtags','textarea'),'Reviewed caption #Waterfall');await h.flush();
  h.click('Copy Instagram text');await h.flush();
  assert.equal(h.copied[1],'Reviewed caption #Waterfall');
  h.choose('Upload to YouTube');await h.flush();
  h.click('Copy YouTube text');await h.flush();
  assert.equal((h.copied[2].match(/#Waterfall\d+/g)||[]).length,20);
  assert.equal(h.posts.length,0);assert.ok(h.requests.every(request=>request.method==='GET'));
  assert.deepEqual(file.quality.hashtags,tags);
});

test('a failed status check disables cached upload permission while retaining manual export', async t => {
  const h = uiHarness({read(_request,requests){if(requests.length>2)return response({error:'Account checks unavailable.'},503);}});
  t.after(()=>h.unmount());
  h.choose('Upload to YouTube');await h.flush();
  assert.equal(h.confirmation().props.disabled,false);
  h.click('Check status');await h.flush();
  assert.match(h.text,/Account checks unavailable/);
  assert.match(h.text,/Uploading setup could not be verified/);
  assert.equal(h.confirmation().props.disabled,true);assert.equal(h.button('Confirm upload').props.disabled,true);
  assert.ok(nodes(h.tree).some(node=>node.type==='a'&&text(node)==='Download for YouTube'));
  h.click('Copy YouTube text');await h.flush();
  assert.equal(h.copied.length,1);assert.match(h.text,/Account checks unavailable/);
  h.submit();await h.flush();assert.equal(h.posts.length,0);
});

test('clipboard failure preserves editable text and does not trigger a submission', async t => {
  const h = uiHarness({clipboardUnavailable:true});t.after(()=>h.unmount());
  h.choose('Upload to YouTube');await h.flush();
  const caption=h.control('Description and hashtags','textarea').props.value;
  h.click('Copy YouTube text');await h.flush();
  assert.match(h.text,/Clipboard unavailable/);
  assert.equal(h.control('Description and hashtags','textarea').props.value,caption);
  assert.equal(h.copied.length,0);assert.equal(h.posts.length,0);
});

test('an unavailable render cannot submit even after reviewing the rights checkbox', async t => {
  const h = uiHarness({ file: sampleFile({ status: 'NEEDS_RENDERER', outputs: {} }) }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  if (!h.confirmation().props.disabled) { h.change(h.confirmation(), true); await h.flush(); }
  assert.equal(h.button('Confirm upload').props.disabled, true);
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 0);
});

test('YouTube sends the reviewed title, copy, account revision, private privacy and kids choice only after final confirmation', async t => {
  const h = uiHarness({ file: sampleFile({ audience: 'kids-story', title: 'A'.repeat(130) }), post: () => response({ job: job() }) });
  t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.equal(h.control('YouTube title', 'input').props.value, 'A'.repeat(100));
  assert.equal(h.control('Privacy', 'select').props.value, 'private');
  assert.equal(h.control('This video is made for kids', 'input').props.checked, true);
  assert.equal(h.control('Description and hashtags', 'textarea').props.value, 'Saved caption\n\n#fixture #video');
  h.change(h.control('YouTube title', 'input'), 'Reviewed title');
  h.change(h.control('Description and hashtags', 'textarea'), 'Reviewed description\n\n#approved');
  await h.flush();
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 0, 'A form submit without the final checkbox cannot upload');
  assert.match(h.text, /approve uploading this video as private to Owned YouTube channel/);
  h.change(h.confirmation(), true); await h.flush();
  assert.equal(h.posts.length, 0, 'Checking the box alone does not upload');
  assert.equal(h.button('Confirm upload').props.disabled, false);
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(h.posts[0].body), {
    action: 'create', platform: 'youtube', title: 'Reviewed title', caption: 'Reviewed description\n\n#approved',
    privacy: 'private', madeForKids: true, connectionRevision: 'revision-youtube', confirm: true,
  });
  assert.equal(h.form(), undefined, 'An accepted saved request replaces the creation form');
});

test('Instagram explicitly confirms public publication and submits public privacy with the connected account revision', async t => {
  const h = uiHarness({ post: () => response({ job: job({ platform: 'instagram', accountName: '@owned_instagram', privacy: 'public' }) }) });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.control('YouTube title', 'input'), undefined);
  assert.equal(h.control('Privacy', 'select'), undefined);
  assert.equal(h.control('Caption and hashtags', 'textarea').props.maxLength, 2200);
  assert.match(h.text, /publishing this Reel publicly to @owned_instagram/);
  assert.equal(h.button('Confirm and publish Reel').props.disabled, true);
  h.change(h.control('Caption and hashtags', 'textarea'), 'Approved Reel caption #fixture'); await h.flush();
  assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); await h.flush();
  assert.equal(h.posts.length, 0);
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.deepEqual(JSON.parse(h.posts[0].body), {
    action: 'create', platform: 'instagram', title: 'Saved review video', caption: 'Approved Reel caption #fixture',
    privacy: 'public', madeForKids: false, connectionRevision: 'revision-instagram', confirm: true, companionStory: false,
  });
});

test('Instagram prefill takes five ranked tags from the saved bank without changing the twenty-tag YouTube description', async t => {
  const tags=Array.from({length:20},(_,index)=>`#Waterfall${index}`);
  const file=sampleFile({quality:{postCopy:'Water flows over rocks. #Waterfall0\nFootage source: https://pixabay.com/videos/fixture/',hashtags:tags,captions:[]}});
  const h=uiHarness({file});t.after(()=>h.unmount());
  h.choose('Post to Instagram');await h.flush();
  const instagram=h.control('Caption and hashtags','textarea').props.value;
  assert.equal((instagram.match(/#Waterfall\d+/g)||[]).length,5);
  assert.doesNotMatch(instagram,/Footage source/);assert.match(h.text,/5\/5 Instagram hashtags/);
  h.choose('Upload to YouTube');await h.flush();
  assert.equal((h.control('Description and hashtags','textarea').props.value.match(/#Waterfall\d+/g)||[]).length,20);
  assert.deepEqual(file.quality.hashtags,tags,'Saved candidate bank is not truncated by opening either platform');
  assert.equal(h.posts.length,0);
});

test('owner-added excess Instagram hashtags disable submission and return an explicit error without changing their caption', async t => {
  const h=uiHarness();t.after(()=>h.unmount());
  h.choose('Post to Instagram');await h.flush();
  const caption='Owner approved text #one #two #three #four #five ＃six';
  h.change(h.control('Caption and hashtags','textarea'),caption);h.change(h.confirmation(),true);await h.flush();
  assert.match(h.text,/6\/5 Instagram hashtags/);assert.equal(h.button('Confirm and publish Reel').props.disabled,true);
  h.submit();await h.flush();
  assert.equal(h.posts.length,0);assert.match(h.text,/at most five hashtags/);
  assert.equal(h.control('Caption and hashtags','textarea').props.value,caption);
  h.click('Copy Instagram text'); await h.flush();
  assert.equal(h.copied.length,0);assert.match(h.text,/nothing was copied or silently removed/);
});

test('two synchronous form submissions create one request and disable editing while the response is pending', async t => {
  const pending = deferred();
  const h = uiHarness({ post: () => pending.promise }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  h.change(h.confirmation(), true); await h.flush();
  const form = h.form();
  h.submit(form); h.submit(form); h.render();
  assert.equal(h.posts.length, 1, 'The ref guard protects before React can re-render a disabled button');
  assert.equal(h.button('Saving upload request…').props.disabled, true);
  assert.equal(h.button('Close').props.disabled, true);
  assert.equal(h.button('Post to Instagram').props.disabled, true);
  assert.equal(h.control('YouTube title', 'input').props.disabled, true);
  assert.equal(h.confirmation().props.disabled, true);
  pending.resolve(response({ job: job() })); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.equal(h.form(), undefined);
});

test('a previous upload displays actual saved status and its link instead of offering a duplicate creation form', async t => {
  const h = uiHarness({ jobs: [job({ remoteUrl: 'https://www.youtube.com/watch?v=fixture', privacy: 'unlisted', actualPrivacy: 'private' })] });
  t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.match(h.text, /Saved YouTube destination.*COMPLETE.*100%/);
  assert.match(h.text, /Requested visibility: unlisted/);
  assert.match(h.text, /Platform-confirmed visibility: private/);
  assert.match(h.text, /already has a saved YouTube upload request/);
  assert.equal(h.form(), undefined);
  assert.equal(h.button('Confirm upload'), undefined);
  const link = nodes(h.tree).find(node => node.type === 'a' && text(node).startsWith('View uploaded video'));
  assert.equal(link.props.href, 'https://www.youtube.com/watch?v=fixture');
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noopener noreferrer');
  h.click('Check status'); await h.flush();
  assert.equal(h.posts.length, 0);
  assert.equal(h.intervals.size, 0);
});

test('a failed saved upload waits for its own confirmation and explicit continue action', async t => {
  const saved = job({ status: 'FAILED', percent: 25, detail: 'Saved resumable session can be retried.', canContinue: true });
  const pending = deferred();
  const h = uiHarness({ jobs: [saved], post: () => pending.promise }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.equal(h.form(), undefined);
  assert.equal(h.posts.length, 0);
  assert.equal(h.intervals.size, 0, 'A failed job never retries itself on a timer');
  assert.equal(h.button('Continue saved upload').props.disabled, true);
  h.click('Check status'); await h.flush();
  assert.equal(h.posts.length, 0);
  h.change(h.control('Continue this saved upload to Saved YouTube destination', 'input'), true); await h.flush();
  assert.equal(h.posts.length, 0);
  const continueButton = h.button('Continue saved upload');
  assert.equal(continueButton.props.disabled, false);
  continueButton.props.onClick(); continueButton.props.onClick(); h.render();
  assert.equal(h.posts.length, 1);
  assert.deepEqual(JSON.parse(h.posts[0].body), { action: 'continue', jobId: 'saved-upload', confirm: true });
  pending.resolve(response({ job: job() })); await h.flush();
  assert.equal(h.button('Continue saved upload'), undefined);
  assert.equal(h.posts.length, 1);
});

test('an ambiguous saved submission requires checking and never exposes a continuation or duplicate upload', async t => {
  const h = uiHarness({ jobs: [job({ status: 'NEEDS_CHECK', percent: 50, detail: 'Check the provider before trying again.' })] });
  t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.match(h.text, /NEEDS CHECK/);
  assert.match(h.text, /Check the provider before trying again/);
  assert.equal(h.form(), undefined);
  assert.equal(h.button('Continue saved upload'), undefined);
  assert.equal(h.intervals.size, 0);
  h.click('Check status'); await h.flush();
  assert.equal(h.posts.length, 0);
  assert.ok(h.requests.every(request => request.method === 'GET'));
});

test('active job polling is read-only, skips hidden pages, avoids overlapping reads and aborts when closed', async t => {
  const pending = deferred(); let jobReads = 0;
  const h = uiHarness({ jobs: [job({ status: 'PROCESSING', percent: 80, detail: 'Provider is processing the saved upload.' })],
    read(request) { if (request.url !== '/api/channels' && ++jobReads > 1) return pending.promise; },
  });
  t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush();
  assert.equal(h.intervals.size, 1);
  assert.equal(h.intervals.values().next().value.duration, 5000);
  h.document.hidden = true; h.tick(); await h.flush();
  assert.equal(h.requests.length, 2, 'A hidden page does not poll');
  h.document.hidden = false; h.tick(); h.tick(); await h.flush();
  assert.equal(h.requests.length, 3, 'A pending poll cannot overlap another poll');
  const poll = h.requests[2];
  assert.equal(poll.method, 'GET'); assert.equal(poll.url, h.endpoint);
  assert.equal(poll.signal.aborted, false);
  h.click('Close'); await h.flush();
  assert.equal(h.intervals.size, 0);
  assert.ok(h.cleared.length > 0);
  assert.equal(poll.signal.aborted, true);
  pending.resolve(response({ jobs: [job({ detail: 'Late completed response' })] })); await h.flush();
  assert.equal(nodes(h.tree).filter(node => node.type === 'section').length, 0);
  assert.equal(h.posts.length, 0);
});

test('unmount clears the progress interval and aborts an outstanding job poll', async () => {
  const pending = deferred(); let jobReads = 0;
  const h = uiHarness({ jobs: [job({ status: 'UPLOADING', percent: 30 })],
    read(request) { if (request.url !== '/api/channels' && ++jobReads > 1) return pending.promise; },
  });
  h.choose('Upload to YouTube'); await h.flush();
  const intervalId = h.intervals.keys().next().value;
  h.tick();
  const poll = h.requests.at(-1);
  h.unmount();
  assert.equal(h.intervals.size, 0);
  assert.ok(h.cleared.includes(intervalId));
  assert.equal(poll.signal.aborted, true);
  pending.resolve(response({ jobs: [job()] })); await h.flush();
  assert.equal(h.posts.length, 0);
});

test('unmount aborts pending setup reads and prevents their late response from changing the closed UI', async () => {
  const accountRead = deferred(), jobRead = deferred();
  const h = uiHarness({ read(request) { return request.url === '/api/channels' ? accountRead.promise : jobRead.promise; } });
  h.choose('Upload to YouTube'); h.render();
  assert.equal(h.requests.length, 2);
  const before = h.tree;
  h.unmount();
  assert.ok(h.requests.every(request => request.signal.aborted));
  accountRead.resolve(response({ channels: [channel('youtube', { name: 'Late account response' })] }));
  jobRead.resolve(response({ jobs: [job()] })); await h.flush();
  assert.equal(h.tree, before);
  assert.equal(h.posts.length, 0);
  assert.equal(h.intervals.size, 0);
});

test('switching panels aborts the old setup request and rejects its stale account or job response', async t => {
  const oldChannels = deferred(), oldJobs = deferred();
  const h = uiHarness({ read(request, requests) {
    if (requests.length <= 2) return request.url === '/api/channels' ? oldChannels.promise : oldJobs.promise;
  } });
  t.after(() => h.unmount());
  h.choose('Upload to YouTube'); h.render();
  const firstReads = h.requests.slice();
  h.choose('Post to Instagram'); await h.flush();
  assert.ok(firstReads.every(request => request.signal.aborted));
  assert.match(h.text, /Instagram.*final posting review/);
  assert.match(h.text, /Destination: @owned_instagram/);
  oldChannels.resolve(response({ channels: [channel('instagram', { name: '@stale_account' })] }));
  oldJobs.resolve(response({ jobs: [job({ platform: 'instagram', accountName: '@stale_account' })] }));
  await h.flush();
  assert.doesNotMatch(h.text, /@stale_account/);
  assert.ok(h.form(), 'The stale old response cannot replace the current platform form');
  assert.equal(h.posts.length, 0);
});

test('eligible matching Story defaults on but cannot post without final Reel and Story approval', async t => {
  const h = uiHarness({ story: { ready: true, reason: 'Business confirmed; same saved MP4.' },
    post: () => response({ job: job({ platform: 'instagram', companionStoryApproved: true }) }) });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.requests.filter(item => item.url.includes('?check=story')).length, 1);
  assert.ok(h.requests.every(item => item.method === 'GET'));
  assert.equal(h.control('Also publish one matching Story', 'input').props.checked, true);
  assert.equal(h.confirmation().props.checked, false);
  assert.equal(h.button('Confirm Reel + Story').props.disabled, true);
  assert.match(h.text, /publishing this Reel publicly and then its matching Story/);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); await h.flush();
  h.change(h.control('Also publish one matching Story', 'input'), false); await h.flush();
  assert.equal(h.confirmation().props.checked, false, 'Changing the Story choice invalidates the old approval');
  h.change(h.control('Also publish one matching Story', 'input'), true);
  h.change(h.confirmation(), true); await h.flush();
  h.submit(); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.equal(JSON.parse(h.posts[0].body).companionStory, true);
  assert.equal(JSON.parse(h.posts[0].body).action, 'create');
});

test('Business confirmation only saves type evidence and still requires a separate final publish approval', async t => {
  const h = uiHarness({ story: { ready: false, requiresBusinessConfirmation: true, reason: 'Confirm Business type.' },
    post: () => response({ story: { ready: true, reason: 'Business confirmation saved.' } }) });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.button('Enable matching Stories').props.disabled, true);
  assert.equal(h.posts.length, 0);
  const details = nodes(h.tree).find(item => item.type === 'details' && text(item).startsWith('Confirm Business account'));
  assert.equal(Boolean(details.props.open), false);
  h.change(h.confirmation(), true); await h.flush();
  h.change(h.control('I checked:', 'input'), true); await h.flush();
  h.click('Enable matching Stories'); await h.flush();
  assert.deepEqual(JSON.parse(h.posts[0].body), { action: 'confirm-story-business', connectionRevision: 'revision-instagram', businessAccountConfirmed: true, confirm: true });
  assert.equal(h.posts.length, 1);
  assert.equal(h.confirmation().props.checked, false);
  assert.equal(h.button('Confirm Reel + Story').props.disabled, true);
  assert.ok(h.form(), 'Setup confirmation does not create a publishing job');
});

test('failed companion continues only its own Story and never creates or repeats the completed Reel', async t => {
  const story = job({ id: 'story-upload', kind: 'story', platform: 'instagram', status: 'FAILED', percent: 0,
    detail: 'Story setup failed; Reel remains posted.', canContinue: true });
  const parent = job({ platform: 'instagram', accountName: '@owned_instagram', companionStoryApproved: true, companionStory: story });
  const h = uiHarness({ jobs: [parent], post: () => response({ job: { ...story, status: 'COMPLETE', percent: 100, canContinue: false, remoteId: '12345' } }) });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.requests.length, 2, 'Saved upload status needs no new Story capability check');
  assert.equal(h.form(), undefined);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.button('Continue saved upload'), undefined);
  assert.equal(h.button('Continue matching Story').props.disabled, true);
  h.change(h.control('Continue only the matching Story.', 'input'), true); await h.flush();
  h.click('Continue matching Story'); await h.flush();
  assert.deepEqual(JSON.parse(h.posts[0].body), { action: 'continue-story', jobId: 'story-upload', confirm: true });
  assert.equal(h.posts.length, 1);
  assert.match(h.text, /Published Story ID: 12345/);
  assert.equal(h.button('Continue matching Story'), undefined);
});

test('completed Reel still polls its active companion using read-only status and stops when both finish', async t => {
  const story = job({ id: 'story-upload', kind: 'story', platform: 'instagram', status: 'PROCESSING', percent: 96 });
  const parent = job({ platform: 'instagram', companionStoryApproved: true, companionStory: story });
  let reads = 0;
  const h = uiHarness({ jobs: [parent], read(request) {
    if (request.url !== '/api/channels' && ++reads > 1) return response({ jobs: [{ ...parent, companionStory: { ...story, status: 'COMPLETE', percent: 100 } }] });
  } });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.intervals.size, 1);
  h.tick(); await h.flush();
  assert.equal(h.intervals.size, 0);
  assert.match(h.text, /Matching Story · COMPLETE · 100%/);
  assert.ok(h.requests.every(item => item.method === 'GET'));
});

const standaloneStoryJob = (extra = {}) => job({ id: 'standalone-story', kind: 'story', standaloneStory: true,
  platform: 'instagram', accountName: '@owned_instagram', detail: 'Saved standalone Story status.', ...extra });

test('Story-only opening is inert and reads account, saved jobs and capability without Reel posting choices', async t => {
  const h = uiHarness({file:sampleFile({source:{kind:'pexels'},quality:{audio:'local-music-replaced',hashtags:[],captions:[]}}),
    story:{ready:true,reason:'Confirmed Business account; saved MP4 eligible.'}});t.after(()=>h.unmount());
  await h.flush();assert.equal(h.requests.length,0);
  h.choose('Post Story only');await h.flush();
  assert.equal(h.requests.length,3);
  assert.ok(h.requests.some(request=>request.url==='/api/channels'));
  assert.ok(h.requests.some(request=>request.url===h.endpoint));
  assert.equal(h.requests.filter(request=>request.url.includes('?check=story&')).length,1);
  assert.ok(h.requests.every(request=>request.method==='GET'));
  assert.equal(h.requests.some(request=>/[?]check=(posting-defaults|audio|location)/.test(request.url)),false);
  for(const [label,type] of [['Caption and hashtags','textarea'],['Instagram usernames','input'],['Use Instagram music','input'],['Place name or Facebook location Page ID','input'],['Also publish one matching Story','input']]) assert.equal(h.control(label,type),undefined);
  assert.equal(h.confirmation().props.checked,false);assert.equal(h.button('Confirm Story only').props.disabled,true);
  assert.match(h.text,/Destination: @owned_instagram/);assert.match(h.text,/publishing this Story publicly/);
  h.submit();await h.flush();assert.equal(h.posts.length,0);
});

test('an eligible Story-only upload requires explicit fresh approval and sends no Reel configuration', async t => {
  let saved;
  const h=uiHarness({story:{ready:true,reason:'Confirmed Business account; saved MP4 eligible.'},post(request){saved=JSON.parse(request.body);return response({job:standaloneStoryJob({status:'QUEUED',percent:0})});}});t.after(()=>h.unmount());
  h.choose('Post Story only');await h.flush();h.submit();await h.flush();assert.equal(h.posts.length,0);
  h.change(h.confirmation(),true);h.render();assert.equal(h.button('Confirm Story only').props.disabled,false);
  h.submit();await h.flush();
  assert.deepEqual(saved,{action:'create-story',confirm:true,connectionRevision:'revision-instagram'});
  assert.equal(h.posts.length,1);assert.equal(h.form(),undefined);assert.match(h.text,/Saved standalone Story status/);
});

test('two synchronous Story-only submissions create one request and disable editing while it is pending', async t => {
  const waiting=deferred();const h=uiHarness({story:{ready:true,reason:'Confirmed Business account.'},post(){return waiting.promise;}});t.after(()=>h.unmount());
  h.choose('Post Story only');await h.flush();h.change(h.confirmation(),true);h.render();const form=h.form();
  h.submit(form);h.submit(form);h.render();assert.equal(h.posts.length,1);
  assert.deepEqual(JSON.parse(h.posts[0].body),{action:'create-story',confirm:true,connectionRevision:'revision-instagram'});
  assert.equal(h.confirmation().props.disabled,true);assert.equal(h.button('Post to Instagram').props.disabled,true);assert.equal(h.button('Post Story only').props.disabled,true);
  waiting.resolve(response({job:standaloneStoryJob({status:'QUEUED',percent:0})}));await h.flush();assert.equal(h.posts.length,1);
});

test('unverified Business type, unavailable Story media and missing upload permission block Story-only creation', async t => {
  for(const fixture of [
    {story:{ready:false,requiresBusinessConfirmation:true,reason:'Confirm the Instagram Business account type before posting Stories.'}},
    {story:{ready:false,reason:'The saved video exceeds the Story duration limit.'}},
    {channels:[channel('instagram',{publishReady:false,publishReason:'Instagram publishing permission is unavailable.'})]},
  ]) {
    const h=uiHarness(fixture);t.after(()=>h.unmount());h.choose('Post Story only');await h.flush();
    const approval=h.confirmation();if(approval&&!approval.props.disabled){h.change(approval,true);h.render();}
    assert.equal(h.button('Confirm Story only').props.disabled,true);
    if(h.form()){h.submit();await h.flush();}assert.equal(h.posts.length,0);
    assert.match(h.text,fixture.story?.requiresBusinessConfirmation?/Confirm the Instagram Business account type/:fixture.story?/exceeds the Story duration limit/:/publishing permission is unavailable/);
  }
});

test('a failed or completed saved Reel does not prevent a separately approved Story-only upload', async t => {
  for(const status of ['FAILED','COMPLETE']) {
    let saved;const h=uiHarness({jobs:[job({platform:'instagram',status,canContinue:status==='FAILED',detail:'Existing Reel status.'})],
      story:{ready:true,reason:'Confirmed Business account; saved MP4 eligible.'},post(request){saved=JSON.parse(request.body);return response({job:standaloneStoryJob({status:'QUEUED',percent:0})});}});t.after(()=>h.unmount());
    h.choose('Post Story only');await h.flush();assert.ok(h.form(),status);assert.equal(h.confirmation().props.checked,false);
    assert.equal(h.requests.filter(request=>request.url.includes('?check=story&')).length,1,status);
    h.change(h.confirmation(),true);h.render();h.submit();await h.flush();
    assert.deepEqual(saved,{action:'create-story',confirm:true,connectionRevision:'revision-instagram'});assert.equal(h.posts.length,1,status);
    assert.equal(JSON.parse(h.posts[0].body).jobId,undefined,'Creating a standalone Story never continues the saved Reel');
  }
});

test('a completed standalone Story shows saved status and its ID without a duplicate form or invented link', async t => {
  const h=uiHarness({jobs:[standaloneStoryJob({remoteId:'12345',detail:'Standalone Story published.'})]});t.after(()=>h.unmount());
  h.choose('Post Story only');await h.flush();assert.equal(h.form(),undefined);assert.equal(h.button('Confirm Story only'),undefined);
  assert.match(h.text,/Standalone Story published/);assert.match(h.text,/Published Story ID: 12345/);
  assert.equal(nodes(h.tree).some(node=>node.type==='a'&&typeof node.props.href==='string'&&node.props.href.includes('/stories/')),false);
  assert.equal(h.button('Continue saved upload'),undefined);assert.equal(h.posts.length,0);
  assert.equal(h.requests.some(request=>/[?]check=(posting-defaults|audio|location)/.test(request.url)),false);
});

test('a failed standalone Story requires its own explicit confirmation and continues only the saved Story', async t => {
  const saved=standaloneStoryJob({status:'FAILED',percent:0,canContinue:true,detail:'Retry the saved standalone Story.'});
  const h=uiHarness({jobs:[saved],post(){return response({job:{...saved,status:'COMPLETE',percent:100,canContinue:false,remoteId:'12345'}});}});t.after(()=>h.unmount());
  h.choose('Post Story only');await h.flush();assert.equal(h.form(),undefined);assert.equal(h.posts.length,0);
  const checkbox=nodes(h.tree).find(node=>node.type==='label'&&/Continue.*Story/.test(text(node)));
  const approval=checkbox&&nodes(checkbox).find(node=>node.type==='input');assert.ok(approval);assert.equal(approval.props.checked,false);
  const continuation=nodes(h.tree).find(node=>node.type==='button'&&/Continue.*Story/.test(text(node)));assert.ok(continuation);assert.equal(continuation.props.disabled,true);
  h.change(approval,true);h.render();h.click(text(continuation));await h.flush();
  assert.deepEqual(JSON.parse(h.posts[0].body),{action:'continue-story',jobId:'standalone-story',confirm:true});assert.equal(h.posts.length,1);
  assert.match(h.text,/Published Story ID: 12345/);assert.equal(h.form(),undefined);
});

test('Story-only mode shows an existing matching companion instead of creating a duplicate Story', async t => {
  for(const status of ['COMPLETE','FAILED']) {
    const story=job({id:'matching-story',kind:'story',platform:'instagram',status,percent:status==='COMPLETE'?100:0,canContinue:status==='FAILED',
      detail:'Existing matching Story status.',...(status==='COMPLETE'?{remoteId:'98765'}:{})});
    const h=uiHarness({jobs:[job({platform:'instagram',companionStoryApproved:true,companionStory:story})],
      post(){return response({job:{...story,status:'COMPLETE',percent:100,canContinue:false,remoteId:'98765'}});}});t.after(()=>h.unmount());
    h.choose('Post Story only');await h.flush();assert.equal(h.form(),undefined);assert.equal(h.button('Confirm Story only'),undefined);
    assert.match(h.text,/Existing matching Story status/);assert.equal(h.posts.length,0);
    if(status==='FAILED') {
      const checkbox=nodes(h.tree).find(node=>node.type==='label'&&/Continue.*Story/.test(text(node)));
      const approval=checkbox&&nodes(checkbox).find(node=>node.type==='input');assert.ok(approval);assert.equal(approval.props.checked,false);
      const continuation=nodes(h.tree).find(node=>node.type==='button'&&/Continue.*Story/.test(text(node)));assert.ok(continuation);assert.equal(continuation.props.disabled,true);
      h.change(approval,true);h.render();h.click(text(continuation));await h.flush();
      assert.deepEqual(JSON.parse(h.posts[0].body),{action:'continue-story',jobId:'matching-story',confirm:true});assert.equal(h.posts.length,1);
    } else assert.match(h.text,/Published Story ID: 98765/);
  }
});

test('an untouched matching Story can become Story only only with fresh approval of the same saved job', async t => {
  const waiting = deferred();
  const child = job({ id: 'matching-story', kind: 'story', platform: 'instagram', accountName: '@owned_instagram', status: 'QUEUED', percent: 0, canMakeStandalone: true, detail: 'The Reel failed before this matching Story was sent.' });
  const h = uiHarness({ jobs: [job({ platform: 'instagram', status: 'FAILED', companionStoryApproved: true, companionStory: child })], story: { ready: true, reason: 'Confirmed Business account; saved MP4 eligible.' }, post() { return waiting.promise; } }); t.after(() => h.unmount());
  h.choose('Post Story only'); await h.flush();
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.button('Confirm Story only').props.disabled, true);
  assert.match(h.text, /independently of the failed Reel/); assert.match(h.text, /private history/);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); const form = h.form(); h.submit(form); h.submit(form); h.render();
  assert.equal(h.posts.length, 1); assert.deepEqual(JSON.parse(h.posts[0].body), { action: 'create-story', jobId: 'matching-story', confirm: true, connectionRevision: 'revision-instagram' });
  waiting.resolve(response({ job: standaloneStoryJob({ id: 'matching-story', status: 'QUEUED', percent: 0 }) })); await h.flush();
  assert.equal(h.form(), undefined); assert.equal(h.posts.length, 1);
  h.choose('Post to Instagram'); await h.flush(); assert.equal(h.confirmation(), undefined, 'The original saved Reel is never automatically dispatched');
});

test('switching between Story-only, Reel and YouTube resets final approval before any upload', async t => {
  const h=uiHarness({story:{ready:true,reason:'Confirmed Business account; saved MP4 eligible.'}});t.after(()=>h.unmount());
  h.choose('Post Story only');await h.flush();h.change(h.confirmation(),true);h.render();assert.equal(h.confirmation().props.checked,true);
  h.choose('Post to Instagram');await h.flush();assert.equal(h.confirmation().props.checked,false);assert.ok(h.control('Caption and hashtags','textarea'));
  assert.equal(h.button('Confirm Reel + Story').props.disabled,true);h.change(h.confirmation(),true);h.render();
  h.choose('Post Story only');await h.flush();assert.equal(h.confirmation().props.checked,false);assert.equal(h.control('Caption and hashtags','textarea'),undefined);
  assert.equal(h.button('Confirm Story only').props.disabled,true);h.change(h.confirmation(),true);h.render();
  h.choose('Upload to YouTube');await h.flush();assert.equal(h.confirmation().props.checked,false);assert.equal(h.button('Confirm Story only'),undefined);
  assert.equal(h.button('Confirm upload').props.disabled,true);assert.equal(h.posts.length,0);
});

test('everyday Story prompts are collapsed, grounded in the saved clip and never trigger generation or publication', async t => {
  const h = uiHarness({ file: sampleFile({ title: 'A coastal sunrise', quality: { postCopy: 'Calm light.', hashtags: [], captions: [],
    postingAnalysis: { status: 'COMPLETE', observations: ['Waves reflecting orange light'] } } }) });
  t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  const details = nodes(h.tree).find(item => item.type === 'details' && text(item).startsWith('Everyday Story ideas'));
  assert.ok(details); assert.equal(Boolean(details.props.open), false);
  assert.equal(nodes(details).filter(item => item.type === 'li').length, 3);
  assert.match(text(details), /Waves reflecting orange light/);
  assert.match(text(details), /not automatically uploaded/);
  assert.equal(h.posts.length, 0);
  assert.ok(h.requests.every(item => item.method === 'GET'));
});

const audioResult = (extra = {}) => ({ audio_id: '587784541076604', title: 'Calm track', display_artist: 'Fixture artist',
  recommendation: { rank: 1, kind: 'english-vocal', reason: 'Reflective English vocals fit the quiet scenery.' }, ...extra });
test('Reel tagging is collapsed and explicit, clears approval and submits only normalized handles', async t => {
  let saved; const h = uiHarness({ post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram', userTags: saved.userTags }) }); } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  const details = nodes(h.tree).find(node => node.type === 'details' && text(node).startsWith('Tag people / pages · optional'));
  assert.ok(details); assert.equal(Boolean(details.props.open), false);
  assert.match(h.text, /Public Instagram accounts only/); assert.match(h.text, /not collaboration invitations/);
  const requests = h.requests.length;
  h.change(h.confirmation(), true); h.render();
  h.change(h.control('Instagram usernames', 'input'), '@Person, @Brand.page person'); h.render();
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.requests.length, requests, 'Editing tags never searches or contacts accounts');
  assert.match(h.text, /Reel tags: @person, @brand.page/);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.userTags, ['person', 'brand.page']); assert.equal(h.posts.length, 1);
  assert.match(h.text, /Approved Reel tags: @person, @brand.page/);
  assert.equal(h.control('Instagram usernames', 'input'), undefined, 'Saved approval is immutable');
});

test('invalid Reel tags block POST, blank input omits tags and switching platforms clears them', async t => {
  let saved; const h = uiHarness({ post(request) { saved = JSON.parse(request.body); return response({ job: job() }); } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  for (const invalid of ['https://instagram.com/person', 'bad..name', Array.from({length:21}, (_,i) => `user${i}`).join(',')]) {
    h.change(h.control('Instagram usernames', 'input'), invalid); h.render(); h.change(h.confirmation(), true); h.render();
    assert.equal(h.button('Confirm and publish Reel').props.disabled, true); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  }
  h.change(h.control('Instagram usernames', 'input'), '@person'); h.render();
  h.choose('Upload to YouTube'); await h.flush(); assert.equal(h.control('Instagram usernames', 'input'), undefined);
  h.choose('Post to Instagram'); await h.flush(); assert.equal(h.control('Instagram usernames', 'input').props.value, '');
  h.choose('Upload to YouTube'); await h.flush(); h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.equal(saved.userTags, undefined, 'Instagram tags never leak to YouTube');
});

test('an untagged Reel omits the optional parameter and continued uploads use only the saved job', async t => {
  let saved; const h = uiHarness({ post(request) { saved = JSON.parse(request.body); return response({ job: job({platform:'instagram'}) }); } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush(); h.change(h.confirmation(),true); h.render(); h.submit(); await h.flush(); assert.equal(saved.userTags,undefined);
  const continued = uiHarness({ jobs:[job({platform:'instagram',status:'NEEDS_CHECK',canContinue:true,userTags:['saved.person']})], post(request) { return response({job:job({platform:'instagram'})}); } }); t.after(() => continued.unmount());
  continued.choose('Post to Instagram'); await continued.flush(); assert.match(continued.text,/Approved Reel tags: @saved.person/);
  assert.equal(continued.control('Instagram usernames','input'),undefined);
  continued.change(continued.control('Continue this saved upload','input'),true); continued.render(); continued.click('Continue saved upload'); await continued.flush();
  assert.deepEqual(JSON.parse(continued.posts[0].body),{action:'continue',jobId:'saved-upload',confirm:true});
});

const footageFile = (audio = 'local-music-replaced') => sampleFile({
  source: { kind: 'pexels', filename: 'saved-stock.mp4' }, quality: { audio, hashtags: [], captions: [] },
});
const automaticMusicPanel = h => nodes(h.tree).find(node => node.type === 'section' && node.props['aria-label'] === 'Automatic Reel music');
function assertNoManualMusicControls(h) {
  for (const label of ['Use Instagram music', 'Keep saved video audio', 'Track or artist', 'Instagram track volume (%)', 'Saved video volume (%)']) {
    assert.equal(h.control(label, 'input'), undefined, label);
  }
  assert.equal(h.button('Find Instagram audio'), undefined);
  assert.equal(nodes(automaticMusicPanel(h)).some(node => node.type === 'button' || node.type === 'input'), false,
    'Automatic music has no manual selection, search or volume controls');
  assert.equal(nodes(h.tree).some(node => node.type === 'audio'), false, 'Catalog audio is never downloaded or autoplayed');
}

test('narration and song reviews preserve their saved MP4 audio without a manual music panel or catalog lookup', async t => {
  for (const creationType of ['children-story', 'children-song']) {
    let saved;
    const h = uiHarness({ file: sampleFile({ source: { kind: 'local' }, audience: 'kids-3-6',
      delivery: { creationType }, quality: { audio: 'local-narration-music', hashtags: [], captions: [] } }),
      audio: [audioResult()], post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assertNoManualMusicControls(h);
    assert.equal(h.requests.some(request => request.url.includes('?check=audio')), false);
    assert.equal(h.confirmation().props.checked, false); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
    h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
    assert.equal(saved.audio, undefined); assert.equal(h.posts.length, 1);
  }
});

test('automatic music presents one eligible track with fixed volumes only after final approval', async t => {
  let saved;
  const h = uiHarness({ file: footageFile(), audio: [audioResult({ preview_url: 'https://www.instagram.com/reels/audio/587784541076604/?tracking=x' })],
    post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram',
      audio: { ...saved.audio, title: 'Calm track', display_artist: 'Fixture artist' } }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  const panel = automaticMusicPanel(h); assert.ok(panel); assertNoManualMusicControls(h);
  assert.match(text(panel), /Calm track/); assert.match(text(panel), /Fixture artist/);
  assert.equal(h.requests.filter(request => request.url === h.endpoint + '?check=audio-recommendations&connectionRevision=revision-instagram').length, 1);
  assert.equal(h.requests.some(request => request.url.includes('?check=audio&q=')), false);
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.posts.length, 0);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.audio, { audio_id: '587784541076604', audio_volume: 100, video_volume: 1 });
  assert.equal(h.posts.length, 1); assert.match(h.text, /Approved Instagram audio: Calm track/);
});

test('a changed output revision clears selected music and approval and cannot borrow a retained submit handler', async t => {
  let saved;
  const h = uiHarness({ file: footageFile(), audio: [audioResult()],
    post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  h.change(h.confirmation(), true); h.render(); const oldForm = h.form();
  h.updateFile({ ...h.file, updatedAt: '2026-10-11T01:00:00Z',
    outputs: { ...h.file.outputs, instagram: { ...h.file.outputs.instagram, duration: 18 } } }); await h.flush();
  assert.equal(h.confirmation().props.checked, false);
  assert.doesNotMatch(text(automaticMusicPanel(h)), /Calm track/);
  h.submit(oldForm); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.click('Check status'); await h.flush(); assert.match(text(automaticMusicPanel(h)), /Calm track/);
  assert.equal(h.confirmation().props.checked, false);
  h.change(h.confirmation(), true); h.render(); h.submit(oldForm); await h.flush(); assert.equal(h.posts.length, 0);
  h.submit(); await h.flush(); assert.equal(saved.audio.audio_id, '587784541076604'); assert.equal(h.posts.length, 1);
});

test('changing output during automatic lookup aborts and ignores the old recommendation', async t => {
  const waiting = deferred();
  const h = uiHarness({ file: footageFile(), read(request) { if (request.url.includes('?check=audio-recommendations')) return waiting.promise; } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  const search = h.requests.find(request => request.url.includes('?check=audio-recommendations'));
  assert.ok(search);
  h.updateFile({ ...h.file, updatedAt: '2026-10-11T02:00:00Z',
    outputs: { ...h.file.outputs, instagram: { ...h.file.outputs.instagram, filename: 'changed-output.mp4' } } }); await h.flush();
  assert.equal(search.signal.aborted, true);
  waiting.resolve(response({ audio: [audioResult({ title: 'Stale output track' })], recommendation: recommendationResult({ reason: 'Stale output visual evidence.' }) })); await h.flush();
  assert.doesNotMatch(h.text, /Stale output track|Stale output visual evidence/);
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.posts.length, 0);
});

test('automatic music blocks confirmation during lookup and requires fresh approval of its selected result', async t => {
  let saved; const waiting = deferred();
  const h = uiHarness({ file: footageFile(), read(request) { if (request.url.includes('?check=audio-recommendations')) return waiting.promise; },
    post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  assert.ok(automaticMusicPanel(h)); assert.match(text(automaticMusicPanel(h)), /Choosing Instagram music for this video/); assertNoManualMusicControls(h);
  assert.equal(Boolean(h.confirmation().props.disabled), true); assert.equal(h.confirmation().props.checked, false);
  assert.equal(h.button('Confirm and publish Reel').props.disabled, true); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  waiting.resolve(response({ audio: [audioResult()], recommendation: recommendationResult() })); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Calm track/);
  assert.equal(h.confirmation().props.checked, false); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.audio, { audio_id: '587784541076604', audio_volume: 100, video_volume: 1 }); assert.equal(h.posts.length, 1);
});

test('automatic music selects the lowest validated recommendation rank rather than catalog order', async t => {
  let saved;
  const h = uiHarness({ file: footageFile(), audio: [
    audioResult({ audio_id: '10', title: 'Invalid first choice', recommendation: { rank: 0, kind: 'english-vocal', reason: 'Invalid rank evidence.' } }),
    audioResult({ audio_id: '30', title: 'Third choice', recommendation: { rank: 3, kind: 'instrumental', reason: 'Third-ranked instrumental fit.' } }),
    audioResult({ audio_id: '20', title: 'Second choice', recommendation: { rank: 2, kind: 'english-vocal', reason: 'Second-ranked vocal fit.' } }),
    audioResult({ audio_id: '1', title: 'First choice' }),
  ], post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /First choice/); assert.doesNotMatch(text(automaticMusicPanel(h)), /Invalid first choice|Second choice|Third choice/);
  assertNoManualMusicControls(h); assert.equal(h.confirmation().props.checked, false); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.audio, { audio_id: '1', audio_volume: 100, video_volume: 1 });
});

test('unavailable or unverified automatic music explicitly retains only verified saved audio before final approval', async t => {
  for (const audio of ['natural-audio-preserved', 'local-music-replaced']) for (const fixture of [
    { name: 'no visual evidence', result: response({ audio: [], reason: 'No usable visual evidence is saved for this footage.' }), reason: /No usable visual evidence/ },
    { name: 'no eligible catalog track', result: response({ audio: [], recommendation: recommendationResult() }) },
    { name: 'missing summary', result: response({ audio: [audioResult()], recommendation: null }) },
    { name: 'invalid summary', result: response({ audio: [audioResult()], recommendation: recommendationResult({ basis: 'whole-video' }) }) },
    { name: 'invalid track', result: response({ audio: [audioResult({ audio_id: 'invalid' })], recommendation: recommendationResult() }) },
    { name: 'provider lookup failure', result: response({ error: 'Instagram catalog lookup is unavailable.' }, 503), reason: /Instagram catalog lookup is unavailable/ },
    { name: 'network failure', reject: true, reason: /Could not check Instagram audio/ },
  ]) {
    let saved;
    const h = uiHarness({ file: footageFile(audio),
      read(request) { if (request.url.includes('?check=audio-recommendations')) return fixture.reject ? Promise.reject(new Error('Mock catalog connection failed.')) : fixture.result; },
      post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assertNoManualMusicControls(h); assert.doesNotMatch(text(automaticMusicPanel(h)), /Calm track/);
    assert.match(h.text, /Keeping the saved video audio; no Instagram track will be added\./, fixture.name);
    if (fixture.reason) assert.match(h.text, fixture.reason);
    assert.equal(h.confirmation().props.checked, false); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
    h.change(h.confirmation(), true); h.render(); assert.equal(h.button('Confirm and publish Reel').props.disabled, false, fixture.name);
    h.submit(); await h.flush(); assert.equal(saved.audio, undefined, fixture.name); assert.equal(h.posts.length, 1);
  }
});

test('footage with missing or unverified saved audio cannot publish after automatic music fails', async t => {
  for (const audio of ['no-audio', 'needs-review']) for (const failure of [
    response({ audio: [], reason: 'No usable visual evidence is saved for this footage.' }),
    response({ audio: [], recommendation: recommendationResult() }),
    response({ error: 'Instagram catalog lookup is unavailable.' }, 503),
  ]) {
    const h = uiHarness({ file: footageFile(audio), read(request) { if (request.url.includes('?check=audio-recommendations')) return failure; } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assertNoManualMusicControls(h); assert.doesNotMatch(h.text, /Keeping the saved video audio; no Instagram track will be added/);
    assert.match(text(automaticMusicPanel(h)), /no verified usable saved audio/i);
    assert.match(text(automaticMusicPanel(h)), /Publishing is paused until suitable Instagram music is available/);
    h.confirmation().props.onChange({ target: { checked: true } }); h.render();
    assert.equal(h.button('Confirm and publish Reel').props.disabled, true); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  }
});

test('eligible Instagram music can supply a final-approved Reel even when its saved audio is missing or unverified', async t => {
  for (const audio of ['no-audio', 'needs-review']) {
    let saved;
    const h = uiHarness({ file: footageFile(audio), audio: [audioResult()],
      post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assert.match(text(automaticMusicPanel(h)), /Calm track/); assert.equal(h.confirmation().props.checked, false);
    h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
    h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
    assert.deepEqual(saved.audio, { audio_id: '587784541076604', audio_volume: 100, video_volume: 1 });
  }
});

test('saved uploads, narration, unavailable accounts, Story-only and YouTube never auto-search music', async t => {
  for (const options of [
    { file: sampleFile({ source: { kind: 'pexels' }, quality: { audio: 'local-narration-music', hashtags: [], captions: [] } }) },
    ...['COMPLETE', 'FAILED', 'NEEDS_CHECK', 'UPLOADING'].map(status => ({ file: footageFile(),
      jobs: [job({ platform: 'instagram', status, percent: status === 'COMPLETE' ? 100 : 0, canContinue: status === 'FAILED' || status === 'NEEDS_CHECK',
        audio: { audio_id: '587784541076604', audio_volume: 70, video_volume: 10, title: 'Saved approved track', display_artist: 'Saved artist' } })] })),
    { file: footageFile(), channels: [channel('instagram', { publishReady: false })] },
    { file: footageFile(), opening: 'Upload to YouTube' },
    { file: footageFile(), opening: 'Post Story only', story: { ready: true, reason: 'Saved MP4 is eligible.' } },
  ]) {
    const savedJobs = JSON.stringify(options.jobs);
    const h = uiHarness(options); t.after(() => h.unmount()); h.choose(options.opening || 'Post to Instagram'); await h.flush();
    assert.equal(h.requests.some(request => request.url.includes('?check=audio')), false); assert.equal(h.posts.length, 0);
    assertNoManualMusicControls(h); assert.equal(JSON.stringify(options.jobs), savedJobs, 'Opening never changes approved saved jobs');
    if (options.jobs) assert.match(h.text, /Approved Instagram audio: Saved approved track · Saved artist · track volume 70% · saved video volume 10%/);
  }
});

test('Check status refreshes automatic music and invalidates approval while the new result is pending', async t => {
  let checks = 0, saved; const waiting = deferred();
  const h = uiHarness({ file: footageFile(), read(request) {
    if (request.url.includes('?check=audio-recommendations')) return ++checks === 1
      ? response({ audio: [audioResult({ title: 'First automatic track' })], recommendation: recommendationResult() }) : waiting.promise;
  }, post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush(); h.change(h.confirmation(), true); h.render();
  h.click('Check status'); await h.flush();
  assert.equal(checks, 2); assert.equal(h.confirmation().props.checked, false); assert.equal(Boolean(h.confirmation().props.disabled), true);
  assert.doesNotMatch(text(automaticMusicPanel(h)), /First automatic track/); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  waiting.resolve(response({ audio: [audioResult({ audio_id: '123456', title: 'Fresh automatic track' })], recommendation: recommendationResult() })); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Fresh automatic track/); assert.equal(h.confirmation().props.checked, false);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush(); assert.equal(saved.audio.audio_id, '123456');
});

test('Check status cannot silently retain an earlier selected track after its recommendation becomes unavailable', async t => {
  let checks = 0, saved;
  const h = uiHarness({ file: footageFile(), read(request) {
    if (request.url.includes('?check=audio-recommendations')) return ++checks === 1
      ? response({ audio: [audioResult()], recommendation: recommendationResult() })
      : response({ audio: [], reason: 'Previously eligible music is now unavailable.' });
  }, post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush(); h.change(h.confirmation(), true); h.render();
  h.click('Check status'); await h.flush();
  assert.equal(h.confirmation().props.checked, false); assert.doesNotMatch(text(automaticMusicPanel(h)), /Calm track/);
  assert.match(h.text, /Previously eligible music is now unavailable/); assert.match(h.text, /Keeping the saved video audio; no Instagram track will be added/);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush(); assert.equal(saved.audio, undefined);
});

test('switching from an automatic Reel track to Story-only uses the saved MP4 without sending Reel music', async t => {
  let saved;
  const h = uiHarness({ file: footageFile(), audio: [audioResult()], story: { ready: true, reason: 'Saved MP4 is eligible.' },
    post(request) { saved = JSON.parse(request.body); return response({ job: standaloneStoryJob({ status: 'QUEUED', percent: 0 }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Calm track/); h.choose('Post Story only'); await h.flush();
  assert.equal(automaticMusicPanel(h), undefined); assert.match(h.text, /saved soundtrack/);
  assert.equal(h.confirmation().props.checked, false); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved, { action: 'create-story', confirm: true, connectionRevision: 'revision-instagram' });
});

test('late Story eligibility cannot expand an already approved automatic-music Reel into a Reel plus Story', async t => {
  const waiting = deferred();
  const h = uiHarness({ file: footageFile(), audio: [audioResult()], read(request) { if (request.url.includes('?check=story')) return waiting.promise; } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  h.change(h.confirmation(), true); h.render(); assert.equal(h.confirmation().props.checked, true);
  waiting.resolve(response({ story: { ready: true, reason: 'Fixture Business eligible' } })); await h.flush();
  assert.equal(h.control('Also publish one matching Story', 'input').props.checked, true);
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.button('Confirm Reel + Story').props.disabled, true); assert.equal(h.posts.length, 0);
});

test('closing, switching platform or unmounting during automatic music lookup aborts and ignores late results', async t => {
  for (const leave of ['close', 'youtube', 'unmount']) {
    const waiting = deferred();
    const h = uiHarness({ file: footageFile(), read(request) { if (request.url.includes('?check=audio-recommendations')) return waiting.promise; } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    const search = h.requests.find(request => request.url.includes('?check=audio-recommendations')); assert.ok(search);
    if (leave === 'close') h.click('Close'); else if (leave === 'youtube') h.choose('Upload to YouTube'); else h.unmount();
    await h.flush(); assert.equal(search.signal.aborted, true);
    waiting.resolve(response({ audio: [audioResult({ title: 'Stale automatic track' })], recommendation: recommendationResult({ reason: 'Stale visual evidence.' }) })); await h.flush();
    assert.doesNotMatch(h.text, /Stale automatic track|Stale visual evidence/); assert.equal(h.posts.length, 0);
  }
});

test('automatic music explains its validated visual basis and ignores optional backend diagnostics', async t => {
  for (const basis of ['sampled-frames', 'saved-observations']) {
    const h = uiHarness({ file: footageFile(), audio: [audioResult()], recommendation: recommendationResult({ basis }),
      read(request) { if (request.url.includes('?check=audio-recommendations')) return response({
        audio: [audioResult()], recommendation: recommendationResult({ basis }), diagnostics: { secret: 'Never expose diagnostic payload' },
      }); } });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assert.ok(h.deadlines.includes(45000)); assertNoManualMusicControls(h);
    assert.match(text(automaticMusicPanel(h)), /Calm track/);
    assert.match(h.text, /Reflective English vocals fit the quiet scenery/);
    assert.match(h.text, /Based on sampled visual evidence, not listening or beat analysis/);
    assert.match(h.text, /local preview\/download and matching Story keep the saved MP4 audio/);
    assert.doesNotMatch(h.text, /trending audio|Never expose diagnostic payload/);
    assert.equal(h.confirmation().props.checked, false); assert.ok(h.requests.every(request => request.method === 'GET')); assert.equal(h.posts.length, 0);
  }
});

test('a newer automatic status lookup wins and an older recommendation cannot change final approval', async t => {
  let checks = 0; const waiting = deferred();
  const h = uiHarness({ file: footageFile(), read(request) {
    if (request.url.includes('?check=audio-recommendations')) return ++checks === 1 ? waiting.promise
      : response({ audio: [audioResult({ title: 'Current automatic track' })], recommendation: recommendationResult() });
  } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  const previous = h.requests.find(request => request.url.includes('?check=audio-recommendations')); h.click('Check status'); await h.flush();
  assert.equal(previous.signal.aborted, true); assert.equal(checks, 2);
  assert.match(text(automaticMusicPanel(h)), /Current automatic track/); h.change(h.confirmation(), true); h.render();
  waiting.resolve(response({ audio: [audioResult({ title: 'Old recommendation' })], recommendation: recommendationResult({ reason: 'Old sampled visual evidence.' }) })); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Current automatic track/); assert.doesNotMatch(h.text, /Old recommendation|Old sampled visual evidence/);
  assert.equal(h.confirmation().props.checked, true); assert.equal(h.posts.length, 0);
});

test('invalid contextual summary cannot silently select an unverified automatic track', async t => {
  for (const recommendation of [null, [], recommendationResult({ preference: 'hindi-vocals' }),
    recommendationResult({ basis: 'whole-video' }), recommendationResult({ mood: 'unknown-mood' }),
    recommendationResult({ energy: 'extreme' }), recommendationResult({ reason: 'x'.repeat(201) }),
    recommendationResult({ reason: 'Unsafe\nmetadata' })]) {
    const h = uiHarness({ file: footageFile(), recommendation, audio: [audioResult()] });
    t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assert.doesNotMatch(h.text, /Calm track|Visual mood:|Unsafe|unknown-mood|extreme|hindi-vocals/);
    assert.match(h.text, /Keeping the saved video audio; no Instagram track will be added/);
    assert.equal(h.confirmation().props.checked, false); assert.equal(h.button('Confirm and publish Reel').props.disabled, true); assert.equal(h.posts.length, 0);
  }
});

test('automatic choices reject invalid metadata, duplicates and unsafe previews while bounding public results', async t => {
  let saved;
  const h = uiHarness({ file: footageFile(), audio: [
    audioResult({ audio_id: '1', title: 'Invalid ID metadata', display_artist: 'Unsafe\nartist' }),
    audioResult({ audio_id: '2', title: 'Invalid rank', recommendation: { rank: 0, kind: 'english-vocal', reason: 'Invalid rank evidence.' } }),
    audioResult({ audio_id: '3', title: 'Unverified language', recommendation: { rank: 2, kind: 'hindi-vocal', reason: 'Unverified language evidence.' } }),
    audioResult({ audio_id: '4', title: 'Unbounded reason', recommendation: { rank: 2, kind: 'instrumental', reason: 'x'.repeat(201) } }),
    audioResult({ audio_id: '5', title: 'Valid instrumental', preview_url: 'https://example.com/private-audio.mp3',
      recommendation: { rank: 2, kind: 'instrumental', reason: 'Piano fits the sampled calm scenery.' }, privateData: 'Do not expose private fields' }),
    audioResult({ audio_id: '5', title: 'Duplicate track', recommendation: { rank: 1, kind: 'instrumental', reason: 'Duplicate cannot replace the first validated ID.' } }),
    audioResult({ audio_id: '7', title: 'Beyond public bound' }),
  ], post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Valid instrumental/);
  assert.doesNotMatch(h.text, /Invalid ID metadata|Invalid rank|Unverified language|Unbounded reason|Duplicate track|Beyond public bound|Do not expose private fields/);
  assert.equal(nodes(h.tree).some(node => node.type === 'a' && node.props.href === 'https://example.com/private-audio.mp3'), false);
  assertNoManualMusicControls(h); assert.equal(h.confirmation().props.checked, false); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.audio, { audio_id: '5', audio_volume: 100, video_volume: 1 });
});

test('new Instagram review visibly applies validated saved location and owner tags only to a final approved Reel', async t => {
  let saved;
  const h = uiHarness({ defaults: { userTags: ['@Owner', 'Allowed.page'], location: { id: '123456', name: 'Switzerland' }, locationQuery: 'Switzerland',
    locationReason: 'This is your saved posting choice, not a verified filming location.' }, post(request) {
    saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram', location: { id: '123456', name: 'Switzerland' }, userTags: saved.userTags }) });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.requests.filter(request => request.url === `${h.endpoint}?check=posting-defaults&connectionRevision=revision-instagram`).length, 1);
  assert.equal(h.requests.length, 4, 'New Instagram review reads accounts, saved jobs, defaults and Story capability');
  const summary = nodes(h.form()).find(node => node.props['aria-label'] === 'Instagram posting choices');
  assert.ok(summary); assert.match(text(summary), /Posting location · Switzerland/); assert.match(text(summary), /Reel tags · @owner, @allowed.page/);
  assert.match(text(summary), /your posting choice, not verified filming evidence/);
  assert.ok(nodes(h.form()).filter(node => node.type === 'details').every(details => !nodes(details).includes(summary)), 'Choices stay visible outside collapsed controls');
  assert.equal(h.control('Instagram usernames', 'input').props.value, 'owner, allowed.page');
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.posts.length, 0);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.equal(saved.action, 'create'); assert.deepEqual(saved.location, { id: '123456' }); assert.deepEqual(saved.userTags, ['owner', 'allowed.page']);
  assert.equal(h.posts.length, 1); assert.equal(h.button('Remember these posting choices'), undefined);
});

test('defaults, contextual music and Story capability start together while final posting waits for stable choices', async t => {
  const defaults = deferred(), audio = deferred(), story = deferred();
  const h = uiHarness({ file: sampleFile({ source: { kind: 'pexels' }, quality: { audio: 'local-music-replaced', hashtags: [], captions: [] } }), read(request) {
    if (request.url.includes('?check=posting-defaults')) return defaults.promise;
    if (request.url.includes('?check=audio-recommendations')) return audio.promise;
    if (request.url.includes('?check=story')) return story.promise;
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  for (const check of ['posting-defaults', 'audio-recommendations', 'story']) assert.ok(h.requests.some(request => request.url.includes(`?check=${check}&`)), `${check} starts without waiting for another check`);
  assert.match(h.text, /Checking saved posting choices/);
  assert.equal(Boolean(h.confirmation().props.disabled), true); assert.equal(h.button('Confirm and publish Reel').props.disabled, true);
  defaults.resolve(response({ defaults: { userTags: ['approved.owner'], location: { id: '123456', name: 'Switzerland' } } })); await h.flush();
  assert.equal(h.confirmation().props.checked, false, 'Applying defaults resets earlier final approval');
  story.resolve(response({ story: { ready: false, reason: 'Stories unavailable in this fixture.' } }));
  audio.resolve(response({ audio: [audioResult()], recommendation: recommendationResult() })); await h.flush();
  assert.match(text(automaticMusicPanel(h)), /Calm track/); assertNoManualMusicControls(h);
  assert.equal(h.confirmation().props.checked, false, 'Automatic music also requires renewed final approval after defaults settle');
  assert.match(h.text, /Posting location · Switzerland/); assert.equal(h.posts.length, 0);
});

test('late posting defaults respect manual location and tag edits, including explicit clearing', async t => {
  for (const edit of ['replace', 'clear']) {
    const waiting = deferred();
    const h = uiHarness({ read(request) { if (request.url.includes('?check=posting-defaults')) return waiting.promise; } }); t.after(() => h.unmount());
    h.choose('Post to Instagram'); await h.flush();
    h.change(h.control('Instagram usernames', 'input'), edit === 'replace' ? '@manual.person' : ''); h.render();
    h.change(h.control('Place name or Facebook location Page ID', 'input'), edit === 'replace' ? 'Norway' : ''); h.render();
    waiting.resolve(response({ defaults: { userTags: ['stale.person'], location: { id: '123456', name: 'Switzerland' }, locationQuery: 'Switzerland', locationReason: 'Stale default reason.' } })); await h.flush();
    assert.equal(h.control('Instagram usernames', 'input').props.value, edit === 'replace' ? '@manual.person' : '');
    assert.equal(h.control('Place name or Facebook location Page ID', 'input').props.value, edit === 'replace' ? 'Norway' : '');
    assert.doesNotMatch(h.text, /stale.person|Stale default reason/);
    assert.doesNotMatch(text(nodes(h.tree).find(node => node.props['aria-label'] === 'Instagram posting choices')), /Switzerland/);
    assert.equal(h.posts.length, 0);
  }
});

test('late defaults are aborted and ignored after closing, switching platform or unmounting', async t => {
  for (const leave of ['close', 'youtube', 'unmount']) {
    const waiting = deferred();
    const h = uiHarness({ read(request) { if (request.url.includes('?check=posting-defaults')) return waiting.promise; } }); t.after(() => h.unmount());
    h.choose('Post to Instagram'); await h.flush(); const request = h.requests.find(item => item.url.includes('?check=posting-defaults'));
    if (leave === 'close') h.click('Close'); else if (leave === 'youtube') h.choose('Upload to YouTube'); else h.unmount();
    await h.flush(); assert.equal(request.signal.aborted, true);
    waiting.resolve(response({ defaults: { userTags: ['stale.person'], location: { id: '123456', name: 'Stale location' }, locationReason: 'Stale default reason.' } })); await h.flush();
    assert.doesNotMatch(h.text, /stale.person|Stale location|Stale default reason/); assert.equal(h.posts.length, 0);
  }
});

test('an unresolved Switzerland posting choice exposes Meta reason without inventing a tag or blocking an approved Reel', async t => {
  const reason = 'Meta did not allow this location lookup. Pages Search can require App Review with advanced Page Public Metadata Access. Check the existing app/token access, enter a known location Page ID, or add the location manually in Instagram; ordinary Reel posting is unaffected.';
  let saved;
  const h = uiHarness({ defaults: { userTags: [], locationQuery: 'Switzerland', locationReason: reason }, post(request) {
    saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  const summary = nodes(h.tree).find(node => node.props['aria-label'] === 'Instagram posting choices');
  assert.match(text(summary), /Posting location · Switzerland · pending Meta verification; no location tag attached/);
  assert.ok(text(summary).includes(reason), 'Meta permission explanation remains visible outside collapsed location controls');
  assert.equal(h.control('Place name or Facebook location Page ID', 'input').props.value, 'Switzerland');
  assert.equal(h.button('Find location').props.disabled, false);
  assert.equal(h.confirmation().props.checked, false);
  h.change(h.confirmation(), true); h.render(); assert.equal(h.button('Confirm and publish Reel').props.disabled, false);
  h.submit(); await h.flush(); assert.equal(saved.location, undefined); assert.equal(saved.userTags, undefined); assert.equal(h.posts.length, 1);
});

test('remembering posting choices saves only explicit preferences and still requires a separate final publish approval', async t => {
  let saved;
  const h = uiHarness({ defaults: { userTags: ['approved.person'], location: { id: '123456', name: 'Switzerland' } }, post(request) {
    saved = JSON.parse(request.body); return response({ defaults: { userTags: saved.userTags, location: saved.location } });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush(); h.change(h.confirmation(), true); h.render();
  h.click('Remember these posting choices'); await h.flush();
  assert.deepEqual(saved, { action: 'save-posting-defaults', confirm: true, connectionRevision: 'revision-instagram', userTags: ['approved.person'], location: { id: '123456', name: 'Switzerland' }, locationQuery: 'Switzerland' });
  assert.equal(h.posts.length, 1); assert.ok(h.form(), 'Saving preferences creates no publishing job'); assert.equal(h.intervals.size, 0);
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.button('Confirm and publish Reel').props.disabled, true);
  assert.match(h.text, /Posting choices remembered/); assert.match(h.text, /No video was uploaded/);
  h.click('Remove location'); h.render(); h.change(h.control('Instagram usernames', 'input'), ''); h.render();
  h.click('Remember these posting choices'); await h.flush();
  assert.deepEqual(saved, { action: 'save-posting-defaults', confirm: true, connectionRevision: 'revision-instagram', userTags: [], location: null, locationQuery: '' });
  assert.ok(h.posts.every(request => JSON.parse(request.body).action === 'save-posting-defaults'));
});

test('an unresolved owner location query can be explicitly remembered without fabricating an eligible location ID', async t => {
  let saved;
  const h = uiHarness({ defaults: { userTags: ['approved.person'], locationQuery: 'Switzerland' }, post(request) {
    saved = JSON.parse(request.body); return response({ defaults: { userTags: saved.userTags, locationQuery: saved.locationQuery } });
  } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.control('Place name or Facebook location Page ID', 'input').props.value, 'Switzerland');
  assert.equal(h.button('Remember these posting choices').props.disabled, false);
  h.click('Remember these posting choices'); await h.flush();
  assert.deepEqual(saved, { action: 'save-posting-defaults', confirm: true, connectionRevision: 'revision-instagram', userTags: ['approved.person'], location: null, locationQuery: 'Switzerland' });
  assert.equal(h.posts.length, 1); assert.ok(h.form()); assert.equal(h.confirmation().props.checked, false);
});

test('defaults never alter saved uploads and malformed defaults cannot introduce unapproved location or usernames', async t => {
  const existing = uiHarness({ jobs: [job({ platform: 'instagram', location: { id: '123456', name: 'Approved location' }, userTags: ['approved.person'] })],
    defaults: { userTags: ['different.person'], location: { id: '999', name: 'Different location' } } }); t.after(() => existing.unmount());
  existing.choose('Post to Instagram'); await existing.flush();
  assert.equal(existing.requests.length, 2); assert.equal(existing.requests.some(request => request.url.includes('?check=posting-defaults')), false);
  assert.match(existing.text, /Approved location tag: Approved location/); assert.match(existing.text, /Approved Reel tags: @approved.person/);
  assert.equal(existing.button('Remember these posting choices'), undefined);
  for (const defaults of [null, [], { userTags: Array.from({ length: 21 }, (_, i) => `person${i}`), location: { id: 'not-numeric', name: 'Invalid location' } },
    { userTags: [], location: { id: '123456\n', name: 'Invalid location' } },
    { userTags: ['https://instagram.com/person'], location: { id: '123456', name: 'Unsafe\nlocation' }, locationQuery: 'q'.repeat(101), locationReason: 'r'.repeat(601) }]) {
    const h = uiHarness({ defaults }); t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
    assert.equal(h.control('Instagram usernames', 'input').props.value, '');
    assert.equal(h.control('Place name or Facebook location Page ID', 'input').props.value, '');
    assert.doesNotMatch(h.text, /Invalid location|Unsafe|https:\/\/instagram.com\/person/); assert.equal(h.posts.length, 0);
  }
});

test('YouTube never shows or submits Instagram audio and reports visibility without the obsolete project restriction', async t => {
  let saved; const h = uiHarness({ post(request) { saved = JSON.parse(request.body); return response({ job: job() }); } }); t.after(() => h.unmount());
  h.choose('Upload to YouTube'); await h.flush(); assert.equal(h.control('Track or artist', 'input'), undefined); assert.equal(h.button('Find Instagram audio'), undefined);
  assert.ok(!h.text.includes('unverified API project')); assert.match(h.text, /visibility returned by YouTube/);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush(); assert.equal(saved.audio, undefined); assert.ok(!h.requests.some(request => request.url.includes('?check=audio')));
});

const rejectedJob = (extra = {}) => job({ platform: 'instagram', accountName: '@saved_destination', privacy: 'public', status: 'FAILED', percent: 0,
  canContinue: true, canRevise: true, caption: 'The exact previously approved caption #Horses', userTags: ['saved.person', 'saved.brand'],
  updatedAt: '2026-10-10T00:00:00Z', ...extra });

test('rejected Reel correction opens collapsed with exact saved caption and tags, and reopening preserves them without loading defaults or audio', async t => {
  const saved = rejectedJob({ location: { id: '123456', name: 'Saved place' }, audio: { audio_id: '12345', audio_volume: 80, video_volume: 10, title: 'Saved track', display_artist: 'Saved artist' } });
  const h = uiHarness({ file: sampleFile({ source: { kind: 'pexels' }, quality: { audio: 'local-music-replaced', postCopy: 'Unrelated new file caption', hashtags: [], captions: [] } }),
    jobs: [saved], defaults: { userTags: ['unrelated.default'] } }); t.after(() => h.unmount());
  h.choose('Post to Instagram'); await h.flush();
  const details = nodes(h.tree).find(node => node.type === 'details' && text(node).startsWith('Correct rejected caption / tags'));
  assert.ok(details); assert.equal(Boolean(details.props.open), false);
  assert.equal(h.control('Corrected caption and hashtags', 'textarea').props.value, saved.caption);
  assert.equal(h.control('Corrected Instagram usernames', 'input').props.value, 'saved.person, saved.brand');
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.button('Confirm corrected Reel').props.disabled, true);
  assert.equal(h.button('Continue saved upload'), undefined); assert.equal(h.requests.length, 2); assert.equal(h.posts.length, 0);
  assert.match(h.text, /saved location, audio, visibility and matching Story approval stay as previously confirmed/);
  assert.match(h.text, /publishing this Reel publicly to @saved_destination/); assert.match(h.text, /Approved Instagram audio: Saved track/);
  h.change(h.control('Corrected caption and hashtags', 'textarea'), 'Unsaved edit'); h.change(h.control('Corrected Instagram usernames', 'input'), '');
  h.change(h.confirmation(), true); h.render(); h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.control('Corrected caption and hashtags', 'textarea').props.value, saved.caption);
  assert.equal(h.control('Corrected Instagram usernames', 'input').props.value, 'saved.person, saved.brand');
  assert.equal(h.confirmation().props.checked, false); assert.equal(h.requests.length, 4);
  assert.ok(h.requests.every(request => request.method === 'GET' && !request.url.includes('?check=')));
});

test('corrected Reel requires renewed approval and submits exactly one explicit caption and empty tag list without changing other choices', async t => {
  const waiting = deferred(); let saved;
  const h = uiHarness({ jobs: [rejectedJob({ companionStoryApproved: true })], post(request) { saved = JSON.parse(request.body); return waiting.promise; } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.change(h.control('Corrected caption and hashtags', 'textarea'), 'A corrected caption #Horses'); h.render();
  assert.equal(h.confirmation().props.checked, false);
  h.change(h.confirmation(), true); h.render(); h.change(h.control('Corrected Instagram usernames', 'input'), ''); h.render();
  assert.equal(h.confirmation().props.checked, false); assert.match(h.text, /Corrected Reel tags: None selected/);
  assert.match(h.text, /publishing this Reel publicly and then its matching Story to @saved_destination/);
  h.change(h.confirmation(), true); h.render(); const form = h.form(); h.submit(form); h.submit(form); await h.flush();
  assert.equal(h.posts.length, 1);
  assert.deepEqual(saved, { action: 'revise', jobId: 'saved-upload', confirm: true, caption: 'A corrected caption #Horses', userTags: [] });
  waiting.resolve(response({ job: rejectedJob({ status: 'QUEUED', canRevise: undefined, caption: undefined, canContinue: false }) })); await h.flush();
  assert.equal(h.control('Corrected caption and hashtags', 'textarea'), undefined); assert.equal(h.button('Continue saved upload'), undefined);
  assert.equal(h.posts.length, 1);
});

test('invalid corrected tags or excess hashtags block correction and ordinary saved states keep immutable continuation', async t => {
  const h = uiHarness({ jobs: [rejectedJob()] }); t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  h.change(h.control('Corrected Instagram usernames', 'input'), 'https://instagram.com/person'); h.render(); h.change(h.confirmation(), true); h.render();
  assert.equal(h.button('Confirm corrected Reel').props.disabled, true); h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  h.change(h.control('Corrected Instagram usernames', 'input'), 'saved.person'); h.change(h.control('Corrected caption and hashtags', 'textarea'), '#one #two #three #four #five #six'); h.render();
  h.change(h.confirmation(), true); h.render(); assert.equal(h.button('Confirm corrected Reel').props.disabled, true);
  h.submit(); await h.flush(); assert.equal(h.posts.length, 0);
  for (const state of ['NEEDS_CHECK', 'UPLOADING', 'COMPLETE', 'FAILED']) {
    const ordinary = uiHarness({ jobs: [rejectedJob({ status: state, canRevise: undefined, caption: undefined, canContinue: state === 'NEEDS_CHECK' || state === 'FAILED' })] });
    t.after(() => ordinary.unmount()); ordinary.choose('Post to Instagram'); await ordinary.flush();
    assert.equal(ordinary.control('Corrected Instagram usernames', 'input'), undefined); assert.equal(ordinary.button('Confirm corrected Reel'), undefined);
    assert.equal(Boolean(ordinary.button('Continue saved upload')), state === 'NEEDS_CHECK' || state === 'FAILED'); assert.equal(ordinary.posts.length, 0);
  }
});

test('saved approved usernames automatically accompany a new Reel without manual tag entry or invented identities', async t => {
  const usernames = ['telepgone.cbscura', 'benedikt.hoehny', 'harvon.x', 'leopard.1787844', 'patagonico']; let saved;
  const h = uiHarness({ defaults: { userTags: usernames }, post(request) { saved = JSON.parse(request.body); return response({ job: job({ platform: 'instagram' }) }); } });
  t.after(() => h.unmount()); h.choose('Post to Instagram'); await h.flush();
  assert.equal(h.control('Instagram usernames', 'input').props.value, usernames.join(', ')); assert.equal(h.confirmation().props.checked, false);
  assert.match(h.text, /Meta checks whether each account permits tagging/); assert.equal(h.posts.length, 0);
  h.change(h.confirmation(), true); h.render(); h.submit(); await h.flush();
  assert.deepEqual(saved.userTags, usernames); assert.equal(h.posts.length, 1);
});

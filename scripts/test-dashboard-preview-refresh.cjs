const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } });
require("tsconfig-paths").register({ baseUrl: path.resolve(__dirname, ".."), paths: { "@/*": ["src/*"] } });

// Exercise the real component functions/effects with persistent hook instances.
// No browser, media decoder, network request, or production store is used.
let current;
const react = require("react"), originalLoad = Module._load;
const hookedFiles = new Set(["DashboardClient.tsx", "ReviewPlayer.tsx", "PostingActions.tsx"]);
Module._load = function (name, parent, ...args) {
  if (name === "react" && hookedFiles.has(path.basename(parent?.filename || ""))) return {
    ...react, useState: value => current.state(value), useRef: value => current.ref(value),
    useEffect: (effect, deps) => current.effect(effect, deps),
    useMemo: (factory, deps) => current.memo(factory, deps), useCallback: (callback, deps) => current.memo(() => callback, deps),
  };
  return originalLoad.call(this, name, parent, ...args);
};
let Dashboard, ReviewPlayer, PostingActions;
try {
  Dashboard = require("../src/app/dashboard/DashboardClient").default;
  ReviewPlayer = require("../src/components/ReviewPlayer").default;
  PostingActions = require("../src/components/PostingActions").default;
} finally { Module._load = originalLoad; }

function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found));
  else if (node && typeof node === "object") {
    if (predicate(node)) found.push(node);
    nodes(node.props?.children, predicate, found);
  }
  return found;
}
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("")
  : typeof node === "object" ? text(node.props?.children) : String(node);
const changed = (previous, deps) => !previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]));
function hooks(Component, hosts = {}) {
  const slots = []; let position = 0, effects = [], props = {}, tree, dirty = true;
  const h = {
    state(initial) {
      const index = position++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    ref(initial) { const index = position++; return slots[index] ||= { current: initial }; },
    memo(factory, deps) { const index = position++; if (changed(slots[index], deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    effect(effect, deps) {
      const index = position++, previous = slots[index];
      if (!changed(previous, deps)) return;
      slots[index] = { deps, cleanup: previous?.cleanup };
      effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
    },
    render(value = props) {
      props = value; position = 0; dirty = false; current = h; tree = Component(props);
      for (const node of nodes(tree, node => typeof node.type === "string" && node.props?.ref)) {
        if (hosts[node.type]) node.props.ref.current = hosts[node.type];
      }
      const pending = effects; effects = []; pending.forEach(effect => effect());
    },
    async flush() { for (let index = 0; index < 50; index++) { if (dirty) h.render(); await Promise.resolve(); } },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
    get tree() { return tree; }, get text() { return text(tree); },
  };
  return h;
}

test("Jobs Watch keeps an open player while polled posting text advances from absent to queued to specific copy", async t => {
  const previous = Object.fromEntries(["fetch", "window", "document", "setTimeout", "clearTimeout", "setInterval", "clearInterval"].map(key => [key, global[key]]));
  const listeners = new Map(), timers = new Map(), intervals = new Map(), requests = [];
  const addListener = (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); };
  const removeListener = (name, callback) => { listeners.get(name)?.delete(callback); if (!listeners.get(name)?.size) listeners.delete(name); };
  const emit = name => { for (const callback of [...(listeners.get(name) || [])]) callback(); };
  let nextTimer = 0, modalShows = 0, modalCloses = 0, pauses = 0, reloads = 0;
  const schedule = (map, callback, delay) => { const id = ++nextTimer; map.set(id, { callback, delay }); return id; };
  global.setTimeout = (callback, delay) => schedule(timers, callback, delay);
  global.clearTimeout = id => timers.delete(id);
  global.setInterval = (callback, delay) => schedule(intervals, callback, delay);
  global.clearInterval = id => intervals.delete(id);
  global.window = { location: { hash: "#jobs", search: "" }, scrollTo() {},
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
    addEventListener: addListener, removeEventListener: removeListener };
  global.document = { hidden: false, addEventListener: addListener, removeEventListener: removeListener };
  const original = {
    id: "preview-analysis-fixture", title: "Lake sunrise", status: "READY", audience: "general",
    outputs: { youtube: { filename: "fixture.mp4", duration: 60, width: 720, height: 1280 } },
    delivery: { platform: "youtube" }, quality: { postCopy: "Generic travel draft.", hashtags: ["#Travel"], captions: [] },
  };
  let latest = original, includeFile = true;
  global.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    assert.ok(!options.method || options.method === "GET", "Preview refresh must not mutate or analyze anything");
    if (url === "/api/review-files") return Response.json(includeFile ? [latest] : []);
    if (url === "/api/generations") return Response.json([{ id: original.id, status: "COMPLETED", progress: 100,
      stage: "Finished", retryCount: 0, createdAt: "2026-10-02T01:00:00Z", project: { title: original.title } }]);
    if (url === "/api/source-processing") return Response.json({ jobs: [] });
    if (url === "/api/studio-health") return Response.json({ worker: { state: "healthy" }, resources: {} });
    if (url === "/api/review-edits" || url === "/api/creation-drafts") return Response.json([]);
    assert.fail(`Unexpected request: ${url}`);
  };
  const dialog = { open: false, showModal() { modalShows++; this.open = true; }, close() { modalCloses++; this.open = false; } };
  const video = { currentTime: 17.25, pause() { pauses++; }, removeAttribute() {}, load() { reloads++; this.currentTime = 0; } };
  const dashboard = hooks(Dashboard), player = hooks(ReviewPlayer, { dialog, video }), posting = hooks(PostingActions);
  t.after(() => { dashboard.unmount(); player.unmount(); posting.unmount(); Object.assign(global, previous); current = undefined; });
  await dashboard.flush();
  const statusFilter = () => nodes(dashboard.tree, node => node.type === "select" && node.props?.["aria-label"] === "Job status filter")[0];
  assert.equal(statusFilter().props.value, "completed", "Idle queues still select completed history by default");
  assert.deepEqual(nodes(statusFilter(), node => node.type === "option").map(text), ["Active · 0", "Needs attention · 0", "Completed · 1", "All jobs · 1"]);
  statusFilter().props.onChange({ target: { value: "active" } }); await dashboard.flush();
  assert.match(dashboard.text, /Nothing is processing or waiting/);
  assert.equal(nodes(dashboard.tree, node => typeof node.props?.onClick === "function" && text(node) === "Watch video").length, 0);
  statusFilter().props.onChange({ target: { value: "completed" } }); await dashboard.flush();
  const watch = nodes(dashboard.tree, node => typeof node.props?.onClick === "function" && text(node) === "Watch video")[0];
  assert.ok(watch, "Completed Jobs output must expose Watch video"); watch.props.onClick(); await dashboard.flush();
  const preview = () => nodes(dashboard.tree, node => node.type === ReviewPlayer)[0];
  const identity = { type: preview().type, key: preview().key };
  const selected = preview().props.file;
  async function renderPlayer() {
    const element = preview(); assert.ok(element, "Polling must not close the preview");
    assert.equal(element.type, identity.type); assert.equal(element.key, identity.key);
    player.render(element.props); await player.flush();
    const actions = nodes(player.tree, node => node.type === PostingActions)[0];
    posting.render(actions.props); await posting.flush();
    return element;
  }
  await renderPlayer();
  const source = nodes(player.tree, node => node.type === "video")[0].props.src;
  nodes(player.tree, node => node.type === "video")[0].props.onPlaying(); await player.flush();
  assert.match(posting.text, /Generic travel draft/); assert.match(posting.text, /not yet verified/);
  assert.equal(intervals.size, 1, 'Missing automatic posting analysis polls saved status without reanalysis requests');
  assert.equal([...intervals.values()][0].delay, 15_000);

  latest = { ...original, quality: { ...original.quality, postingAnalysis: {
    status: "QUEUED", updatedAt: "2026-10-02T01:01:00Z", detail: "Waiting to sample this video." } } };
  emit("focus"); await dashboard.flush(); await renderPlayer();
  assert.equal(preview().props.file.quality.postingAnalysis.status, "QUEUED");
  assert.match(posting.text, /QUEUED: Waiting to sample this video/); assert.equal(intervals.size, 1);

  latest = { ...original, quality: { ...original.quality, postCopy: "Golden sunlight reaches the misty lake and pine shoreline.",
    hashtags: ["#LakeSunrise", "#PineShore"], postingAnalysis: {
      status: "COMPLETE", updatedAt: "2026-10-02T01:02:00Z", detail: "Based on this video's three sampled frames." } } };
  emit("focus"); await dashboard.flush(); await renderPlayer();
  assert.match(posting.text, /Video-specific copy/); assert.match(posting.text, /Golden sunlight reaches the misty lake/);
  assert.match(posting.text, /#LakeSunrise #PineShore/); assert.doesNotMatch(posting.text, /Generic travel draft/);
  assert.equal(intervals.size, 0); assert.equal(dialog.open, true); assert.equal(modalShows, 1);
  assert.equal(modalCloses, 0); assert.equal(pauses, 0); assert.equal(reloads, 0); assert.equal(video.currentTime, 17.25);
  assert.equal(nodes(player.tree, node => node.type === "video")[0].props.src, source);

  includeFile = false; emit("focus"); await dashboard.flush();
  assert.equal(preview().props.file, selected, "A missing poll entry retains the selected preview snapshot");
  assert.equal(preview().key, identity.key);
  preview().props.onClose(); await dashboard.flush(); assert.equal(preview(), undefined);
  assert.ok(requests.every(request => !request.method || request.method === "GET"));
});

test("hidden previews release their media, keep their timestamp and do not autoplay on return", async t => {
  const previous = { document: global.document, window: global.window };
  const listeners = new Set(), timers = new Map(); let sequence = 0, pauses = 0, loads = 0, removed = 0;
  global.document = { hidden: false, addEventListener: (name, callback) => { assert.equal(name, 'visibilitychange'); listeners.add(callback); }, removeEventListener: (_, callback) => listeners.delete(callback) };
  global.window = { setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) };
  const file = { id: 'mock-hidden-preview', title: 'Fixture', outputs: { instagram: {} } };
  const video = { currentTime: 23.5, duration: 60, autoplay: true, src: 'initial',
    pause() { pauses++; }, removeAttribute(name) { assert.equal(name, 'src'); removed++; this.src = ''; }, load() { loads++; this.currentTime = 0; } };
  const dialog = { showModal() {}, close() {} };
  const player = hooks(ReviewPlayer, { video, dialog });
  t.after(() => { player.unmount(); Object.assign(global, previous); current = undefined; });
  player.render({ file, onClose() {} }); await player.flush();
  const media = () => nodes(player.tree, node => node.type === 'video')[0];
  const source = media().props.src;
  global.document.hidden = true; for (const callback of listeners) callback(); await player.flush();
  assert.equal(pauses, 1); assert.equal(loads, 1); assert.equal(removed, 1); assert.equal(video.src, '');
  assert.equal(video.autoplay, false); assert.equal(timers.size, 0, 'Hidden preview does not retain its loading timeout');
  media().props.onError(); media().props.onWaiting(); await player.flush();
  assert.equal(nodes(player.tree, node => node.props?.role === 'alert').length, 0, 'Releasing a source is not an actionable video failure');
  for (const callback of listeners) callback(); assert.equal(loads, 1, 'Repeated hidden events do not reload');
  global.document.hidden = false; for (const callback of listeners) callback(); await player.flush();
  assert.equal(video.src, source); assert.equal(loads, 2); assert.equal(video.autoplay, false);
  media().props.onLoadedMetadata(); assert.equal(video.currentTime, 23.5);
  video.currentTime = 27; media().props.onLoadedMetadata(); assert.equal(video.currentTime, 27, 'Later metadata does not reseek');
  player.render({ file: { ...file, quality: { postCopy: 'Updated caption' } }, onClose() {} }); await player.flush();
  assert.equal(loads, 2); assert.equal(video.currentTime, 27, 'Metadata polling does not reset playback');
  player.unmount(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0); assert.equal(video.src, '');
});

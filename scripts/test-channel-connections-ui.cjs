const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } });
require("tsconfig-paths").register({ baseUrl: path.resolve(__dirname, ".."), paths: { "@/*": ["src/*"] } });
const React = require("react"), originalLoad = Module._load;
let current;
Module._load = function (name, parent, ...args) {
  if (name === "react" && path.basename(parent?.filename || "") === "ChannelConnections.tsx") return {
    ...React, useState: value => current.state(value), useRef: value => current.ref(value), useEffect: (effect, deps) => current.effect(effect, deps),
    useCallback: (callback, deps) => current.memo(() => callback, deps),
  };
  return originalLoad.call(this, name, parent, ...args);
};
let Component;
try { Component = require("../src/components/ChannelConnections.tsx").default; }
finally { Module._load = originalLoad; }

const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("")
  : typeof node === "object" ? text(node.props?.children) : String(node);
function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, found));
  else if (node && typeof node === "object") {
    if (predicate(node)) found.push(node);
    nodes(node.props?.children, predicate, found);
  }
  return found;
}
const changed = (slot, deps) => !slot || !deps || deps.some((value, index) => !Object.is(value, slot.deps?.[index]));
function hooks() {
  const slots = []; let index = 0, effects = [], tree, dirty = true;
  const h = {
    state(value) {
      const key = index++;
      if (!(key in slots)) slots[key] = { value: typeof value === "function" ? value() : value };
      return [slots[key].value, next => {
        slots[key].value = typeof next === "function" ? next(slots[key].value) : next; dirty = true;
      }];
    },
    memo(factory, deps) {
      const key = index++; if (changed(slots[key], deps)) slots[key] = { value: factory(), deps };
      return slots[key].value;
    },
    ref(value) { const key = index++; return slots[key] ||= { current: value }; },
    effect(effect, deps) {
      const key = index++; if (!changed(slots[key], deps)) return;
      slots[key] = { deps }; effects.push(effect);
    },
    render() {
      index = 0; dirty = false; current = h; tree = Component({});
      const pending = effects; effects = []; pending.forEach(effect => effect());
    },
    async flush() { for (let count = 0; count < 30; count++) { if (dirty) h.render(); await Promise.resolve(); } },
    get tree() { return tree; }, get text() { return text(tree); },
  };
  return h;
}
const status = (platform, extra = {}) => ({ platform, configured: false, connected: false, state: "not_connected",
  oauthAvailable: platform === "youtube", clientId: "", hasClientSecret: false,
  redirectUri: "http://localhost:3000/api/channels/" + platform + "/callback", ...extra });
const button = (h, label) => nodes(h.tree, node => node.type === "button" && text(node) === label)[0];
const field = (h, label) => nodes(h.tree, node => node.type === "label" && text(node) === label)[0].props.children
  .find(node => node?.type === "input");
function environment(t, channels, handlePost) {
  const saved = { fetch: global.fetch, window: global.window };
  const requests = [];
  global.window = { location: { search: "", assign() { assert.fail("This test never starts OAuth"); } } };
  global.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    return options.method ? handlePost(url, options) : Response.json({ channels });
  };
  t.after(() => { Object.assign(global, saved); current = undefined; });
  return requests;
}

test("private Instagram token field submits raw pasted headers with Enter, then clears only after successful verification", async t => {
  const ready = [status("youtube"), status("instagram")];
  const requests = environment(t, ready, async (url, options) => {
    assert.equal(url, "/api/channels/instagram");
    assert.equal(JSON.parse(options.body).accessToken, "Authorization: Bearer IGAA_fixture_not_real_123456789");
    return Response.json({ channels: [ready[0], status("instagram", { connected: true, state: "connected", name: "@verified_fixture" })] });
  });
  const h = hooks(); await h.flush();
  button(h, "Connect Instagram").props.onClick(); await h.flush();
  let input = field(h, "Instagram access token");
  assert.equal(input.props.type, "password"); assert.equal(input.props.autoComplete, "off");
  assert.equal(input.props.spellCheck, false);
  input.props.onChange({ target: { value: "Authorization: Bearer IGAA_fixture_not_real_123456789" } }); await h.flush();
  let prevented = false;
  const form = nodes(h.tree, node => node.type === "form")[0];
  form.props.onSubmit({ preventDefault() { prevented = true; } });
  form.props.onSubmit({ preventDefault() {} });
  await h.flush();
  assert.equal(prevented, true);
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.match(h.text, /@verified_fixture/); assert.match(h.text, /Connection verified successfully/);
  assert.equal(nodes(h.tree, node => node.type === "form").length, 0);
  const setup = nodes(h.tree, node => node.type === "div" && text(node).includes("@verified_fixture") &&
    nodes(node, child => child.type === "button" && text(child) === "Connection setup").length === 1).pop();
  nodes(setup, node => node.type === "button" && text(node) === "Connection setup")[0].props.onClick(); await h.flush();
  assert.equal(field(h, "Instagram access token").props.value, "");
  assert.match(h.text, /connects directly without a Facebook Page/);
});

test("failed token verification shows the actionable cause and preserves the owner's input for correction", async t => {
  const requests = environment(t, [status("youtube"), status("instagram")], async () =>
    Response.json({ error: "The access token is invalid, expired, or revoked." }, { status: 400 }));
  const h = hooks(); await h.flush(); button(h, "Connect Instagram").props.onClick(); await h.flush();
  field(h, "Instagram access token").props.onChange({ target: { value: "IGAA_fixture_not_real_123456789" } }); await h.flush();
  nodes(h.tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.match(h.text, /invalid, expired, or revoked/);
  assert.equal(field(h, "Instagram access token").props.value, "IGAA_fixture_not_real_123456789");
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.equal(button(h, "Verify and connect Instagram").props.disabled, false);
});

test("an expired YouTube connection exposes explicit Check connection without forcing a new login", async t => {
  const channels = [status("youtube", { configured: true, state: "needs_attention", name: "Owned channel", error: "Connection expired." }), status("instagram")];
  const requests = environment(t, channels, async (url, options) => {
    assert.equal(url, "/api/channels/youtube"); assert.deepEqual(JSON.parse(options.body), { action: "verify" });
    return Response.json({ channels: [status("youtube", { configured: true, connected: true, state: "connected", name: "Owned channel" }), channels[1]] });
  });
  const h = hooks(); await h.flush();
  assert.ok(button(h, "Check connection")); assert.ok(button(h, "Connect YouTube"));
  button(h, "Check connection").props.onClick(); await h.flush();
  assert.equal(requests.filter(request => request.method).length, 1);
  assert.equal(button(h, "Connect YouTube"), undefined);
  assert.match(h.text, /Connection verified successfully/);
  assert.match(h.text, /Upload reviewed videos on the platform/);
});

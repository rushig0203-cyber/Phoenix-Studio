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

test("the intended Instagram handle stays separate from verified account identity", async t => {
  environment(t, [status("youtube"), status("instagram")], async () => assert.fail("No connection request"));
  const h = hooks(); await h.flush();
  assert.match(h.text, /Intended account: @__bitet\.hemap/);
  assert.match(h.text, /Not connected/);
});

test('linked Facebook Page setup checks the saved token without choosing another Page or starting OAuth', async t => {
  const ready = [status('instagram', { connected: true, name: '@verified_fixture' }), status('facebook')];
  const requests = environment(t, ready, async (url, options) => {
    assert.equal(url, '/api/channels/facebook');
    assert.deepEqual(JSON.parse(options.body), { action: 'facebook-page' });
    return Response.json({ channels: [ready[0], status('facebook', { connected: true, publishReady: true, name: 'Verified linked Page' })] });
  });
  const h = hooks(); await h.flush();
  assert.match(h.text, /Connect the Page linked to your verified Instagram account/);
  button(h, 'Connect linked Facebook Page').props.onClick(); await h.flush();
  assert.equal(requests.filter(item => item.method).length, 0, 'Opening setup is inert');
  const token = field(h, 'Fresh Facebook User token (optional)');
  assert.equal(token.props.type, 'password'); assert.equal(token.props.autoComplete, 'off');
  assert.equal(token.props.spellCheck, false);
  assert.match(h.text, /pages_manage_posts/); assert.match(h.text, /Identity verification alone does not enable posting/);
  assert.match(h.text, /Meta app ID and App Secret saved with Instagram/);
  assert.match(h.text, /request up to 60 days of Facebook User access/);
  assert.match(h.text, /Meta decides the actual lifetime/); assert.match(h.text, /verifies the returned expiry/);
  assert.equal(nodes(h.tree, node => node.type === 'input' && node.props.inputMode === 'numeric').length, 0);
  assert.equal(nodes(h.tree, node => node.type === 'form' && text(node).includes('Meta app ID')).length, 0);
  const form = nodes(h.tree, node => node.type === 'form')[0];
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(requests.filter(item => item.method === 'POST').length, 1);
  assert.match(h.text, /Verified linked Page/); assert.match(h.text, /Ready for confirmed uploads/);
  assert.equal(nodes(h.tree, node => node.type === 'form').length, 0);
});

test('missing Facebook app credentials route to the existing Instagram setup without saving or copying a private token', async t => {
  const requests = environment(t, [status('instagram'), status('facebook')], async () => assert.fail('Opening app setup must not save credentials'));
  const h = hooks(); await h.flush(); button(h, 'Connect linked Facebook Page').props.onClick(); await h.flush();
  assert.match(h.text, /Instagram → Connection setup → Meta app credentials first/);
  field(h, 'Fresh Facebook User token (optional)').props.onChange({ target: { value: 'fixture_private_user_token' } }); await h.flush();
  button(h, 'Open Instagram Meta app credentials').props.onClick(); await h.flush();
  assert.equal(field(h, 'Meta app secret').props.type, 'password');
  assert.equal(field(h, 'Meta app secret').props.value, ''); assert.equal(field(h, 'Instagram access token').props.value, '');
  assert.match(h.text, /Facebook also uses these credentials to request and verify its User token lifetime/);
  assert.equal(nodes(h.tree, node => node.type === 'form' && text(node).includes('Meta app ID')).length, 1);
  assert.equal(requests.filter(item => item.method).length, 0);
});

test('a delayed refresh cannot overwrite newer linked Page connection status or its success notice', async t => {
  const ready = [status('facebook')];
  environment(t, ready, async () => Response.json({ channels: [status('facebook', { connected: true, publishReady: true, name: 'Fresh verified Page' })] }));
  const h = hooks(); await h.flush();
  button(h, 'Connect linked Facebook Page').props.onClick(); await h.flush();
  const form = nodes(h.tree, node => node.type === 'form')[0];
  const fetchAction = global.fetch; let resolveRefresh;
  global.fetch = (url, options = {}) => options.method ? fetchAction(url, options) : new Promise(resolve => { resolveRefresh = resolve; });
  nodes(h.tree, node => node.type === 'button' && node.props['aria-label'] === 'Refresh channel status')[0].props.onClick();
  form.props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.match(h.text, /Fresh verified Page/); assert.match(h.text, /Connection verified successfully/);
  resolveRefresh(Response.json({ channels: ready, error: 'Stale refresh must not win.' })); await h.flush();
  assert.match(h.text, /Fresh verified Page/); assert.match(h.text, /Ready for confirmed uploads/);
  assert.match(h.text, /Connection verified successfully/); assert.doesNotMatch(h.text, /Stale refresh/);
});

test('a fresh Facebook User token remains private and a permission error never creates a connected Page', async t => {
  let attempts = 0;
  const ready = [status('facebook')];
  const requests = environment(t, ready, async (url, options) => {
    assert.equal(url, '/api/channels/facebook');
    assert.deepEqual(JSON.parse(options.body), { action: 'facebook-page', accessToken: 'Authorization: Bearer fixture_fresh_user_token' });
    return ++attempts === 1 ? Response.json({ error: 'Authorize pages_manage_posts for the linked Page.' }, { status: 400 })
      : Response.json({ channels: [status('facebook', { connected: true, publishReady: true, name: 'Verified Page' })] });
  });
  const h = hooks(); await h.flush(); button(h, 'Connect linked Facebook Page').props.onClick(); await h.flush();
  field(h, 'Fresh Facebook User token (optional)').props.onChange({ target: { value: 'Authorization: Bearer fixture_fresh_user_token' } }); await h.flush();
  nodes(h.tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.match(h.text, /Authorize pages_manage_posts/); assert.match(h.text, /Not connected/);
  assert.doesNotMatch(h.text, /fixture_fresh_user_token/);
  assert.equal(field(h, 'Fresh Facebook User token (optional)').props.value, 'Authorization: Bearer fixture_fresh_user_token');
  nodes(h.tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  button(h, 'Connection setup').props.onClick(); await h.flush();
  assert.equal(field(h, 'Fresh Facebook User token (optional)').props.value, '');
  assert.equal(requests.filter(item => item.method === 'POST').length, 2);
});

test('localhost Meta app credentials are visible, private and saveable without starting OAuth or replacing the connected token', async t => {
  const ready = [status('youtube'), status('instagram', { connected: true, state: 'connected', name: '@verified_fixture', loginType: 'facebook', publishReady: true })];
  const requests = environment(t, ready, async (url, options) => {
    assert.equal(url, '/api/channels/instagram');
    assert.deepEqual(JSON.parse(options.body), { action: 'configure', clientId: '1443393741188691', clientSecret: 'fixture-private-app-secret' });
    return Response.json({ channels: [ready[0], { ...ready[1], configured: true, hasClientSecret: true, clientId: '1443393741188691' }] });
  });
  const h = hooks(); await h.flush();
  nodes(h.tree, node => node.type === 'button' && text(node) === 'Connection setup')[1].props.onClick(); await h.flush();
  assert.equal(field(h, 'Meta app secret').props.type, 'password'); assert.equal(field(h, 'Meta app secret').props.autoComplete, 'off');
  assert.match(h.text, /These fields work on localhost/);
  assert.match(h.text, /same Meta app/);
  field(h, 'Meta app ID').props.onChange({ target: { value: '1443393741188691' } }); await h.flush();
  field(h, 'Meta app secret').props.onChange({ target: { value: 'fixture-private-app-secret' } }); await h.flush();
  const appForm = nodes(h.tree, node => node.type === 'form' && text(node).includes('Meta app ID'))[0];
  appForm.props.onSubmit({ preventDefault() {} }); appForm.props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(requests.filter(item => item.method === 'POST').length, 1);
  assert.equal(field(h, 'Meta app secret').props.value, ''); assert.equal(field(h, 'Meta app secret').props.required, false);
  assert.match(h.text, /token connection is retained/); assert.match(h.text, /@verified_fixture/);
  assert.equal(button(h, 'Connect Instagram'), undefined, 'localhost must not offer unavailable Instagram OAuth');
});

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

test("an optional actual Page ID is submitted with the private token and its verified value is reusable", async t => {
  const pageId = "1234567890123";
  const ready = [status("youtube"), status("instagram")];
  const requests = environment(t, ready, async (url, options) => {
    assert.equal(url, "/api/channels/instagram");
    assert.deepEqual(JSON.parse(options.body), {
      action: "instagram-token", accessToken: "fixture_user_token_not_real", pageId,
    });
    return Response.json({ channels: [ready[0], status("instagram", {
      connected: true, state: "connected", name: "@verified_fixture", pageId,
    })] });
  });
  const h = hooks(); await h.flush(); button(h, "Connect Instagram").props.onClick(); await h.flush();
  const pageInput = field(h, "Facebook Page ID (optional)");
  assert.equal(pageInput.props.inputMode, "numeric");
  assert.match(h.text, /Meta Business Suite/);
  assert.match(h.text, /profile URL may be different/);
  field(h, "Instagram access token").props.onChange({ target: { value: "fixture_user_token_not_real" } }); await h.flush();
  field(h, "Facebook Page ID (optional)").props.onChange({ target: { value: ` ${pageId} ` } }); await h.flush();
  nodes(h.tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.match(h.text, /Connection verified successfully/);
  const instagramSetup = nodes(h.tree, node => node.type === "div" && text(node).includes("@verified_fixture") &&
    nodes(node, child => child.type === "button" && text(child) === "Connection setup").length === 1).pop();
  nodes(instagramSetup, node => node.type === "button" && text(node) === "Connection setup")[0].props.onClick(); await h.flush();
  assert.equal(field(h, "Instagram access token").props.value, "");
  assert.equal(field(h, "Facebook Page ID (optional)").props.value, pageId);
});

test("a profile URL is rejected as a Page ID before sending credentials", async t => {
  const requests = environment(t, [status("youtube"), status("instagram")], async () => assert.fail("Invalid Page IDs must not be posted"));
  const h = hooks(); await h.flush(); button(h, "Connect Instagram").props.onClick(); await h.flush();
  field(h, "Instagram access token").props.onChange({ target: { value: "fixture_user_token_not_real" } }); await h.flush();
  field(h, "Facebook Page ID (optional)").props.onChange({ target: { value: "https://www.facebook.com/profile.php?id=1234567890123" } }); await h.flush();
  nodes(h.tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.match(h.text, /numeric Page ID/);
  assert.equal(requests.filter(request => request.method === "POST").length, 0);
  assert.equal(field(h, "Instagram access token").props.value, "fixture_user_token_not_real");
});

test("a denied Page hint preserves both inputs and does not claim success", async t => {
  const requests = environment(t, [status("youtube"), status("instagram")], async () =>
    Response.json({ error: "The specified Page could not be verified." }, { status: 400 }));
  const h = hooks(); await h.flush(); button(h, "Connect Instagram").props.onClick(); await h.flush();
  field(h, "Instagram access token").props.onChange({ target: { value: "fixture_user_token_not_real" } }); await h.flush();
  field(h, "Facebook Page ID (optional)").props.onChange({ target: { value: "1234567890123" } }); await h.flush();
  nodes(h.tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.match(h.text, /specified Page could not be verified/);
  assert.doesNotMatch(h.text, /Connection verified successfully/);
  assert.equal(field(h, "Instagram access token").props.value, "fixture_user_token_not_real");
  assert.equal(field(h, "Facebook Page ID (optional)").props.value, "1234567890123");
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
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
  assert.match(h.text, /Upload reviewed videos from their posting tools/);
});

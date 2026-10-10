const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const { test, beforeEach, after } = require("node:test");

// Everything is isolated from the owner's media, vault and network. No provider request is real.
const project = path.resolve(__dirname, "..");
const originalCwd = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-upload-tests-"));
process.chdir(temporary);
const previousStore = process.env.PHOENIX_PUBLISH_STORAGE;
process.env.PHOENIX_PUBLISH_STORAGE = path.join(temporary, "jobs");
require(path.join(project, "node_modules", "ts-node")).register({ project: path.join(project, "tsconfig.json"), transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" } });
require(path.join(project, "node_modules", "tsconfig-paths")).register({ baseUrl: project, paths: { "@/*": ["src/*"] } });
const channels = require(path.join(project, "src/lib/channelConnections.ts"));
const originalChannelExports = {};
for (const key of ["getChannelPublishAccess", "assertChannelPublishAccessCurrent", "createChannelPublishAccessMonitor", "getChannelUploadSession", "saveChannelUploadSession", "getInstagramLocationAppSecretProof"]) originalChannelExports[key] = channels[key];
const sessions = new Map();
let accessCalls = 0, assertionCalls = 0, channelChanged = false, permissionDenied = false;
let instagramAccount = "123456789012345", instagramLogin = "facebook";
let appSecretProof = null, proofCalls = 0, sessionReads = 0;
channels.getChannelPublishAccess = async (platform, expectedRevision) => {
  accessCalls++;
  if (permissionDenied || expectedRevision !== "fixture-revision") throw new Error("Untrusted credential error fixture-secret-token");
  return { platform, accountId: platform === "instagram" ? instagramAccount : "fixture-owning-channel", name: "Fixture channel",
    connectionRevision: "fixture-revision", accessToken: "fixture-secret-token", loginType: platform === "instagram" ? instagramLogin : "youtube" };
};
channels.assertChannelPublishAccessCurrent = async () => { assertionCalls++; if (channelChanged) throw new Error("Changed private account fixture-secret-token"); };
channels.createChannelPublishAccessMonitor = async access => {
  await channels.assertChannelPublishAccessCurrent(access);
  return async () => { if (channelChanged) throw new Error("Changed private account fixture-secret-token"); };
};
channels.getChannelUploadSession = async id => { sessionReads++; return sessions.get(id) || null; };
channels.saveChannelUploadSession = async (id, value) => { if (value === null) sessions.delete(id); else sessions.set(id, value); };
channels.getInstagramLocationAppSecretProof = async access => { proofCalls++; await channels.assertChannelPublishAccessCurrent(access); return appSecretProof; };
const publishing = require(path.join(project, "src/lib/reviewPublishing.ts"));
const files = require(path.join(project, "src/lib/reviewFiles.ts"));
const scheduled = [];
const originalLoad = Module._load;
Module._load = function(name, parent, main) {
  if (name === "next/server") return { ...originalLoad.call(this, name, parent, main), after: callback => scheduled.push(callback) };
  return originalLoad.call(this, name, parent, main);
};
const route = require(path.join(project, "src/app/api/review-files/[id]/publish/route.ts"));
Module._load = originalLoad;
const realFetch = global.fetch;
const location = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture-private-session";
const instagramLocation = "https://rupload.facebook.com/ig-api-upload/v21.0/987654321012345";
const context = id => ({ params: Promise.resolve({ id }) });
const request = (id, body, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/review-files/${id}/publish`, {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const settings = (platform = "youtube", overrides = {}) => ({ action: "create", confirm: true, platform, title: "Fixture title", caption: "Fixture caption",
  madeForKids: false, connectionRevision: "fixture-revision", ...(platform === "instagram" ? { privacy: "public" } : {}), ...overrides });
const storedPath = (id, platform = "youtube") => path.join(process.env.PHOENIX_PUBLISH_STORAGE, `${id}-${platform}.json`);
const businessPath = () => path.join(process.env.PHOENIX_PUBLISH_STORAGE, "instagram-story-business.json");
const storyPath = id => storedPath(id, "instagram-story");
const readStory = id => JSON.parse(fs.readFileSync(storyPath(id), "utf8"));
const readStored = (id, platform) => JSON.parse(fs.readFileSync(storedPath(id, platform), "utf8"));
const alterStored = (id, change, platform) => {
  const job = readStored(id, platform); change(job); fs.writeFileSync(storedPath(id, platform), JSON.stringify(job)); return job;
};
async function fixture(target = "youtube", size = 256 * 1024 + 3, stock = false) {
  const id = crypto.randomUUID(); const timestamp = new Date().toISOString();
  const file = { id, title: "Fixture video", createdAt: timestamp, updatedAt: timestamp, status: "READY", targets: [target],
    source: { kind: stock ? "pexels" : "upload", filename: "fixture.mp4", licence: "Fixture licence", ...(stock ? { providerUrl: "https://www.pexels.com/video/123/?tracking=discard" } : {}) },
    outputs: { [target]: { filename: `${id}-${target}.mp4`, duration: 10, width: 1080, height: 1920 } },
    quality: { audio: "no-audio", captions: [], hashtags: [], checks: [], ...(stock ? { visualSources: [{ provider: "pexels", providerMediaId: "123", providerUrl: "https://www.pexels.com/video/123/", creator: "Fixture creator", licence: "Fixture licence" }] } : {}) }, audience: "general" };
  await files.saveReviewFile(file);
  fs.writeFileSync(files.outputPath(id, target), Buffer.alloc(size, 7));
  return { id, file };
}
async function consumeStream(options, expectedOffset = 0) {
  assert.equal(options.duplex, "half"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store"); assert.ok(options.signal);
  assert.equal(options.body.readableObjectMode, false, "The watermark must count bytes, not 64K video chunks");
  assert.equal(options.body.readableHighWaterMark, 64 * 1024);
  assert.ok(!Buffer.isBuffer(options.body), "The whole video must never be read into memory");
  let size = 0; for await (const chunk of options.body) { size += chunk.length; assert.ok(chunk.length <= 128 * 1024); }
  assert.equal(size, Number(options.headers["Content-Length"]));
  if (options.method === "PUT") assert.match(options.headers["Content-Range"], new RegExp(`^bytes ${expectedOffset}-`));
  return size;
}
beforeEach(() => {
  channelChanged = false; permissionDenied = false; accessCalls = 0; assertionCalls = 0; scheduled.length = 0;
  instagramAccount = "123456789012345"; instagramLogin = "facebook";
  appSecretProof = null; proofCalls = 0; sessionReads = 0;
  fs.rmSync(businessPath(), { force: true });
  fs.rmSync(path.join(process.env.PHOENIX_PUBLISH_STORAGE, 'instagram-posting-defaults.json'), { force: true });
  global.fetch = async () => { assert.fail("Every test must explicitly mock provider calls; real network is forbidden"); };
});
after(() => {
  global.fetch = realFetch; Object.assign(channels, originalChannelExports); process.chdir(originalCwd);
  if (previousStore === undefined) delete process.env.PHOENIX_PUBLISH_STORAGE; else process.env.PHOENIX_PUBLISH_STORAGE = previousStore;
  const resolved = path.resolve(temporary);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("phoenix-upload-tests-"));
  fs.rmSync(resolved, { recursive: true, force: true });
});

test("confirmation, local request, audience and Instagram visibility are explicit prerequisites", async () => {
  const { id } = await fixture();
  await assert.rejects(publishing.prepareReviewPublication(id, settings("youtube", { confirm: false })), /Confirm/);
  await assert.rejects(publishing.prepareReviewPublication(id, settings("youtube", { madeForKids: undefined })), /made-for-kids/);
  await assert.rejects(publishing.prepareReviewPublication(id, settings("instagram", { privacy: "private" })), /publicly/);
  assert.equal((await route.POST(request(id, settings(), "https://outside.example"), context(id))).status, 403);
  assert.equal((await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`, { headers: { origin: "https://outside.example" } }), context(id))).status, 403);
  assert.equal(accessCalls, 0);
  assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});
test("create is durable, reviewed caption is immutable, provenance stays in file metadata and duplicate create returns one job", async () => {
  const { id, file } = await fixture("youtube", 100, true);
  const first = await publishing.prepareReviewPublication(id, settings());
  const second = await publishing.prepareReviewPublication(id, settings("youtube", { title: "Changed title", caption: "Changed caption" }));
  assert.equal(first.dispatch, true); assert.equal(second.dispatch, false); assert.equal(first.job.id, second.job.id);
  const stored = readStored(id); assert.equal(stored.title, "Fixture title"); assert.equal(stored.privacy, "private");
  assert.equal(stored.caption, "Fixture caption"); assert.deepEqual((await files.getReviewFile(id)).quality.visualSources, file.quality.visualSources);
  const publicJson = JSON.stringify(first.job); assert.ok(!publicJson.includes(temporary)); assert.ok(!publicJson.includes("fixture-secret-token")); assert.ok(!publicJson.includes("accessToken"));
});

test("Instagram rejects extra caption hashtags before credentials or dispatch, retaining reviewed text rather than silently truncating it", async () => {
  const {id}=await fixture('instagram');
  const caption='Approved caption #one #two #three #four #five ＃six';
  const response=await route.POST(request(id,settings('instagram',{caption})),context(id));
  assert.equal(response.status,400);assert.match((await response.json()).error,/at most five hashtags/);
  assert.equal(accessCalls,0);assert.equal(scheduled.length,0);assert.deepEqual(await publishing.listReviewPublishJobs(id),[]);
  const approved='Approved caption #one #two #three #four #five';
  const saved=await publishing.prepareReviewPublication(id,settings('instagram',{caption:approved}));
  assert.equal(saved.dispatch,true);assert.equal(readStored(id,'instagram').caption,approved);
});

test("YouTube accepts a reviewed twenty-tag bank without adding footage provenance or a second provider request", async () => {
  const {id}=await fixture('youtube',100,true);
  const caption=`Visible waterfalls.\n\n${Array.from({length:20},(_,index)=>`#Waterfall${index}`).join(' ')}`;
  const saved=await publishing.prepareReviewPublication(id,settings('youtube',{caption}));
  assert.equal(saved.dispatch,true);assert.equal(readStored(id).caption,caption);
  assert.equal((readStored(id).caption.match(/#Waterfall\d+/g)||[]).length,20);
  assert.equal(scheduled.length,0);
});

test('YouTube accepts the full 5000-byte description including multibyte UTF-8 without changing reviewed text', async () => {
  for (const caption of ['x'.repeat(5000), 'é'.repeat(2500), '🌲'.repeat(1250)]) {
    assert.equal(Buffer.byteLength(caption, 'utf8'), 5000);
    const { id } = await fixture('youtube', 100);
    const result = await publishing.prepareReviewPublication(id, settings('youtube', { caption }));
    assert.equal(result.dispatch, true); assert.equal(readStored(id).caption, caption);
  }
  assert.equal(scheduled.length, 0, 'Preparation never starts a provider upload itself');
});

test('YouTube rejects oversized UTF-8 and forbidden title/description brackets before credentials or dispatch', async () => {
  for (const change of [{ caption: 'é'.repeat(2501) }, { caption: '🌲'.repeat(1251) },
    { caption: 'A <tree>' }, { title: 'A tree > another' }]) {
    const { id } = await fixture('youtube', 100);
    const result = await route.POST(request(id, settings('youtube', change)), context(id));
    assert.equal(result.status, 400); assert.match((await result.json()).error, /5000 UTF-8 bytes|cannot contain < or >/);
    assert.equal(accessCalls, 0); assert.equal(scheduled.length, 0);
    assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
  }
});

test('a legacy saved YouTube request with invalid metadata cannot contact a provider or continue', async () => {
  const { id } = await fixture('youtube', 100);
  const { job } = await publishing.prepareReviewPublication(id, settings('youtube'));
  alterStored(id, saved => { saved.caption = 'é'.repeat(2501); });
  accessCalls = 0; await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.status, 'FAILED'); assert.match(status.detail, /5000 UTF-8 bytes/); assert.equal(accessCalls, 0);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue', jobId: job.id, confirm: true }), /5000 UTF-8 bytes/);
  assert.equal(accessCalls, 0);
});

test("ten-source Instagram reels omit generated footage footers while retaining complete source metadata", async () => {
  const {id,file}=await fixture('instagram',100,true);
  const sources=Array.from({length:10},(_,index)=>({provider:index%2?'pixabay':'pexels',providerMediaId:String(index+100),providerUrl:index%2?`https://pixabay.com/videos/moving-water-in-forest-${index+100}/`:`https://www.pexels.com/video/moving-water-and-green-trees-${index+100}/`,creator:`Fixture creator ${index}`,licence:'Full source licence metadata '.repeat(20)}));
  file.source.providerUrl=sources[0].providerUrl;file.quality.visualSources=sources;await files.saveReviewFile(file);
  const caption=`Water cascades between the trees.\nFootage sources: ${sources.map(source=>source.providerUrl).join('\n')}\n\n#Waterfall #Forest #Nature #Cascades #Water`;
  assert.ok(caption.length<2200);
  const saved=await publishing.prepareReviewPublication(id,settings('instagram',{caption}));
  assert.equal(saved.dispatch,true);assert.equal(readStored(id,'instagram').caption,'Water cascades between the trees.\n\n#Waterfall #Forest #Nature #Cascades #Water');
  for(const source of sources)assert.ok(!readStored(id,'instagram').caption.includes(source.providerUrl));
  assert.deepEqual((await files.getReviewFile(id)).quality.visualSources,sources,'Complete creator/licence metadata remains saved');
});

test("ordinary owner URLs and lookalike hosts are preserved without appending unrelated footage credits", async () => {
  const {id,file}=await fixture('instagram',100,true);
  const second='https://pixabay.com/videos/fixture-456/';
  file.quality.visualSources.push({provider:'pixabay',providerMediaId:'456',providerUrl:second,creator:'Second fixture creator',licence:'Fixture licence'});await files.saveReviewFile(file);
  const caption='Viewed footage: https://www.pexels.com/video/123/extra and https://www.pexels.com.evil.example/video/123/';
  await publishing.prepareReviewPublication(id,settings('instagram',{caption}));
  const text=readStored(id,'instagram').caption;
  assert.equal(text,caption);assert.ok(!text.includes('Source credits:'));assert.ok(!text.includes(second));
});

test("generated footage source is removed but report citation and saved footage provenance remain", async () => {
  const {id,file}=await fixture('instagram',100,true);
  const second='https://pixabay.com/videos/fixture-789/';
  file.quality.visualSources.push({provider:'pixabay',providerMediaId:'789',providerUrl:second,creator:'Second fixture creator',licence:'Fixture licence'});await files.saveReviewFile(file);
  const caption='Footage source: https://www.pexels.com/video/123/\nReport source: BBC https://www.bbc.com/news/fixture';
  await publishing.prepareReviewPublication(id,settings('instagram',{caption}));
  const text=readStored(id,'instagram').caption;
  assert.equal(text,'Report source: BBC https://www.bbc.com/news/fixture');assert.ok(!text.includes(second));
  assert.equal((await files.getReviewFile(id)).quality.visualSources.length,2);
});

test("an old saved Instagram upload with excess hashtags fails safely before accessing a provider", async () => {
  const {id}=await fixture('instagram');const {job}=await publishing.prepareReviewPublication(id,settings('instagram'));
  alterStored(id,saved=>{saved.caption='Old caption #one #two #three #four #five #six';},'instagram');
  accessCalls=0;await publishing.runReviewPublication(id,job.id);
  const [status]=await publishing.listReviewPublishJobs(id);
  assert.equal(status.status,'FAILED');assert.match(status.detail,/at most five hashtags/);assert.equal(accessCalls,0);
  await assert.rejects(publishing.prepareReviewPublication(id,{action:'continue',jobId:job.id,confirm:true}),/at most five hashtags/);
  assert.equal(accessCalls,0);
});
test("POST schedules only newly confirmed work, GET is read-only and an interrupted queue needs manual Continue", async () => {
  const { id } = await fixture();
  const posted = await route.POST(request(id, settings()), context(id)); assert.equal(posted.status, 202); assert.equal(scheduled.length, 1);
  await route.POST(request(id, settings()), context(id)); assert.equal(scheduled.length, 1);
  alterStored(id, job => { job.queuedAt = 0; });
  accessCalls = 0;
  const response = await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id));
  const { jobs } = await response.json(); assert.equal(jobs[0].status, "NEEDS_CHECK"); assert.equal(jobs[0].canContinue, true);
  assert.equal(accessCalls, 0); assert.equal(scheduled.length, 1); assert.equal(readStored(id).status, "QUEUED");
});
test("safe URLs and strict resume ranges reject credentials, redirects, lookalike hosts and offsets outside the file", () => {
  assert.equal(publishing.validateReviewUploadUrl(location, "youtube"), location);
  assert.equal(publishing.validateReviewUploadUrl(instagramLocation, "instagram"), instagramLocation);
  for (const unsafe of ["http://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x", "https://www.googleapis.com.evil.example/upload/youtube/v3/videos?uploadType=resumable&upload_id=x", "https://token@www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x", location + "&access_token=secret", "https://www.googleapis.com/other?uploadType=resumable&upload_id=x"]) assert.throws(() => publishing.validateReviewUploadUrl(unsafe, "youtube"), /unsafe/);
  assert.throws(() => publishing.validateReviewUploadUrl("https://rupload.facebook.com/other", "instagram"), /unsafe/);
  assert.equal(publishing.youtubeResumeOffset(null, 100), 0); assert.equal(publishing.youtubeResumeOffset("bytes=0-49", 100), 50);
  for (const range of ["bytes=1-49", "bytes=0-100", "bytes=0--1", "bytes=0-999999999999999999"]) assert.throws(() => publishing.youtubeResumeOffset(range, 100), /invalid resume range/);
});
test("permission and connection revision failures stop before any provider action", async () => {
  const { id } = await fixture(); permissionDenied = true;
  await assert.rejects(publishing.prepareReviewPublication(id, settings()), error => /upload permission/.test(error.message) && !error.message.includes("fixture-secret-token"));
  permissionDenied = false;
  const { job } = await publishing.prepareReviewPublication(id, settings()); channelChanged = true;
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "FAILED"); assert.match(status.detail, /connection changed/);
});
test("YouTube streams with bounded backpressure and reports actual returned privacy", async () => {
  const { id } = await fixture("youtube", 4 * 1024 * 1024 + 3); let uploads = 0;
  global.fetch = async (url, options) => {
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer fixture-secret-token");
    if (options.method === "POST") { const metadata = JSON.parse(options.body); assert.equal(metadata.status.privacyStatus, "public"); assert.equal(metadata.status.selfDeclaredMadeForKids, false); return new Response(null, { headers: { Location: location } }); }
    if (!options.body) return new Response(null, { status: 308 });
    uploads++; options.body.read(0);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(options.body.readableLength <= 128 * 1024, "A stalled consumer must not prebuffer megabytes");
    await consumeStream(options);
    return Response.json({ id: "abcDEF123_-", status: { privacyStatus: "private" } }, { status: 201 });
  };
  const { job } = await publishing.prepareReviewPublication(id, settings("youtube", { privacy: "public" }));
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "COMPLETE"); assert.equal(status.privacy, "public"); assert.equal(status.actualPrivacy, "private");
  assert.match(status.detail, /private visibility/); assert.equal(status.percent, 100); assert.equal(uploads, 1);
  assert.ok(assertionCalls < 12, "Vault assertions must not run on every chunk or progress update");
  assert.equal(sessions.has(job.id), false);
});
test("single-output fallback is pinned even when a different platform output appears later", async () => {
  const { id, file } = await fixture("youtube", 100);
  const prepared = await publishing.prepareReviewPublication(id, settings("instagram")); assert.equal(prepared.job.outputTarget, "youtube");
  file.outputs.instagram = { filename: `${id}-instagram.mp4`, duration: 10, width: 1080, height: 1920 };
  await files.saveReviewFile(file); fs.writeFileSync(files.outputPath(id, "instagram"), Buffer.alloc(200, 9));
  let transferred = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/media")) return Response.json({ id: "987654321012345", uri: instagramLocation });
    if (new URL(url).hostname === "rupload.facebook.com") { transferred = await consumeStream(options); return Response.json({ success: true }); }
    if (String(url).includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
    if (String(url).endsWith("/media_publish")) return Response.json({ id: "456789012345678" });
    return Response.json({ permalink: "https://www.instagram.com/reel/fixtureReel/" });
  };
  await publishing.runReviewPublication(id, prepared.job.id); assert.equal(transferred, 100);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "COMPLETE"); assert.equal(status.outputTarget, "youtube"); assert.equal(status.remoteId, "456789012345678");
});
test("disconnect during a stalled stream prevents subsequent chunks and refuses continuation", async () => {
  const { id } = await fixture("instagram", 4 * 1024 * 1024); let publishes = 0, transferred = 0;
  const realNow = Date.now;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/media")) return Response.json({ id: "987654321012345", uri: instagramLocation });
    if (new URL(url).hostname === "rupload.facebook.com") {
      const iterator = options.body[Symbol.asyncIterator]();
      const first = await iterator.next(); assert.equal(first.done, false); transferred += first.value.length;
      channelChanged = true;
      // Simulate a paused consumer resuming after the two-second check interval.
      Date.now = () => realNow() + 2100;
      try {
        for (;;) { const next = await iterator.next(); if (next.done) break; transferred += next.value.length; }
      } finally { Date.now = realNow; }
      assert.fail("A disconnected channel must terminate the body stream");
    }
    if (String(url).endsWith("/media_publish")) publishes++;
    assert.fail("Disconnected upload must not poll or publish");
  };
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram"));
  try { await publishing.runReviewPublication(id, job.id); } finally { Date.now = realNow; }
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "FAILED"); assert.match(status.detail, /connection changed or was disconnected/);
  assert.ok(transferred <= 3 * 64 * 1024, "Only small buffers already in flight may survive disconnection"); assert.equal(publishes, 0);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue", jobId: job.id, confirm: true }), /connection changed or was disconnected/);
});
test("two confirmed jobs queue while one stream runs, and duplicate callbacks cannot publish twice", async () => {
  const first = await fixture("youtube", 100); const second = await fixture("youtube", 100);
  const firstJob = await publishing.prepareReviewPublication(first.id, settings());
  const secondJob = await publishing.prepareReviewPublication(second.id, settings());
  let releaseFirst, enteredFirst; let activeStreams = 0, maximumStreams = 0, initiations = 0;
  const held = new Promise(resolve => { releaseFirst = resolve; });
  const entered = new Promise(resolve => { enteredFirst = resolve; });
  global.fetch = async (url, options) => {
    if (options.method === "POST") { initiations++; return new Response(null, { headers: { Location: location } }); }
    if (!options.body) return new Response(null, { status: 308 });
    activeStreams++; maximumStreams = Math.max(maximumStreams, activeStreams);
    if (initiations === 1) { enteredFirst(); await held; }
    await consumeStream(options); activeStreams--; return Response.json({ id: "abcDEF123_-" }, { status: 201 });
  };
  const runningFirst = publishing.runReviewPublication(first.id, firstJob.job.id); await entered;
  const runningSecond = publishing.runReviewPublication(second.id, secondJob.job.id);
  const deadline = Date.now() + 3000;
  while (!readStored(second.id).detail.startsWith("Waiting for") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const [queued] = await publishing.listReviewPublishJobs(second.id); assert.equal(queued.status, "QUEUED"); assert.match(queued.detail, /Waiting for/);
  await publishing.runReviewPublication(first.id, firstJob.job.id);
  releaseFirst(); await Promise.all([runningFirst, runningSecond]);
  assert.equal(maximumStreams, 1); assert.equal(initiations, 2);
  assert.equal((await publishing.listReviewPublishJobs(first.id))[0].status, "COMPLETE");
  assert.equal((await publishing.listReviewPublishJobs(second.id))[0].status, "COMPLETE");
});
test("an ambiguous YouTube session initiation is durable and never blindly repeated", async () => {
  const { id } = await fixture(); let initiations = 0;
  global.fetch = async () => { initiations++; throw new Error("Lost response with fixture-secret-token " + location); };
  const { job } = await publishing.prepareReviewPublication(id, settings()); await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "NEEDS_CHECK"); assert.equal(status.canContinue, false);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue", jobId: job.id, confirm: true }), /will not repeat/);
  const duplicate = await publishing.prepareReviewPublication(id, settings()); assert.equal(duplicate.dispatch, false); assert.equal(initiations, 1);
  assert.ok(!JSON.stringify(status).includes("fixture-secret-token")); assert.ok(!JSON.stringify(status).includes("fixture-private-session"));
});
test("an unsafe Location is rejected before sending credentials or streaming video to it", async () => {
  const { id } = await fixture(); let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { headers: { Location: "https://evil.example/upload?access_token=fixture-secret-token" } }); };
  const { job } = await publishing.prepareReviewPublication(id, settings()); await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(calls, 1); assert.equal(status.canContinue, false); assert.match(status.detail, /unsafe upload destination/);
});
test("interrupted YouTube upload continues only after querying its existing session and uses the acknowledged offset", async () => {
  const { id } = await fixture("youtube", 100); let initiation = 0, checks = 0, streams = 0;
  global.fetch = async (url, options) => {
    if (options.method === "POST") { initiation++; return new Response(null, { headers: { Location: location } }); }
    if (!options.body) { checks++; return new Response(null, { status: 308, headers: checks > 1 ? { Range: "bytes=0-49" } : {} }); }
    streams++; if (streams === 1) { await consumeStream(options); throw new Error("Ambiguous binary response"); }
    await consumeStream(options, 50); return Response.json({ id: "abcDEF123_-" }, { status: 201 });
  };
  const { job } = await publishing.prepareReviewPublication(id, settings()); await publishing.runReviewPublication(id, job.id);
  assert.equal((await publishing.listReviewPublishJobs(id))[0].canContinue, true);
  assert.equal((await publishing.prepareReviewPublication(id, { action: "continue", jobId: job.id, confirm: true })).dispatch, true);
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "COMPLETE"); assert.equal(status.actualPrivacy, undefined); assert.match(status.detail, /actual visibility was not returned/);
  assert.equal(initiation, 1); assert.equal(checks, 2); assert.equal(streams, 2);
});
test("mutation and invalid status ranges prevent resending saved video", async () => {
  const { id } = await fixture("youtube", 100);
  const { job } = await publishing.prepareReviewPublication(id, settings()); fs.appendFileSync(files.outputPath(id, "youtube"), Buffer.from([1]));
  await publishing.runReviewPublication(id, job.id); assert.match((await publishing.listReviewPublishJobs(id))[0].detail, /changed after confirmation/);
  const next = await fixture("youtube", 100); let calls = 0;
  global.fetch = async (url, options) => { calls++; return options.method === "POST" ? new Response(null, { headers: { Location: location } }) : new Response(null, { status: 308, headers: { Range: "bytes=0-100" } }); };
  const prepared = await publishing.prepareReviewPublication(next.id, settings()); await publishing.runReviewPublication(next.id, prepared.job.id);
  assert.equal(calls, 2); assert.match((await publishing.listReviewPublishJobs(next.id))[0].detail, /invalid resume range/);
});
test("Instagram final publish ambiguity is retained and Continue cannot repeat publishing", async () => {
  const { id } = await fixture("instagram", 100); let published = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/media")) { const body = new URLSearchParams(options.body); assert.equal(body.get("upload_type"), "resumable"); assert.equal(body.get("media_type"), "REELS"); return Response.json({ id: "987654321012345", uri: instagramLocation }); }
    if (new URL(url).hostname === "rupload.facebook.com") { assert.equal(options.headers.Authorization, "OAuth fixture-secret-token"); assert.equal(options.headers.offset, "0"); assert.equal(options.headers.file_size, "100"); await consumeStream(options); return Response.json({ success: true }); }
    if (String(url).includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
    published++; throw new Error("Publish accepted but response lost with fixture-secret-token");
  };
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram")); await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "NEEDS_CHECK"); assert.equal(status.canContinue, false);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue", jobId: job.id, confirm: true }), /will not repeat/); assert.equal(published, 1);
});
test("moving the local review video to Trash during Instagram processing prevents final publish", async () => {
  const { id } = await fixture("instagram", 100); let publishes = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/media")) return Response.json({ id: "987654321012345", uri: instagramLocation });
    if (new URL(url).hostname === "rupload.facebook.com") { await consumeStream(options); return Response.json({ success: true }); }
    if (String(url).includes("fields=status_code")) { await files.removeReviewFile(id); return Response.json({ status_code: "FINISHED" }); }
    publishes++; assert.fail("Trashed review media must never reach media_publish");
  };
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram")); await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "FAILED"); assert.match(status.detail, /no longer available/); assert.equal(publishes, 0);
});
test("Instagram processing permission errors persist and a failed permalink lookup never repeats successful publish", async () => {
  const { id } = await fixture("instagram", 100); let publishes = 0;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/media")) return Response.json({ id: "987654321012345", uri: instagramLocation });
    if (new URL(url).hostname === "rupload.facebook.com") { await consumeStream(options); return Response.json({ success: true }); }
    if (String(url).includes("fields=status_code")) return Response.json({ status_code: "FINISHED" });
    if (String(url).endsWith("/media_publish")) { publishes++; return Response.json({ id: "456789012345678" }); }
    throw new Error("Permalink failure");
  };
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram")); await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id); assert.equal(status.status, "COMPLETE"); assert.equal(status.remoteId, "456789012345678"); assert.equal(status.remoteUrl, undefined);
  const continued = await publishing.prepareReviewPublication(id, { action: "continue", jobId: job.id, confirm: true }); assert.equal(continued.dispatch, false); assert.equal(publishes, 1);
  alterStored(id, value => { value.remoteUrl = "javascript:fixture-secret-token"; }, "instagram");
  assert.equal((await publishing.listReviewPublishJobs(id))[0].remoteUrl, undefined);
});
test("oversized and unreadable provider JSON is bounded and redacted without losing durable status", async () => {
  const { id } = await fixture("instagram", 100); let cancelled = 0, reads = 0;
  global.fetch = async () => new Response(new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(70 * 1024)); }, cancel() { cancelled++; } }));
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram")); await publishing.runReviewPublication(id, job.id);
  assert.ok(cancelled); assert.ok(reads <= 2); const [status] = await publishing.listReviewPublishJobs(id); assert.match(status.detail, /unexpectedly large/); assert.equal(status.canContinue, false);
  const requestWithLargeBody = new Request("http://localhost:3000", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(25000) }) });
  await assert.rejects(publishing.readReviewPublishBody(requestWithLargeBody), /too large/);
});

const businessSettings = overrides => ({ confirm: true, businessAccountConfirmed: true, connectionRevision: "fixture-revision", ...overrides });
async function confirmedStoryFixture(size = 100) {
  const value = await fixture("instagram", size);
  assert.equal((await publishing.confirmInstagramStoryBusiness(value.id, businessSettings())).ready, true);
  return value;
}
function installStoryProvider({ failStoryCreation = false, ambiguousStoryPublish = false, afterReel } = {}) {
  const counters = { creations: [], streams: [], publishes: [], permalinkLookups: 0 };
  const reelContainer = "987654321012345", storyContainer = "987654321012346";
  const reelMedia = "456789012345678", storyMedia = "456789012345679";
  global.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/media")) {
      const body = new URLSearchParams(options.body); const kind = body.get("media_type");
      assert.equal(body.get("upload_type"), "resumable"); assert.equal(options.method, "POST");
      assert.ok(["REELS", "STORIES"].includes(kind)); counters.creations.push(kind);
      if (kind === "STORIES") {
        assert.equal(body.has("caption"), false, "A Story must not inherit the Reel's caption into unsupported API fields");
        if (failStoryCreation) return Response.json({ error: { code: 200, message: "Fixture permission denied" } }, { status: 400 });
      } else assert.equal(body.get("caption"), "Fixture caption");
      const container = kind === "STORIES" ? storyContainer : reelContainer;
      return Response.json({ id: container, uri: `https://rupload.facebook.com/ig-api-upload/v21.0/${container}` });
    }
    if (parsed.hostname === "rupload.facebook.com") {
      assert.equal(options.headers.Authorization, "OAuth fixture-secret-token");
      counters.streams.push({ container: parsed.pathname.split("/").at(-1), bytes: await consumeStream(options) });
      return Response.json({ success: true });
    }
    if (parsed.searchParams.get("fields") === "status_code") return Response.json({ status_code: "FINISHED" });
    if (parsed.pathname.endsWith("/media_publish")) {
      const container = new URLSearchParams(options.body).get("creation_id");
      counters.publishes.push(container);
      if (container === storyContainer && ambiguousStoryPublish) throw new Error("Fixture lost Story publication response");
      return Response.json({ id: container === storyContainer ? storyMedia : reelMedia });
    }
    if (parsed.searchParams.get("fields") === "permalink") {
      assert.equal(parsed.pathname.split("/").at(-1), reelMedia, "Stories must not request or fabricate a Reel permalink");
      counters.permalinkLookups++; if (afterReel) await afterReel();
      return Response.json({ permalink: "https://www.instagram.com/reel/fixtureReel/" });
    }
    assert.fail(`Unexpected fixture provider operation: ${parsed.pathname}`);
  };
  return counters;
}

test("Story enablement requires explicit local Business confirmation and does not publish, schedule or probe Meta", async () => {
  const { id } = await fixture("instagram", 100);
  const unknown = await publishing.checkInstagramStoryCapability(id, "fixture-revision");
  assert.equal(unknown.ready, false); assert.equal(unknown.requiresBusinessConfirmation, true);
  await assert.rejects(publishing.confirmInstagramStoryBusiness(id, businessSettings({ confirm: false })), /Confirm in Instagram Settings/);
  await assert.rejects(publishing.confirmInstagramStoryBusiness(id, businessSettings({ businessAccountConfirmed: false })), /Confirm in Instagram Settings/);
  assert.equal(fs.existsSync(businessPath()), false);
  const response = await route.POST(request(id, { action: "confirm-story-business", ...businessSettings() }), context(id));
  assert.equal(response.status, 200); assert.equal((await response.json()).story.ready, true); assert.equal(scheduled.length, 0);
  const confirmation = JSON.parse(fs.readFileSync(businessPath(), "utf8"));
  assert.equal(confirmation.accountId, instagramAccount); assert.equal(confirmation.connectionRevision, "fixture-revision");
  assert.equal(confirmation.accountType, "BUSINESS"); assert.ok(!JSON.stringify(confirmation).includes("fixture-secret-token"));
  assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
  const status = await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish?check=story&connectionRevision=fixture-revision`), context(id));
  assert.equal((await status.json()).story.ready, true); assert.equal(scheduled.length, 0);
});

test("Business confirmation is account-bound across token renewal while current access and plausible proof remain required", async () => {
  const { id } = await confirmedStoryFixture();
  const original = fs.readFileSync(businessPath(), "utf8");
  fs.writeFileSync(businessPath(), JSON.stringify({ ...JSON.parse(original), connectionRevision: 'older-token-revision' }));
  const retained = fs.readFileSync(businessPath(), 'utf8');
  assert.equal((await publishing.checkInstagramStoryCapability(id, 'fixture-revision')).ready, true);
  assert.equal(fs.readFileSync(businessPath(), 'utf8'), retained, 'Reading capability never renews or fabricates Business proof');
  for (const changes of [{ connectionRevision: "" }, { accountId: "555555555555555" }, { accountType: "CREATOR" }, { confirmedAt: "not-a-date" }, { confirmedAt: new Date(Date.now() + 60_000).toISOString() }]) {
    fs.writeFileSync(businessPath(), JSON.stringify({ ...JSON.parse(original), ...changes }));
    const status = await publishing.checkInstagramStoryCapability(id, "fixture-revision");
    assert.equal(status.ready, false); assert.equal(status.requiresBusinessConfirmation, true);
  }
  fs.writeFileSync(businessPath(), original); instagramAccount = "555555555555555";
  assert.equal((await publishing.checkInstagramStoryCapability(id, "fixture-revision")).ready, false);
  instagramAccount = "123456789012345";
  assert.equal((await publishing.checkInstagramStoryCapability(id, "changed-revision")).ready, false);
  channelChanged = true;
  await assert.rejects(publishing.confirmInstagramStoryBusiness(id, businessSettings()), /connection changed/);
  channelChanged = false; instagramLogin = "instagram";
  await assert.rejects(publishing.confirmInstagramStoryBusiness(id, businessSettings()), /Facebook-linked/);
});

test("ordinary Story status polling is read-only and cannot load credentials or dispatch uploads", async () => {
  const { id } = await confirmedStoryFixture();
  const prepared = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  accessCalls = 0; assertionCalls = 0;
  const response = await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id));
  const { jobs } = await response.json(); assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, prepared.job.id); assert.equal(jobs[0].companionStory.kind, "story");
  assert.equal(jobs[0].companionStory.status, "QUEUED"); assert.equal(jobs[0].companionStory.canContinue, false);
  assert.match(jobs[0].companionStory.detail, /waiting for its Reel/);
  assert.equal(accessCalls, 0); assert.equal(assertionCalls, 0); assert.equal(scheduled.length, 0);
});

test("matching Story media limits fail before credentials or publication and do not silently shorten the Reel", async () => {
  const { id, file } = await fixture("instagram", 100);
  const originalOutput = { ...file.outputs.instagram };
  for (const changes of [{ duration: 2 }, { duration: 61 }, { duration: NaN }, { width: 1920, height: 1080 }, { width: 0 }, { width: 2048, height: 4096 }, { height: 0 }]) {
    file.outputs.instagram = { ...originalOutput, ...changes }; await files.saveReviewFile(file); accessCalls = 0;
    const capability = await publishing.checkInstagramStoryCapability(id, "fixture-revision");
    assert.equal(capability.ready, false); assert.match(capability.reason, /ready portrait MP4, 3–60 seconds and at most 100 MB/); assert.equal(accessCalls, 0);
    await assert.rejects(publishing.confirmInstagramStoryBusiness(id, businessSettings()), /ready portrait MP4/);
    assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
  }
  file.outputs.instagram = originalOutput; await files.saveReviewFile(file);
  fs.truncateSync(files.outputPath(id, "instagram"), 100_000_001);
  assert.equal((await publishing.checkInstagramStoryCapability(id, "fixture-revision")).ready, false);
  assert.equal((await files.getReviewFile(id)).outputs.instagram.duration, originalOutput.duration);
  fs.truncateSync(files.outputPath(id, "instagram"), 100);
  for (const duration of [3, 60]) {
    file.outputs.instagram.duration = duration; await files.saveReviewFile(file);
    assert.equal((await publishing.confirmInstagramStoryBusiness(id, businessSettings())).ready, true);
  }
});

test("only an explicitly approved Instagram Reel can own a Story, and failed parents block Story continuation", async () => {
  const { id } = await confirmedStoryFixture();
  await assert.rejects(publishing.prepareReviewPublication(id, settings("youtube", { companionStory: true })), /only available with an Instagram Reel/);
  await assert.rejects(publishing.prepareReviewPublication(id, settings("instagram", { companionStory: "yes" })), /explicitly/);
  const prepared = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  alterStored(id, parent => { parent.status = "FAILED"; parent.detail = "Fixture parent failed"; }, "instagram");
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.companionStory.status, "NEEDS_CHECK"); assert.equal(status.companionStory.canContinue, false);
  assert.match(status.companionStory.detail, /no Story has been sent/);
  const child = readStory(id); child.queuedAt = 0; fs.writeFileSync(storyPath(id), JSON.stringify(child));
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue-story", jobId: child.id, confirm: true }), /Reel must finish successfully/);
  assert.equal(readStored(id, "instagram").id, prepared.job.id);
});

test("confirmed Reel and matching Story stream the same saved MP4 once each, retain separate IDs and never republish on duplicate callbacks", async () => {
  const { id } = await confirmedStoryFixture(256 * 1024 + 3);
  const counters = installStoryProvider();
  const prepared = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  const child = readStory(id); const parent = readStored(id, "instagram");
  assert.notEqual(child.id, parent.id); assert.equal(child.parentReelId, parent.id);
  assert.deepEqual(child.fingerprint, parent.fingerprint); assert.equal(child.renderTarget, parent.renderTarget);
  await publishing.runReviewPublication(id, prepared.job.id);
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.status, "COMPLETE"); assert.equal(status.companionStory.status, "COMPLETE");
  assert.equal(status.remoteId, "456789012345678"); assert.equal(status.companionStory.remoteId, "456789012345679");
  assert.equal(status.companionStory.remoteUrl, undefined); assert.equal(status.companionStory.percent, 100);
  assert.deepEqual(counters.creations, ["REELS", "STORIES"]); assert.equal(counters.streams.length, 2);
  assert.ok(counters.streams.every(value => value.bytes === 256 * 1024 + 3)); assert.equal(counters.permalinkLookups, 1);
  assert.equal(sessions.has(child.id), false); assert.equal(sessions.has(parent.id), false);
  await publishing.runReviewPublication(id, prepared.job.id); await publishing.runReviewPublication(id, child.id);
  const duplicate = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.id, prepared.job.id);
  assert.equal(counters.publishes.length, 2); assert.equal(counters.streams.length, 2);
});

test("a rejected Story can be explicitly continued using only its own job without republishing the successful Reel", async () => {
  const { id } = await confirmedStoryFixture();
  const firstCounters = installStoryProvider({ failStoryCreation: true });
  const prepared = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  await publishing.runReviewPublication(id, prepared.job.id);
  const [failed] = await publishing.listReviewPublishJobs(id);
  assert.equal(failed.status, "COMPLETE"); assert.equal(failed.companionStory.status, "FAILED");
  assert.equal(failed.companionStory.canContinue, true); assert.match(failed.companionStory.detail, /denied upload permission/);
  assert.equal(firstCounters.streams.length, 1); assert.equal(firstCounters.publishes.length, 1);
  await publishing.runReviewPublication(id, prepared.job.id); assert.equal(firstCounters.creations.length, 2);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue", jobId: failed.companionStory.id, confirm: true }), /not found/);
  const secondCounters = installStoryProvider();
  const continued = await publishing.prepareReviewPublication(id, { action: "continue-story", jobId: failed.companionStory.id, confirm: true });
  assert.equal(continued.dispatch, true); assert.equal(continued.job.kind, "story");
  await publishing.runReviewPublication(id, continued.job.id);
  const [completed] = await publishing.listReviewPublishJobs(id);
  assert.equal(completed.status, "COMPLETE"); assert.equal(completed.remoteId, failed.remoteId);
  assert.equal(completed.companionStory.status, "COMPLETE");
  assert.deepEqual(secondCounters.creations, ["STORIES"]); assert.equal(secondCounters.streams.length, 1);
  assert.deepEqual(secondCounters.publishes, ["987654321012346"]); assert.equal(secondCounters.permalinkLookups, 0);
});

test("an ambiguous Story publish retains the successful Reel and refuses blind repeat or auto-retry", async () => {
  const { id } = await confirmedStoryFixture(); const counters = installStoryProvider({ ambiguousStoryPublish: true });
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.status, "COMPLETE"); assert.equal(status.companionStory.status, "NEEDS_CHECK");
  assert.equal(status.companionStory.canContinue, false); assert.match(status.companionStory.detail, /will not repeat/);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue-story", jobId: status.companionStory.id, confirm: true }), /will not repeat/);
  await publishing.runReviewPublication(id, job.id); await publishing.runReviewPublication(id, status.companionStory.id);
  assert.equal(counters.publishes.length, 2); assert.equal(counters.streams.length, 2);
});

test("an output change after the Reel publishes blocks its Story without replaying the Reel", async () => {
  const { id } = await confirmedStoryFixture();
  const counters = installStoryProvider({ afterReel: () => fs.appendFileSync(files.outputPath(id, "instagram"), Buffer.from([1])) });
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.status, "COMPLETE"); assert.equal(status.companionStory.status, "FAILED");
  assert.match(status.companionStory.detail, /changed after confirmation/);
  assert.deepEqual(counters.creations, ["REELS"]); assert.equal(counters.publishes.length, 1);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: "continue-story", jobId: status.companionStory.id, confirm: true }), /changed after confirmation/);
});

test("a channel disconnect after the Reel publishes prevents a matching Story from starting", async () => {
  const { id } = await confirmedStoryFixture();
  const counters = installStoryProvider({ afterReel: () => { channelChanged = true; } });
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  await publishing.runReviewPublication(id, job.id);
  const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.status, "COMPLETE"); assert.equal(status.companionStory.status, "FAILED");
  assert.match(status.companionStory.detail, /connection changed/); assert.deepEqual(counters.creations, ["REELS"]);
  assert.equal(counters.publishes.length, 1);
});

test("old completed Reels are never retroactively assigned or posted as Stories", async () => {
  const { id } = await confirmedStoryFixture(); const counters = installStoryProvider();
  const { job } = await publishing.prepareReviewPublication(id, settings("instagram"));
  await publishing.runReviewPublication(id, job.id);
  const duplicate = await publishing.prepareReviewPublication(id, settings("instagram", { companionStory: true }));
  await publishing.runReviewPublication(id, job.id);
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.companionStory, undefined);
  assert.equal(fs.existsSync(storyPath(id)), false); assert.deepEqual(counters.creations, ["REELS"]);
  assert.equal(counters.publishes.length, 1);
});

const storyOnlySettings = overrides => ({ action: 'create-story', confirm: true, connectionRevision: 'fixture-revision', ...overrides });
test('Story-only confirmation creates one independent durable job and publishes no Reel, caption or optional Reel settings', async () => {
  const { id } = await confirmedStoryFixture(); const counters = installStoryProvider();
  const response = await route.POST(request(id, storyOnlySettings()), context(id)); assert.equal(response.status, 202);
  const { job } = await response.json(); assert.equal(job.kind, 'story'); assert.equal(job.standaloneStory, true); assert.equal(scheduled.length, 1);
  assert.equal(fs.existsSync(storedPath(id, 'instagram')), false); assert.equal(readStory(id).parentReelId, undefined);
  for (const key of ['location', 'audio', 'userTags', 'companionStoryApproved']) assert.equal(readStory(id)[key], undefined);
  assert.equal(counters.creations.length, 0, 'Preparation never submits a provider request');
  const before = { accessCalls, sessionReads }; const status = await publishing.listReviewPublishJobs(id);
  assert.equal(status.length, 1); assert.equal(status[0].standaloneStory, true); assert.deepEqual({ accessCalls, sessionReads }, before);
  const duplicate = await publishing.prepareReviewPublication(id, storyOnlySettings()); assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.id, job.id);
  await publishing.runReviewPublication(id, job.id); await publishing.runReviewPublication(id, job.id);
  assert.deepEqual(counters.creations, ['STORIES']); assert.equal(counters.streams.length, 1); assert.equal(counters.publishes.length, 1); assert.equal(counters.permalinkLookups, 0);
  const completed = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(completed.status, 'COMPLETE'); assert.equal(completed.remoteUrl, undefined);
});

test('Story-only creation requires explicit approval, current Business access, eligible media and a strict Story-only request', async () => {
  const { id, file } = await fixture('instagram', 100); const before = accessCalls;
  for (const changes of [{ confirm: false }, { caption: 'Reel caption' }, { userTags: [] }, { location: { id: '123' } }, { audio: audioConfig() }, { privacy: 'public' }, { companionStory: true }, { platform: 'instagram' }]) {
    assert.equal((await route.POST(request(id, storyOnlySettings(changes)), context(id))).status, 400);
  }
  assert.equal(accessCalls, before); assert.equal(fs.existsSync(storyPath(id)), false); assert.equal(scheduled.length, 0);
  await assert.rejects(publishing.prepareReviewPublication(id, storyOnlySettings()), /Business, not Creator/);
  await publishing.confirmInstagramStoryBusiness(id, businessSettings());
  file.outputs.instagram.duration = 61; await files.saveReviewFile(file);
  await assert.rejects(publishing.prepareReviewPublication(id, storyOnlySettings()), /ready portrait MP4/);
  assert.equal(fs.existsSync(storyPath(id)), false); assert.equal(scheduled.length, 0);
});

test('a separately approved Story is independent of a failed Reel and an existing Story cannot become a second matching companion', async () => {
  const { id, job: reel } = await rejectedReelFixture();
  await publishing.confirmInstagramStoryBusiness(id, businessSettings()); const original = readStored(id, 'instagram');
  const counters = installStoryProvider(); const { job } = await publishing.prepareReviewPublication(id, storyOnlySettings());
  await publishing.runReviewPublication(id, job.id); assert.deepEqual(readStored(id, 'instagram'), original);
  const jobs = await publishing.listReviewPublishJobs(id); assert.equal(jobs.length, 2); assert.equal(jobs.find(job => job.id === reel.id).status, 'FAILED');
  assert.deepEqual(counters.creations, ['STORIES']); assert.equal(counters.publishes.length, 1);
  const duplicate = await publishing.prepareReviewPublication(id, settings('instagram', { companionStory: true })); assert.equal(duplicate.dispatch, false);
  assert.equal(counters.publishes.length, 1);
});

test('Story-only rejection can continue its own job but ambiguous publication and changed video cannot repeat it', async () => {
  const { id } = await confirmedStoryFixture(); const first = installStoryProvider({ failStoryCreation: true });
  const { job } = await publishing.prepareReviewPublication(id, storyOnlySettings()); await publishing.runReviewPublication(id, job.id);
  assert.equal((await publishing.listReviewPublishJobs(id))[0].status, 'FAILED'); assert.equal(first.publishes.length, 0);
  const next = installStoryProvider({ ambiguousStoryPublish: true });
  const continued = await publishing.prepareReviewPublication(id, { action: 'continue-story', jobId: job.id, confirm: true }); assert.equal(continued.dispatch, true);
  await publishing.runReviewPublication(id, job.id); const ambiguous = (await publishing.listReviewPublishJobs(id))[0];
  assert.equal(ambiguous.status, 'NEEDS_CHECK'); assert.equal(ambiguous.canContinue, false);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue-story', jobId: job.id, confirm: true }), /will not repeat/);
  await publishing.runReviewPublication(id, job.id); assert.equal(next.publishes.length, 1);
  const changed = await confirmedStoryFixture(); const prepared = await publishing.prepareReviewPublication(changed.id, storyOnlySettings());
  const changedStory = readStory(changed.id); changedStory.queuedAt = 0; changedStory.status = 'FAILED'; fs.writeFileSync(storyPath(changed.id), JSON.stringify(changedStory));
  fs.appendFileSync(files.outputPath(changed.id, 'instagram'), 'changed');
  await assert.rejects(publishing.prepareReviewPublication(changed.id, { action: 'continue-story', jobId: prepared.job.id, confirm: true }), /video changed/);
});

test('explicit Story-only conversion archives the untouched child, preserves the failed Reel and never replays that Story during later Reel correction', async () => {
  const { id, job: reel } = await rejectedReelFixture({ story: true });
  const child = readStory(id); child.queuedAt = 0; fs.writeFileSync(storyPath(id), JSON.stringify(child));
  const parent = readStored(id, 'instagram'); const [status] = await publishing.listReviewPublishJobs(id);
  assert.equal(status.companionStory.canMakeStandalone, true);
  const approved = await publishing.prepareReviewPublication(id, storyOnlySettings({ jobId: child.id }));
  assert.equal(approved.dispatch, true); assert.equal(approved.job.id, child.id); assert.equal(approved.job.standaloneStory, true);
  assert.equal(readStory(id).parentReelId, undefined); assert.equal(readStory(id).detachedFromReelId, reel.id); assert.deepEqual(readStored(id, 'instagram'), parent);
  const historyDirectory = path.join(process.env.PHOENIX_PUBLISH_STORAGE, 'history');
  const history = fs.readdirSync(historyDirectory).filter(name => name.startsWith(`${id}-instagram-story-`)).map(name => JSON.parse(fs.readFileSync(path.join(historyDirectory, name), 'utf8')));
  assert.deepEqual(history, [child]); const parentPublic = (await publishing.listReviewPublishJobs(id)).find(job => job.id === reel.id);
  assert.equal(parentPublic.companionStoryApproved, undefined); assert.equal(parentPublic.companionStoryDetached, true);
  const counters = installStoryProvider(); await publishing.runReviewPublication(id, child.id);
  const revised = await publishing.prepareReviewPublication(id, correction(reel, { caption: 'Fixture caption' })); assert.equal(revised.dispatch, true);
  assert.equal(readStored(id, 'instagram').companionStoryApproved, undefined);
  await publishing.runReviewPublication(id, reel.id); await publishing.runReviewPublication(id, child.id);
  assert.deepEqual(counters.creations, ['STORIES', 'REELS']); assert.equal(counters.publishes.length, 2);
});

test('Story-only conversion refuses accepted, ambiguous, fresh, session-backed, changed or unrelated saved requests', async () => {
  for (const changed of ['child-container', 'parent-container', 'ambiguous-parent', 'fresh-child', 'session', 'video', 'account', 'operation']) {
    const { id } = await rejectedReelFixture({ story: true }); const child = readStory(id); child.queuedAt = 0;
    if (changed === 'child-container') child.containerId = '12345';
    if (changed === 'fresh-child') child.queuedAt = Date.now();
    fs.writeFileSync(storyPath(id), JSON.stringify(child));
    if (changed === 'parent-container') alterStored(id, parent => { parent.containerId = '12345'; }, 'instagram');
    if (changed === 'ambiguous-parent') alterStored(id, parent => { parent.status = 'NEEDS_CHECK'; parent.phase = 'session_unknown'; }, 'instagram');
    if (changed === 'session') sessions.set(child.id, instagramLocation);
    if (changed === 'video') fs.appendFileSync(files.outputPath(id, 'instagram'), 'changed');
    if (changed === 'account') instagramAccount = '987654321';
    const lock = `${storyPath(id)}.operation.lock`; if (changed === 'operation') fs.writeFileSync(lock, 'fixture-live-story');
    const saved = readStory(id);
    try {
      await assert.rejects(publishing.prepareReviewPublication(id, storyOnlySettings({ jobId: child.id })), /untouched matching Story|provider session|video changed|destination connection changed/);
      assert.deepEqual(readStory(id), saved); assert.equal(scheduled.length, 0);
    } finally { sessions.delete(child.id); instagramAccount = '123456789012345'; if (fs.existsSync(lock)) fs.unlinkSync(lock); }
  }
});

const locationPage = (id = '987654321', name = 'Lake Lucerne', changes = {}) => ({ id, name, location: { latitude: 47.05, longitude: 8.31 }, ...changes });
const locationRequest = (id, q, revision = 'fixture-revision') => new Request(`http://localhost:3000/api/review-files/${id}/publish?check=location&q=${encodeURIComponent(q)}&connectionRevision=${encodeURIComponent(revision)}`);

test('eligible location metadata requires a numeric Meta Page, bounded name and genuine finite coordinates; country strings are not locations', () => {
  const helper = require(path.join(project, 'src/lib/instagramLocations.ts'));
  assert.deepEqual(helper.eligibleInstagramLocation(locationPage()), { id: '987654321', name: 'Lake Lucerne' });
  assert.deepEqual(helper.eligibleInstagramLocation(locationPage('1', 'Zero point', { location: { latitude: 0, longitude: 0 } })), { id: '1', name: 'Zero point' });
  for (const value of [null, 'Switzerland', { id: '1', name: 'Switzerland' }, locationPage('page-name'), locationPage('1', ''),
    locationPage('1', 'x'.repeat(201)), locationPage('1', 'secret\nname'), locationPage('1', 'Name', { location: { latitude: null, longitude: 8 } }),
    locationPage('1', 'Name', { location: { latitude: '47', longitude: 8 } }), locationPage('1', 'Name', { location: { latitude: 91, longitude: 8 } }),
    locationPage('1', 'Name', { location: { latitude: 47, longitude: Infinity } })]) assert.equal(helper.eligibleInstagramLocation(value), null);
});

test('optional location name search reports missing App Secret without provider calls, posting or ordinary-status credential reads', async () => {
  const { id } = await fixture('instagram', 100);
  const response = await route.GET(locationRequest(id, 'Switzerland'), context(id));
  assert.equal(response.status, 200); const result = await response.json();
  assert.deepEqual(result.locations, []); assert.match(result.reason, /App Secret.*Pages Search.*known Facebook location Page ID/);
  assert.equal(scheduled.length, 0); assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
  const accesses = accessCalls, proofs = proofCalls;
  await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id));
  assert.equal(accessCalls, accesses); assert.equal(proofCalls, proofs);
  assert.ok(!JSON.stringify(result).includes('fixture-secret-token'));
});

test('a known numeric location Page ID is checked directly without App Secret or an automatic Pages Search fallback', async () => {
  const { id } = await fixture('instagram', 100); let calls = 0;
  global.fetch = async (target, options) => {
    calls++; const url = new URL(target);
    assert.equal(url.origin, 'https://graph.facebook.com'); assert.equal(url.pathname, '/v21.0/987654321');
    assert.equal(url.searchParams.get('fields'), 'id,name,location'); assert.equal(url.searchParams.has('appsecret_proof'), false);
    assert.equal(url.searchParams.has('access_token'), false); assert.equal(options.headers.Authorization, 'Bearer fixture-secret-token');
    return Response.json(locationPage());
  };
  const result = await (await route.GET(locationRequest(id, '987654321'), context(id))).json();
  assert.deepEqual(result, { locations: [{ id: '987654321', name: 'Lake Lucerne' }] });
  assert.equal(calls, 1); assert.equal(scheduled.length, 0); assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});

test('explicit name search uses bounded Pages Search, server proof and deduplicated eligible results; it never follows provider pagination', async () => {
  const { id } = await fixture('instagram', 100); appSecretProof = 'f'.repeat(64); let calls = 0;
  global.fetch = async (target, options) => {
    calls++; const url = new URL(target);
    assert.equal(url.pathname, '/v21.0/pages/search'); assert.equal(url.searchParams.get('q'), 'Lake Lucerne');
    assert.equal(url.searchParams.get('fields'), 'id,name,location'); assert.equal(url.searchParams.get('limit'), '8');
    assert.equal(url.searchParams.get('appsecret_proof'), appSecretProof); assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.headers.Authorization, 'Bearer fixture-secret-token'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return Response.json({ data: [locationPage(), locationPage(), locationPage('2', 'Missing coordinates', { location: {} }),
      locationPage('3', 'Another eligible place'), ...Array.from({ length: 10 }, (_, at) => locationPage(String(at + 4), `Place ${at}`))],
      paging: { next: 'https://untrusted.test/fixture-secret-token' } });
  };
  const result = await (await route.GET(locationRequest(id, 'Lake Lucerne'), context(id))).json();
  assert.equal(result.locations.length, 6); assert.equal(calls, 1); assert.equal(scheduled.length, 0);
  assert.equal(result.locations[0].id, '987654321'); assert.ok(!JSON.stringify(result).includes(appSecretProof));
  assert.ok(!JSON.stringify(result).includes('latitude')); assert.ok(!JSON.stringify(result).includes('fixture-secret-token'));
});

test('Meta location access failures and unknown coordinates remain actionable and cannot fabricate places or queue uploads', async () => {
  const { id } = await fixture('instagram', 100); appSecretProof = 'f'.repeat(64);
  for (const data of [{ error: { code: 200, message: 'Private fixture-secret-token' } }, locationPage('987654321', 'Page without a place', { location: {} })]) {
    global.fetch = async () => Response.json(data, data.error ? { status: 400 } : {});
    const result = await (await route.GET(locationRequest(id, data.error ? 'Switzerland' : '987654321'), context(id))).json();
    assert.deepEqual(result.locations, []); assert.match(result.reason, /App Review|latitude and longitude/);
    assert.ok(!result.reason.includes('fixture-secret-token')); assert.equal(scheduled.length, 0);
  }
  assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});

test('malformed and non-Instagram locations are rejected before credentials, provider access or dispatch', async () => {
  const { id } = await fixture('instagram', 100);
  for (const location of ['Switzerland', null, [], { id: 'https://facebook.com/place' }, { id: '1/me' }, { id: '123\n' }, { id: 123 }, { id: '1', name: 'Invented country' }, { id: '1'.repeat(41) }]) {
    const response = await route.POST(request(id, settings('instagram', { location })), context(id)); assert.equal(response.status, 400);
  }
  assert.equal((await route.POST(request(id, settings('youtube', { location: { id: '987654321' } })), context(id))).status, 400);
  assert.equal(accessCalls, 0); assert.equal(proofCalls, 0); assert.equal(scheduled.length, 0);
});

test('confirmed location is verified before persistence, remains immutable on duplicate create and is excluded from Story records', async () => {
  const { id } = await confirmedStoryFixture(); let lookups = 0;
  global.fetch = async target => { assert.equal(new URL(target).searchParams.get('fields'), 'id,name,location'); lookups++; return Response.json(locationPage()); };
  const saved = await publishing.prepareReviewPublication(id, settings('instagram', { location: { id: '987654321' }, companionStory: true }));
  assert.deepEqual(saved.job.location, { id: '987654321', name: 'Lake Lucerne' });
  assert.deepEqual(readStored(id, 'instagram').location, saved.job.location); assert.equal(readStory(id).location, undefined); assert.equal(saved.job.companionStory.location, undefined);
  const duplicate = await publishing.prepareReviewPublication(id, settings('instagram', { location: { id: '123' }, companionStory: true }));
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.id, saved.job.id); assert.deepEqual(duplicate.job.location, saved.job.location); assert.equal(lookups, 1);
  const before = accessCalls; await publishing.listReviewPublishJobs(id); assert.equal(accessCalls, before);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue', confirm: true, jobId: saved.job.id, location: { id: '123' } }), /immutable/);
});

test('location is reverified before container creation and sent only as location_id on the Reel, never its matching Story', async () => {
  const { id } = await confirmedStoryFixture(); let lookups = 0;
  global.fetch = async () => { lookups++; return Response.json(locationPage()); };
  const prepared = await publishing.prepareReviewPublication(id, settings('instagram', { companionStory: true, location: { id: '987654321' } }));
  const counts = installStoryProvider(), originalProvider = global.fetch;
  global.fetch = async (target, options) => {
    const url = new URL(target);
    if (url.searchParams.get('fields') === 'id,name,location') { lookups++; return Response.json(locationPage()); }
    if (url.pathname.endsWith('/media')) {
      const body = new URLSearchParams(options.body);
      if (body.get('media_type') === 'REELS') assert.equal(body.get('location_id'), '987654321'); else assert.equal(body.has('location_id'), false);
    }
    return originalProvider(target, options);
  };
  await publishing.runReviewPublication(id, prepared.job.id);
  assert.equal(lookups, 2); assert.deepEqual(counts.creations, ['REELS', 'STORIES']);
  const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.status, 'COMPLETE'); assert.equal(status.companionStory.status, 'COMPLETE');
  assert.deepEqual(status.location, prepared.job.location); assert.equal(status.companionStory.location, undefined);
  await publishing.runReviewPublication(id, prepared.job.id); assert.equal(lookups, 2); assert.equal(counts.publishes.length, 2);
});

test('changed, ineligible or disconnected locations abort before any container and never silently drop the approved place', async () => {
  for (const changed of ['renamed', 'missing-coordinates', 'disconnected']) {
    const { id } = await fixture('instagram', 100);
    global.fetch = async () => Response.json(locationPage());
    const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { location: { id: '987654321' } }));
    let containers = 0;
    global.fetch = async target => {
      if (new URL(target).pathname.endsWith('/media')) { containers++; assert.fail('Unverified location cannot create a container'); }
      if (changed === 'renamed') return Response.json(locationPage('987654321', 'Different place'));
      return Response.json(locationPage('987654321', 'Lake Lucerne', { location: {} }));
    };
    channelChanged = changed === 'disconnected'; await publishing.runReviewPublication(id, job.id); channelChanged = false;
    const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.status, 'FAILED'); assert.equal(containers, 0);
    assert.deepEqual(status.location, { id: '987654321', name: 'Lake Lucerne' }); assert.equal(readStored(id, 'instagram').phase, 'created');
    assert.match(status.detail, /location changed|latitude and longitude|connection changed/);
  }
});

test('ordinary Instagram posts without a chosen location retain zero location lookups and unsupported direct Instagram connections cannot search', async () => {
  const { id } = await fixture('instagram', 100); const counts = installStoryProvider();
  const { job } = await publishing.prepareReviewPublication(id, settings('instagram'));
  await publishing.runReviewPublication(id, job.id); assert.equal(proofCalls, 0); assert.deepEqual(counts.creations, ['REELS']);
  instagramLogin = 'instagram';
  await assert.rejects(publishing.searchInstagramLocations(id, 'Switzerland', 'fixture-revision'), /Facebook-linked/);
  instagramLogin = 'facebook';
  await assert.rejects(publishing.searchInstagramLocations(id, 'Switzerland', 'changed-revision'), /disconnected, changed/);
});

const audioTrack = (overrides = {}) => ({ audio_id: '587784541076604', title: 'Fixture music', display_artist: 'Fixture artist', audio_type: 'music', ...overrides });
const audioConfig = (overrides = {}) => ({ audio_id: '587784541076604', audio_volume: 100, video_volume: 1, ...overrides });
const audioRequest = (id, q = '') => new Request(`http://localhost:3000/api/review-files/${id}/publish?check=audio&q=${encodeURIComponent(q)}&connectionRevision=fixture-revision`);
test('explicit Instagram music search is bounded, header-authenticated, sanitized and never follows pagination or dispatches uploads', async () => {
  const { id } = await fixture('instagram', 100); let calls = 0;
  global.fetch = async (target, options) => {
    calls++; const url = new URL(target);
    assert.equal(url.pathname, '/v22.0/ig_audio'); assert.equal(url.searchParams.get('audio_type'), 'music');
    assert.equal(url.searchParams.get('user_id'), instagramAccount); assert.equal(url.searchParams.get('search_query'), 'calm');
    assert.equal(url.searchParams.has('access_token'), false); assert.equal(options.headers.Authorization, 'Bearer fixture-secret-token');
    return Response.json({ audio: [audioTrack({ download_url: 'https://private.test/fixture-secret-token', on_platform_audio_preview_link: 'https://www.instagram.com/reels/audio/587784541076604/?tracking=x' }),
      ...Array.from({ length: 10 }, (_, n) => audioTrack({ audio_id: String(n + 1) }))], paging: { next: 'https://private.test/fixture-secret-token' } });
  };
  const response = await route.GET(audioRequest(id, 'calm'), context(id)), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.audio.length, 6); assert.equal(calls, 1); assert.equal(scheduled.length, 0);
  assert.equal(result.audio[0].preview_url, 'https://www.instagram.com/reels/audio/587784541076604/');
  assert.ok(!JSON.stringify(result).includes('fixture-secret-token')); assert.ok(!JSON.stringify(result).includes('download_url'));
  const before = accessCalls; await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id));
  assert.equal(accessCalls, before); assert.equal(calls, 1);
});
test('blank audio query requests trending only after explicit action; provider errors and direct Instagram connections cannot fabricate results', async () => {
  const { id } = await fixture('instagram', 100);
  global.fetch = async target => { assert.equal(new URL(target).searchParams.has('search_query'), false); return Response.json({ audio: [audioTrack(), audioTrack()] }); };
  assert.equal((await publishing.searchInstagramAudio(id, '', 'fixture-revision')).audio.length, 1);
  global.fetch = async () => Response.json({ error: { code: 200, message: 'private fixture-secret-token' } });
  const refused = await publishing.searchInstagramAudio(id, '', 'fixture-revision'); assert.deepEqual(refused.audio, []); assert.match(refused.reason, /Meta could not/);
  assert.ok(!JSON.stringify(refused).includes('fixture-secret-token'));
  instagramLogin = 'instagram'; await assert.rejects(publishing.searchInstagramAudio(id, 'song', 'fixture-revision'), /Facebook-linked/);
  instagramLogin = 'facebook'; await assert.rejects(publishing.searchInstagramAudio(id, 'song', 'changed-revision'), /disconnected, changed/);
  assert.equal(scheduled.length, 0);
});
test('malformed or YouTube audio choices fail before credentials or provider calls', async () => {
  const { id } = await fixture('instagram', 100);
  for (const value of [null, {}, audioConfig({ audio_volume: 0 }), audioConfig({ video_volume: 101 }), audioConfig({ video_volume: 1.5 }), audioConfig({ audio_id: 'not-an-id' }), audioConfig({ extra: true })]) {
    await assert.rejects(publishing.prepareReviewPublication(id, settings('instagram', { audio: value })), /audio ID.*1 to 100/);
  }
  await assert.rejects(publishing.prepareReviewPublication(id, settings('youtube', { audio: audioConfig() })), /only accompany an Instagram Reel/);
  assert.equal(accessCalls, 0); assert.equal(scheduled.length, 0);
});
test('confirmed audio is reverified, immutable and pinned to v22 on the Reel while its matching Story retains existing audio and v21', async () => {
  const { id } = await confirmedStoryFixture(); let lookups = 0;
  global.fetch = async target => { assert.equal(new URL(target).pathname, '/v22.0/587784541076604'); lookups++; return Response.json(audioTrack()); };
  const prepared = await publishing.prepareReviewPublication(id, settings('instagram', { audio: audioConfig(), companionStory: true }));
  assert.deepEqual(prepared.job.audio, { ...audioConfig(), title: 'Fixture music', display_artist: 'Fixture artist' });
  assert.equal(readStored(id, 'instagram').instagramGraphVersion, 'v22.0'); assert.equal(readStory(id).audio, undefined); assert.equal(readStory(id).instagramGraphVersion, undefined);
  const duplicate = await publishing.prepareReviewPublication(id, settings('instagram', { audio: audioConfig({ audio_id: '12345' }) }));
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.id, prepared.job.id); assert.deepEqual(duplicate.job.audio, prepared.job.audio); assert.equal(lookups, 1);
  await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue', confirm: true, jobId: prepared.job.id, audio: audioConfig() }), /immutable/);
  const counts = installStoryProvider(), originalProvider = global.fetch;
  global.fetch = async (target, options) => {
    const url = new URL(target);
    if (url.pathname === '/v22.0/587784541076604') { lookups++; return Response.json(audioTrack()); }
    if (url.pathname.endsWith('/media')) {
      const body = new URLSearchParams(options.body), story = body.get('media_type') === 'STORIES';
      assert.equal(url.pathname.startsWith(story ? '/v21.0/' : '/v22.0/'), true);
      if (story) assert.equal(body.has('audio_configuration'), false); else assert.deepEqual(JSON.parse(body.get('audio_configuration')), audioConfig());
    }
    if (url.searchParams.get('fields') === 'status_code' || url.pathname.endsWith('/media_publish')) {
      const isStory = url.pathname.includes('987654321012346') || new URLSearchParams(options?.body).get('creation_id') === '987654321012346';
      assert.equal(url.pathname.startsWith(isStory ? '/v21.0/' : '/v22.0/'), true);
    }
    return originalProvider(target, options);
  };
  await publishing.runReviewPublication(id, prepared.job.id);
  const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.status, 'COMPLETE'); assert.equal(status.companionStory.status, 'COMPLETE');
  assert.deepEqual(status.audio, prepared.job.audio); assert.equal(status.companionStory.audio, undefined); assert.equal(lookups, 2);
  await publishing.runReviewPublication(id, prepared.job.id); assert.equal(lookups, 2); assert.equal(counts.creations.length, 2);
});
test('unavailable or changed approved audio stops before container creation and cannot be silently removed', async () => {
  for (const change of ['missing', 'renamed', 'disconnected']) {
    const { id } = await fixture('instagram', 100); global.fetch = async () => Response.json(audioTrack());
    const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { audio: audioConfig() }));
    let containers = 0;
    global.fetch = async target => {
      if (new URL(target).pathname.endsWith('/media')) { containers++; assert.fail('Unverified audio cannot create a container'); }
      return Response.json(change === 'missing' ? {} : audioTrack({ title: 'Changed track' }));
    };
    channelChanged = change === 'disconnected'; await publishing.runReviewPublication(id, job.id); channelChanged = false;
    const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.status, 'FAILED'); assert.equal(containers, 0);
    assert.deepEqual(status.audio, job.audio); assert.equal(readStored(id, 'instagram').phase, 'created'); assert.match(status.detail, /audio.*unavailable|audio changed|connection changed/);
  }
});

test('malformed or non-Instagram people tags fail before credentials, provider calls or dispatch', async () => {
  const { id } = await fixture('instagram', 100);
  for (const userTags of [null, {}, '@nasa', [{ username: 'nasa' }], [{ id: '12345' }], [12345], ['https://instagram.com/nasa/'],
    ['nasa\n'], ['na..sa'], ['.nasa'], ['nasa.'], ['a'.repeat(31)], Array.from({ length: 21 }, (_, index) => `account_${index}`)]) {
    const response = await route.POST(request(id, settings('instagram', { userTags })), context(id));
    assert.equal(response.status, 400);
  }
  assert.equal((await route.POST(request(id, settings('youtube', { userTags: ['nasa'] })), context(id))).status, 400);
  assert.equal(accessCalls, 0); assert.equal(proofCalls, 0); assert.equal(scheduled.length, 0);
  assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});

test('confirmed people tags are canonical, immutable on duplicate create and continue, copied publicly and excluded from Stories', async () => {
  const { id } = await confirmedStoryFixture();
  const requested = ['@NASA', 'nasa', 'Second.Account'];
  const prepared = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: requested, companionStory: true }));
  assert.deepEqual(prepared.job.userTags, ['nasa', 'second.account']);
  assert.deepEqual(readStored(id, 'instagram').userTags, ['nasa', 'second.account']);
  assert.equal(readStory(id).userTags, undefined); assert.equal(prepared.job.companionStory.userTags, undefined);
  requested.push('later_input'); prepared.job.userTags.push('later_public_edit');
  const before = accessCalls;
  const duplicate = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['other_account'] }));
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.job.id, prepared.job.id);
  assert.deepEqual(duplicate.job.userTags, ['nasa', 'second.account']); assert.equal(accessCalls, before);
  assert.deepEqual((await publishing.listReviewPublishJobs(id))[0].userTags, ['nasa', 'second.account']); assert.equal(accessCalls, before);
  for (const action of ['continue', 'continue-story']) {
    const jobId = action === 'continue-story' ? prepared.job.companionStory.id : prepared.job.id;
    await assert.rejects(publishing.prepareReviewPublication(id, { action, confirm: true, jobId, userTags: ['nasa'] }), /immutable/);
  }
  assert.equal(accessCalls, before);
});

test('Reel container creation sends only the explicit approved username objects and matching Stories omit people tags', async () => {
  const { id } = await confirmedStoryFixture();
  const prepared = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['@NASA', 'Second.Account'], companionStory: true }));
  const counts = installStoryProvider(), provider = global.fetch;
  let taggedContainers = 0;
  global.fetch = async (target, options) => {
    if (new URL(target).pathname.endsWith('/media')) {
      const body = new URLSearchParams(options.body);
      if (body.get('media_type') === 'REELS') {
        taggedContainers++;
        assert.deepEqual(JSON.parse(body.get('user_tags')), [{ username: 'nasa' }, { username: 'second.account' }]);
        assert.equal(body.has('usertags'), false); assert.equal(body.get('caption'), 'Fixture caption');
      } else assert.equal(body.has('user_tags'), false);
    }
    return provider(target, options);
  };
  await publishing.runReviewPublication(id, prepared.job.id);
  const status = (await publishing.listReviewPublishJobs(id))[0];
  assert.equal(status.status, 'COMPLETE'); assert.equal(status.companionStory.status, 'COMPLETE');
  assert.deepEqual(status.userTags, ['nasa', 'second.account']); assert.equal(status.companionStory.userTags, undefined);
  assert.equal(taggedContainers, 1); assert.deepEqual(counts.creations, ['REELS', 'STORIES']);
  await publishing.runReviewPublication(id, prepared.job.id);
  await publishing.runReviewPublication(id, status.companionStory.id);
  assert.equal(taggedContainers, 1); assert.equal(counts.publishes.length, 2); assert.equal(proofCalls, 0);
});

test('caption mentions alone never create people tags and ordinary status remains local and read-only', async () => {
  const { id } = await fixture('instagram', 100);
  const prepared = await publishing.prepareReviewPublication(id, settings('instagram', { caption: 'A caption mentions @nasa', userTags: [] }));
  assert.equal(prepared.job.userTags, undefined); assert.equal(readStored(id, 'instagram').userTags, undefined);
  let calls = 0;
  global.fetch = async (target, options) => {
    calls++;
    const parsed = new URL(target);
    if (parsed.pathname.endsWith('/media')) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.has('user_tags'), false); assert.equal(body.get('caption'), 'A caption mentions @nasa');
      return Response.json({ id: '987654321012345', uri: instagramLocation });
    }
    if (parsed.hostname === 'rupload.facebook.com') { await consumeStream(options); return Response.json({ success: true }); }
    if (parsed.searchParams.get('fields') === 'status_code') return Response.json({ status_code: 'FINISHED' });
    if (parsed.pathname.endsWith('/media_publish')) return Response.json({ id: '456789012345678' });
    assert.equal(parsed.searchParams.get('fields'), 'permalink'); return Response.json({});
  };
  await publishing.runReviewPublication(id, prepared.job.id);
  const before = { calls, accessCalls, proofCalls };
  assert.equal((await publishing.listReviewPublishJobs(id))[0].status, 'COMPLETE');
  await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id));
  assert.deepEqual({ calls, accessCalls, proofCalls }, before); assert.equal(calls, 5);
});

test('provider-rejected tags retain the approved list and explicit continuation never silently drops it', async () => {
  const { id } = await fixture('instagram', 100);
  const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['public_account'] }));
  let creations = 0;
  global.fetch = async (target, options) => {
    creations++; assert.ok(new URL(target).pathname.endsWith('/media'));
    assert.deepEqual(JSON.parse(new URLSearchParams(options.body).get('user_tags')), [{ username: 'public_account' }]);
    return Response.json({ error: { code: 100, message: 'Private provider explanation fixture-secret-token' } }, { status: 400 });
  };
  await publishing.runReviewPublication(id, job.id);
  const status = (await publishing.listReviewPublishJobs(id))[0];
  assert.equal(status.status, 'FAILED'); assert.equal(status.canContinue, true);
  assert.deepEqual(status.userTags, ['public_account']); assert.equal(readStored(id, 'instagram').phase, 'created');
  assert.ok(!status.detail.includes('fixture-secret-token')); assert.equal(creations, 1);
  assert.match(status.detail, /Platform code 100/);
  assert.match(status.detail, /Container creation stopped before the video transfer; no video bytes were sent/);
  assert.match(status.detail, /Continue uses the same approved choices/);
  assert.equal((await publishing.prepareReviewPublication(id, { action: 'continue', confirm: true, jobId: job.id })).dispatch, true);
  await publishing.runReviewPublication(id, job.id);
  assert.equal(creations, 2); assert.deepEqual(readStored(id, 'instagram').userTags, ['public_account']);
});

test('Meta tag rejections retain safe numeric diagnostics, never unchecked provider text or silently dropped choices', async () => {
  const { id } = await fixture('instagram', 100);
  const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['public_account'] }));
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return Response.json({ error: { code: 100, error_subcode: 2207026,
      message: 'Invalid user_tags fixture-secret-token https://private.example/?access_token=private',
      error_user_msg: 'Private account explanation never echoed' } }, { status: 400 });
  };
  await publishing.runReviewPublication(id, job.id);
  const status = (await publishing.listReviewPublishJobs(id))[0];
  assert.equal(calls, 1); assert.equal(status.status, 'FAILED'); assert.equal(status.bytesUploaded, 0);
  assert.match(status.detail, /rejected the requested people tags/);
  assert.match(status.detail, /Platform code 100, subcode 2207026/);
  assert.ok(!status.detail.includes('fixture-secret-token')); assert.ok(!status.detail.includes('private.example'));
  assert.ok(!status.detail.includes('Private account')); assert.deepEqual(status.userTags, ['public_account']);
});

test('untrusted or malformed Meta diagnostics never enter saved upload errors', async () => {
  for (const diagnostic of [
    { code: 'fixture-secret-token', error_subcode: 'secret-subcode', message: 'user_tags private explanation' },
    { code: -1, error_subcode: Infinity, message: 'Private explanation' },
    { code: 100, error_subcode: 'private-subcode', error_user_title: { secret: 'private' }, message: 'Private explanation' },
  ]) {
    const { id } = await fixture('instagram', 100);
    const { job } = await publishing.prepareReviewPublication(id, settings('instagram'));
    global.fetch = async () => Response.json({ error: diagnostic }, { status: 400 });
    await publishing.runReviewPublication(id, job.id);
    const status = (await publishing.listReviewPublishJobs(id))[0];
    assert.equal(status.status, 'FAILED'); assert.ok(!/secret|Private|subcode|Platform code -1/.test(status.detail));
    assert.ok(!status.detail.includes('requested people tags'));
  }
});

test('ambiguous tagged container creation cannot be repeated by continue, duplicate create or duplicate callbacks', async () => {
  const { id } = await fixture('instagram', 100);
  const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['public_account'] }));
  let creations = 0;
  global.fetch = async (target, options) => {
    creations++; assert.ok(new URL(target).pathname.endsWith('/media'));
    assert.deepEqual(JSON.parse(new URLSearchParams(options.body).get('user_tags')), [{ username: 'public_account' }]);
    throw new Error('Container accepted but response lost fixture-secret-token');
  };
  await publishing.runReviewPublication(id, job.id);
  const status = (await publishing.listReviewPublishJobs(id))[0];
  assert.equal(status.status, 'NEEDS_CHECK'); assert.equal(status.canContinue, false);
  assert.deepEqual(status.userTags, ['public_account']); assert.equal(readStored(id, 'instagram').phase, 'session_unknown');
  await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue', confirm: true, jobId: job.id }), /will not repeat/);
  const duplicate = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['other_account'] }));
  assert.equal(duplicate.dispatch, false); assert.deepEqual(duplicate.job.userTags, ['public_account']);
  await publishing.runReviewPublication(id, job.id); assert.equal(creations, 1);
});

test('noncanonical stored people tags and tags injected into a YouTube or Story job fail before provider or credential access', async () => {
  for (const userTags of [null, {}, ['@nasa'], ['NASA'], ['nasa', 'nasa'], [{ username: 'nasa' }], ['invalid/user'], Array(21).fill('nasa')]) {
    const { id } = await fixture('instagram', 100);
    const { job } = await publishing.prepareReviewPublication(id, settings('instagram', { userTags: ['nasa'] }));
    alterStored(id, saved => { saved.userTags = userTags; }, 'instagram');
    accessCalls = 0;
    await assert.rejects(publishing.listReviewPublishJobs(id), /needs local inspection/);
    await assert.rejects(publishing.runReviewPublication(id, job.id), /needs local inspection/);
    await assert.rejects(publishing.prepareReviewPublication(id, { action: 'continue', confirm: true, jobId: job.id }), /needs local inspection/);
    assert.equal(accessCalls, 0);
  }
  const youtube = await fixture('youtube', 100);
  await publishing.prepareReviewPublication(youtube.id, settings('youtube'));
  alterStored(youtube.id, saved => { saved.userTags = ['nasa']; }, 'youtube');
  accessCalls = 0; await assert.rejects(publishing.listReviewPublishJobs(youtube.id), /needs local inspection/); assert.equal(accessCalls, 0);
  const story = await confirmedStoryFixture();
  await publishing.prepareReviewPublication(story.id, settings('instagram', { companionStory: true }));
  const savedStory = readStory(story.id); savedStory.userTags = ['nasa']; fs.writeFileSync(storyPath(story.id), JSON.stringify(savedStory));
  accessCalls = 0; await assert.rejects(publishing.listReviewPublishJobs(story.id), /needs local inspection/); assert.equal(accessCalls, 0);
  assert.equal(scheduled.length, 0);
});

async function musicFixture({ mood = 'calm', energy = 'low', observations = ['Frame 1: Trees beside a green forest clearing.'], profile = true, dual = false } = {}) {
  const value = await fixture('instagram', 100, true);
  if (dual) {
    value.file.outputs.youtube = { ...value.file.outputs.instagram, filename: `${value.id}-youtube.mp4` };
    fs.copyFileSync(files.outputPath(value.id, 'instagram'), files.outputPath(value.id, 'youtube'));
  }
  const target = dual ? 'youtube' : 'instagram';
  const { postingMediaFingerprint } = require(path.join(project, 'src/lib/postingEvidence.ts'));
  value.file.quality.postingAnalysis = { status: 'COMPLETE', attempts: 1, updatedAt: new Date().toISOString(), detail: 'Fixture sampled evidence', observations,
    fingerprint: postingMediaFingerprint(value.file, target, fs.statSync(files.outputPath(value.id, target))),
    ...(profile ? { musicBrief: { version: 1, mood, energy, reason: 'Green forest samples suggest a calm, open atmosphere.', evidenceFrames: [1] } } : {}),
  };
  await files.saveReviewFile(value.file);
  return value;
}
function installMusicCatalog(onLookup) {
  const { REEL_MUSIC_SEEDS } = require(path.join(project, 'src/lib/reelMusic.ts'));
  const queries = [];
  global.fetch = async (target, options) => {
    const url = new URL(target); assert.equal(url.pathname, '/v22.0/ig_audio');
    assert.equal(options.method || 'GET', 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(url.searchParams.get('audio_type'), 'music'); assert.equal(url.searchParams.get('user_id'), instagramAccount);
    const q = url.searchParams.get('search_query'); assert.ok(q, 'Never request blank generic trends'); queries.push(q);
    const override = await onLookup?.(url, queries.length); if (override) return override;
    const seed = REEL_MUSIC_SEEDS.find(item => item.title === q); assert.ok(seed);
    return Response.json({ audio: [
      audioTrack({ audio_id: `${90000 + queries.length}`, title: seed.title, display_artist: 'Unverified cover artist' }),
      audioTrack({ audio_id: `${91000 + queries.length}`, title: `${seed.title} Remix`, display_artist: seed.artist }),
      audioTrack({ audio_id: `${92000 + queries.length}`, title: seed.title, display_artist: seed.artist }),
    ] });
  };
  return queries;
}
test('music recommendations reuse current visual evidence, bound Meta lookups and include verified English originals plus instrumentals', async () => {
  const { id, file } = await musicFixture(); const queries = installMusicCatalog();
  const response = await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish?check=audio-recommendations&connectionRevision=fixture-revision`), context(id));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(queries.length, 3);
  assert.equal(result.recommendation.preference, 'english-and-instrumental'); assert.equal(result.recommendation.basis, 'sampled-frames');
  assert.equal(result.audio.length, 3); assert.ok(result.audio.some(track => track.recommendation.kind === 'english-vocal'));
  assert.ok(result.audio.some(track => track.recommendation.kind === 'instrumental'));
  assert.deepEqual(result.audio.map(track => track.recommendation.rank), [1, 2, 3]);
  assert.ok(result.audio.every(track => track.audio_id.startsWith('92') && /calm visual mood/.test(track.recommendation.reason)));
  assert.ok(!JSON.stringify(result).includes('fixture-secret-token')); assert.ok(!JSON.stringify(result).includes('download_url'));
  assert.equal(scheduled.length, 0); assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
  assert.deepEqual(await files.getReviewFile(id), file, 'Read-only recommendations never replace caption or create a job');
});
test('legacy dual exports reuse YouTube analysis only after proving the Instagram MP4 is byte-identical', async () => {
  const { id, file } = await musicFixture({ dual: true }); const queries = installMusicCatalog();
  const result = await publishing.recommendInstagramAudio(id, 'fixture-revision'); assert.equal(result.audio.length, 3); assert.equal(queries.length, 3);
  assert.deepEqual(await files.getReviewFile(id), file, 'No cache reset or automatic analysis migration');
  const filename = files.outputPath(id, 'instagram'); const stat = fs.statSync(filename); fs.writeFileSync(filename, Buffer.alloc(stat.size, 8));
  queries.length = 0; const changed = await publishing.recommendInstagramAudio(id, 'fixture-revision');
  assert.deepEqual(changed.audio, []); assert.match(changed.reason, /out of date/); assert.equal(queries.length, 0);
});
test('stale output, missing observations and uncertain music never substitute generic trends or trigger another model', async () => {
  for (const variant of ['changed', 'no-analysis', 'no-evidence', 'uncertain']) {
    const { id, file } = await musicFixture({ mood: variant === 'uncertain' ? 'uncertain' : 'calm', energy: 'unknown' });
    if (variant === 'changed') fs.appendFileSync(files.outputPath(id, 'instagram'), 'changed');
    if (variant === 'no-analysis') delete file.quality.postingAnalysis;
    if (variant === 'no-evidence') file.quality.postingAnalysis.observations = [];
    if (variant !== 'changed') await files.saveReviewFile(file);
    let calls = 0; global.fetch = async () => { calls++; assert.fail('No evidence must make no provider request'); };
    const result = await publishing.recommendInstagramAudio(id, 'fixture-revision'); assert.deepEqual(result.audio, []); assert.equal(calls, 0);
    assert.match(result.reason, /out of date|not enough|uncertain/); assert.equal(scheduled.length, 0);
  }
});
test('older completed caption analysis derives a labelled editorial mood from saved observations, not topic or hashtags', async () => {
  const { id, file } = await musicFixture({ profile: false, observations: ['Frame 1: Rain rings on a dark wet surface.'] });
  file.title = 'Untrusted happy dog song'; file.quality.postCopy = 'Party dance'; file.quality.hashtags = ['#Dance']; await files.saveReviewFile(file);
  const queries = installMusicCatalog(); const result = await publishing.recommendInstagramAudio(id, 'fixture-revision');
  assert.equal(result.recommendation.basis, 'saved-observations'); assert.equal(result.recommendation.mood, 'reflective');
  assert.match(result.recommendation.reason, /not a full-video or audio review/); assert.equal(queries.length, 3);
});
test('catalog omission and wrong-language-looking unverified identities return no forced recommendation', async () => {
  const { id } = await musicFixture(); const queries = installMusicCatalog(() => Response.json({ audio: [audioTrack({ title: 'English-looking unknown song', display_artist: 'Unverified artist' })] }));
  const result = await publishing.recommendInstagramAudio(id, 'fixture-revision'); assert.equal(queries.length, 3); assert.deepEqual(result.audio, []);
  assert.match(result.reason, /none of the matching/); assert.equal(scheduled.length, 0);
});
test('music lookup quota or permission failure stops immediately and discards partial results without secret leakage', async () => {
  for (const status of [403, 429]) {
    const { id } = await musicFixture(); const queries = installMusicCatalog((url, count) => count === 2 ? Response.json({ error: { message: 'private fixture-secret-token' } }, { status }) : undefined);
    const result = await publishing.recommendInstagramAudio(id, 'fixture-revision'); assert.equal(queries.length, 2); assert.deepEqual(result.audio, []);
    assert.match(result.reason, /Meta could not|lookup limit/); assert.ok(!JSON.stringify(result).includes('fixture-secret-token'));
    assert.deepEqual(await publishing.listReviewPublishJobs(id), []); assert.equal(scheduled.length, 0);
  }
});
test('disconnect, analysis change and either output changing during contextual music lookup fail closed', async () => {
  for (const change of ['connection', 'instagram', 'youtube', 'analysis']) {
    const { id, file } = await musicFixture({ dual: true });
    const queries = installMusicCatalog(async (url, count) => {
      if (count !== 1) return;
      if (change === 'connection') channelChanged = true;
      if (change === 'instagram' || change === 'youtube') fs.appendFileSync(files.outputPath(id, change), 'change');
      if (change === 'analysis') { file.quality.postingAnalysis.musicBrief.mood = 'playful'; await files.saveReviewFile(file); }
    });
    const result = await publishing.recommendInstagramAudio(id, 'fixture-revision'); channelChanged = false;
    assert.deepEqual(result.audio, []); assert.match(result.reason, /connection changed|video changed|analysis changed/); assert.ok(queries.length <= 3);
    assert.equal(scheduled.length, 0);
  }
});

const defaultsPath = () => path.join(process.env.PHOENIX_PUBLISH_STORAGE, 'instagram-posting-defaults.json');
function seedPostingDefaults(value = {}) {
  fs.mkdirSync(process.env.PHOENIX_PUBLISH_STORAGE, { recursive: true });
  fs.writeFileSync(defaultsPath(), JSON.stringify({ version: 1, accountId: instagramAccount, userTags: [], ...value }));
}
test('posting defaults are account-bound, local and empty until chosen; normal status never loads them', async () => {
  const { id } = await fixture('instagram', 100);
  assert.deepEqual(await publishing.getInstagramPostingDefaults(id, 'fixture-revision'), { userTags: [] });
  seedPostingDefaults({ accountId: 'other-account', userTags: ['fixture_account'] });
  await assert.rejects(publishing.getInstagramPostingDefaults(id, 'fixture-revision'), /local inspection/);
  seedPostingDefaults({ accountId: '987654321', userTags: ['fixture_account'] });
  assert.deepEqual(await publishing.getInstagramPostingDefaults(id, 'fixture-revision'), { userTags: [] });
  const before = accessCalls; await publishing.listReviewPublishJobs(id); assert.equal(accessCalls, before); assert.equal(scheduled.length, 0);
});
test('chosen Switzerland query automatically resolves only a unique exact eligible Meta location, without publishing or changing defaults', async () => {
  const { id } = await fixture('instagram', 100); seedPostingDefaults({ locationQuery: 'Switzerland', userTags: ['fixture_account'] });
  const saved = fs.readFileSync(defaultsPath(), 'utf8'); appSecretProof = 'fixture-proof'; let lookups = 0;
  global.fetch = async target => {
    const url = new URL(target); assert.equal(url.pathname, '/v21.0/pages/search'); assert.equal(url.searchParams.get('q'), 'Switzerland'); lookups++;
    return Response.json({ data: [{ id: '12345', name: 'Switzerland', location: { latitude: 46.8, longitude: 8.2 } },
      { id: '12346', name: 'Switzerland cafe', location: { latitude: 1, longitude: 2 } }] });
  };
  const response = await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish?check=posting-defaults&connectionRevision=fixture-revision`), context(id));
  const result = await response.json(); assert.equal(response.status, 200); assert.deepEqual(result.defaults.userTags, ['fixture_account']);
  assert.deepEqual(result.defaults.location, { id: '12345', name: 'Switzerland' }); assert.equal(lookups, 1); assert.equal(scheduled.length, 0);
  assert.equal(fs.readFileSync(defaultsPath(), 'utf8'), saved, 'New-post setup reads never overwrite protected choices');
  assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});
test('missing permission, unrelated results, duplicate exact names and absent coordinates do not fabricate an automatic location', async () => {
  const { id } = await fixture('instagram', 100); seedPostingDefaults({ locationQuery: 'Switzerland' });
  let result = await publishing.getInstagramPostingDefaults(id, 'fixture-revision'); assert.equal(result.location, undefined); assert.match(result.locationReason, /App Secret/);
  appSecretProof = 'fixture-proof';
  for (const data of [[], [{ id: '12345', name: 'Switzerland cafe', location: { latitude: 1, longitude: 2 } }],
    [{ id: '12345', name: 'Switzerland' }], [{ id: '12345', name: 'Switzerland', location: { latitude: 1, longitude: 2 } }, { id: '12346', name: 'Switzerland', location: { latitude: 3, longitude: 4 } }]]) {
    global.fetch = async () => Response.json({ data }); result = await publishing.getInstagramPostingDefaults(id, 'fixture-revision');
    assert.equal(result.location, undefined); assert.equal(result.locationQuery, 'Switzerland'); assert.ok(result.locationReason);
  }
  global.fetch = async () => Response.json({ error: { message: 'private fixture-secret-token' } }, { status: 403 });
  result = await publishing.getInstagramPostingDefaults(id, 'fixture-revision'); assert.equal(result.location, undefined); assert.match(result.locationReason, /App Review/);
  assert.ok(!JSON.stringify(result).includes('fixture-secret-token')); assert.equal(scheduled.length, 0);
});
test('remember posting choices is an explicit local settings action, reverifies the exact location and never schedules an upload', async () => {
  const { id } = await fixture('instagram', 100); let lookups = 0;
  global.fetch = async target => { assert.equal(new URL(target).pathname, '/v21.0/12345'); lookups++; return Response.json({ id: '12345', name: 'Switzerland', location: { latitude: 46.8, longitude: 8.2 } }); };
  const body = { action: 'save-posting-defaults', confirm: true, connectionRevision: 'fixture-revision', userTags: ['fixture_account'], location: { id: '12345', name: 'Switzerland' } };
  const response = await route.POST(request(id, body), context(id)); const value = await response.json(); assert.equal(response.status, 200);
  assert.deepEqual(value.defaults, { userTags: ['fixture_account'], location: { id: '12345', name: 'Switzerland' } }); assert.equal(lookups, 1);
  const stored = JSON.parse(fs.readFileSync(defaultsPath(), 'utf8')); assert.equal(stored.accountId, instagramAccount); assert.deepEqual(stored.userTags, ['fixture_account']);
  assert.equal(stored.accessToken, undefined); assert.deepEqual(await publishing.listReviewPublishJobs(id), []); assert.equal(scheduled.length, 0);
  const read = await publishing.getInstagramPostingDefaults(id, 'fixture-revision'); assert.deepEqual(read, value.defaults); assert.equal(lookups, 2, 'Stored location is verified on future posts');
});
test('malformed defaults, missing save confirmation and changed account cannot save or reuse tags and location', async () => {
  const { id } = await fixture('instagram', 100);
  const valid = { action: 'save-posting-defaults', confirm: true, connectionRevision: 'fixture-revision', userTags: [], location: null };
  for (const body of [{ ...valid, confirm: false }, { ...valid, userTags: ['@invalidcanonical'] }, { ...valid, location: { id: 'Switzerland', name: 'Switzerland' } }, { ...valid, extra: true }]) {
    await assert.rejects(publishing.saveInstagramPostingDefaults(id, body)); assert.equal(fs.existsSync(defaultsPath()), false);
  }
  assert.equal(accessCalls, 0); channelChanged = true; await assert.rejects(publishing.saveInstagramPostingDefaults(id, valid), /connection changed/); channelChanged = false;
  assert.equal(fs.existsSync(defaultsPath()), false);
  for (const fields of [{ userTags: ['@bad'] }, { locationQuery: '\nSwitzerland' }, { location: { id: 'bad', name: 'Switzerland' } }]) {
    seedPostingDefaults(fields); await assert.rejects(publishing.getInstagramPostingDefaults(id, 'fixture-revision'), /local inspection/);
  }
  assert.equal(scheduled.length, 0);
});

test('an explicitly approved unresolved posting location query is remembered without provider calls and later resolves only a unique exact eligible place', async () => {
  const { id } = await fixture('instagram', 100); let providerCalls = 0;
  global.fetch = async () => { providerCalls++; assert.fail('Saving an unresolved place never searches or posts'); };
  const body = { action: 'save-posting-defaults', confirm: true, connectionRevision: 'fixture-revision', userTags: ['approved.person'], location: null, locationQuery: ' Switzerland ' };
  const result = await publishing.saveInstagramPostingDefaults(id, body); assert.deepEqual(result, { userTags: ['approved.person'], locationQuery: 'Switzerland' });
  assert.equal(providerCalls, 0); assert.equal(scheduled.length, 0); const saved = fs.readFileSync(defaultsPath(), 'utf8');
  appSecretProof = 'fixture-proof'; global.fetch = async target => {
    providerCalls++; assert.equal(new URL(target).searchParams.get('q'), 'Switzerland');
    return Response.json({ data: [locationPage('12345', 'Switzerland'), locationPage('67890', 'Switzerland cafe')] });
  };
  const defaults = await publishing.getInstagramPostingDefaults(id, 'fixture-revision');
  assert.deepEqual(defaults.location, { id: '12345', name: 'Switzerland' }); assert.equal(providerCalls, 1);
  assert.equal(fs.readFileSync(defaultsPath(), 'utf8'), saved); assert.equal(scheduled.length, 0); assert.deepEqual(await publishing.listReviewPublishJobs(id), []);
});

test('invalid or mismatched posting location queries fail before credentials and cannot fabricate an ID', async () => {
  const { id } = await fixture('instagram', 100);
  const base = { action: 'save-posting-defaults', confirm: true, connectionRevision: 'fixture-revision', userTags: [], location: null };
  for (const locationQuery of ['a', 'x'.repeat(101), 'Switzerland\n', '\tSwitzerland', '\u0000', null, 123]) {
    await assert.rejects(publishing.saveInstagramPostingDefaults(id, { ...base, locationQuery }));
  }
  await assert.rejects(publishing.saveInstagramPostingDefaults(id, { ...base, location: { id: '12345', name: 'Lake Lucerne' }, locationQuery: 'Switzerland' }), /do not match/);
  assert.equal(accessCalls, 0); assert.equal(fs.existsSync(defaultsPath()), false); assert.equal(scheduled.length, 0);
});

test('an explicit tags-only default save clears a remembered location query without adding or searching for a location', async () => {
  const { id } = await fixture('instagram', 100); seedPostingDefaults({ userTags: ['old.person'], locationQuery: 'Switzerland' });
  const result = await publishing.saveInstagramPostingDefaults(id, { action: 'save-posting-defaults', confirm: true, connectionRevision: 'fixture-revision', userTags: ['approved.person'], location: null, locationQuery: '' });
  assert.deepEqual(result, { userTags: ['approved.person'] }); const saved = JSON.parse(fs.readFileSync(defaultsPath(), 'utf8'));
  assert.equal(saved.location, undefined); assert.equal(saved.locationQuery, undefined); assert.deepEqual(saved.userTags, ['approved.person']); assert.equal(scheduled.length, 0);
});

async function rejectedReelFixture({ story = false } = {}) {
  const value = story ? await confirmedStoryFixture() : await fixture('instagram', 100);
  const { job } = await publishing.prepareReviewPublication(value.id, settings('instagram', {
    caption: 'The saved approved caption #Horses', userTags: ['old.account'], ...(story ? { companionStory: true } : {}),
  }));
  global.fetch = async () => Response.json({ error: { code: 100, message: 'Private rejected parameter fixture-secret-token' } }, { status: 400 });
  await publishing.runReviewPublication(value.id, job.id);
  global.fetch = async () => assert.fail('Correction preparation and status must not contact a real or mocked provider');
  return { ...value, job };
}
const correction = (job, changes = {}) => ({ action: 'revise', jobId: job.id, confirm: true, caption: 'Corrected horses caption #Horses', userTags: [], ...changes });
const revisionHistory = id => {
  const directory = path.join(process.env.PHOENIX_PUBLISH_STORAGE, 'history');
  return fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.startsWith(`${id}-instagram-`))
    .map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))) : [];
};

test('rejected Reel correction exposes saved choices through local status and archives the previous request before one confirmed dispatch', async () => {
  const { id, job } = await rejectedReelFixture({ story: true });
  alterStored(id, saved => {
    saved.location = { id: '987654321', name: 'Saved approved place' };
    saved.audio = { ...audioConfig(), title: 'Saved approved track', display_artist: 'Saved artist' };
    saved.instagramGraphVersion = 'v22.0';
  }, 'instagram');
  const original = readStored(id, 'instagram'), originalStory = readStory(id);
  const beforeReads = { accessCalls, sessionReads, proofCalls };
  const status = await (await route.GET(new Request(`http://localhost:3000/api/review-files/${id}/publish`), context(id))).json();
  assert.equal(status.jobs[0].canRevise, true); assert.equal(status.jobs[0].caption, original.caption);
  assert.deepEqual(status.jobs[0].userTags, ['old.account']);
  assert.deepEqual({ accessCalls, sessionReads, proofCalls }, beforeReads, 'Status never decrypts credentials or upload sessions');
  assert.equal(scheduled.length, 0);
  const responses = await Promise.all([route.POST(request(id, correction(job)), context(id)), route.POST(request(id, correction(job)), context(id))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]); assert.equal(scheduled.length, 1);
  const revised = readStored(id, 'instagram');
  assert.equal(revised.id, job.id); assert.equal(revised.status, 'QUEUED'); assert.equal(revised.phase, 'created');
  assert.equal(revised.caption, 'Corrected horses caption #Horses'); assert.equal(revised.userTags, undefined);
  for (const key of ['location', 'audio', 'instagramGraphVersion', 'privacy', 'companionStoryApproved', 'fingerprint', 'connectionRevision', 'accountId', 'renderTarget']) {
    assert.deepEqual(revised[key], original[key], `Correction preserves ${key}`);
  }
  assert.deepEqual(readStory(id), originalStory); assert.deepEqual(revisionHistory(id), [original]);
  assert.equal((await publishing.listReviewPublishJobs(id))[0].canRevise, undefined);
  assert.equal((await publishing.listReviewPublishJobs(id))[0].caption, undefined);
});

test('corrected tags are explicit and canonical while caption, tags and confirmation are mandatory', async () => {
  const { id, job } = await rejectedReelFixture();
  const before = accessCalls;
  for (const changes of [{ confirm: false }, { caption: undefined }, { userTags: undefined }, { userTags: ['invalid/user'] },
    { caption: '#one #two #three #four #five #six' }, { location: { id: '987654321' } }, { audio: audioConfig() },
    { privacy: 'private' }, { companionStory: false }, { connectionRevision: 'other' }, { title: 'Other title' }]) {
    const response = await route.POST(request(id, correction(job, changes)), context(id)); assert.equal(response.status, 400);
    assert.ok(!JSON.stringify(await response.json()).includes('fixture-secret-token'));
  }
  assert.equal(accessCalls, before); assert.equal(scheduled.length, 0); assert.deepEqual(revisionHistory(id), []);
  const revised = await publishing.prepareReviewPublication(id, correction(job, { userTags: ['@New.Account', 'new.account', 'SECOND'] }));
  assert.equal(revised.dispatch, true); assert.deepEqual(revised.job.userTags, ['new.account', 'second']);
  assert.equal(revisionHistory(id).length, 1);
});

test('partial, active, ambiguous and completed Reel states cannot expose editable caption or revise posting choices', async () => {
  for (const changes of [
    { status: 'QUEUED' }, { status: 'UPLOADING' }, { status: 'NEEDS_CHECK' }, { status: 'COMPLETE', phase: 'complete' },
    { phase: 'session_unknown' }, { phase: 'publish_unknown' }, { phase: 'initiating' }, { phase: 'processing' },
    { containerId: '987654321' }, { remoteId: '987654321' }, { remoteUrl: 'https://www.instagram.com/reel/fixture/' }, { bytesUploaded: 1 },
  ]) {
    const { id, job } = await rejectedReelFixture(); alterStored(id, saved => Object.assign(saved, changes), 'instagram');
    const original = readStored(id, 'instagram'), before = accessCalls;
    const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.canRevise, undefined); assert.equal(status.caption, undefined);
    await assert.rejects(publishing.prepareReviewPublication(id, correction(job)), /Only a failed Instagram request/);
    assert.equal(accessCalls, before); assert.deepEqual(readStored(id, 'instagram'), original); assert.deepEqual(revisionHistory(id), []);
  }
  const youtube = await fixture('youtube', 100); const { job } = await publishing.prepareReviewPublication(youtube.id, settings());
  await assert.rejects(publishing.prepareReviewPublication(youtube.id, correction(job)), /not found/);
  assert.equal(scheduled.length, 0);
});

test('private sessions and live operation locks block correction without overwriting a failed request', async () => {
  for (const state of ['session', 'operation']) {
    const { id, job } = await rejectedReelFixture(); const original = readStored(id, 'instagram');
    const lock = `${storedPath(id, 'instagram')}.operation.lock`;
    if (state === 'session') sessions.set(job.id, instagramLocation); else fs.writeFileSync(lock, 'fixture-live-operation');
    try {
      if (state === 'operation') {
        const status = (await publishing.listReviewPublishJobs(id))[0]; assert.equal(status.canRevise, undefined); assert.equal(status.caption, undefined);
      }
      await assert.rejects(publishing.prepareReviewPublication(id, correction(job)), /private provider session|Only a failed Instagram request/);
      assert.deepEqual(readStored(id, 'instagram'), original); assert.deepEqual(revisionHistory(id), []); assert.equal(scheduled.length, 0);
    } finally { sessions.delete(job.id); if (fs.existsSync(lock)) fs.unlinkSync(lock); }
  }
});

test('changed saved video, destination, connection or permission blocks correction before archiving or dispatch', async () => {
  for (const change of ['video', 'account', 'revision', 'connection', 'permission', 'login']) {
    const { id, job } = await rejectedReelFixture(); const original = readStored(id, 'instagram');
    if (change === 'video') fs.appendFileSync(files.outputPath(id, 'instagram'), 'changed');
    if (change === 'account') instagramAccount = '987654321';
    if (change === 'revision') alterStored(id, saved => { saved.connectionRevision = 'old-revision'; }, 'instagram');
    if (change === 'connection') channelChanged = true;
    if (change === 'permission') permissionDenied = true;
    if (change === 'login') instagramLogin = 'instagram';
    try {
      await assert.rejects(publishing.prepareReviewPublication(id, correction(job)), /video changed|destination account changed|upload permission|connection changed/i);
      assert.equal(readStored(id, 'instagram').status, 'FAILED'); assert.equal(readStored(id, 'instagram').caption, original.caption);
      assert.deepEqual(readStored(id, 'instagram').userTags, original.userTags); assert.deepEqual(revisionHistory(id), []); assert.equal(scheduled.length, 0);
    } finally { instagramAccount = '123456789012345'; channelChanged = false; permissionDenied = false; instagramLogin = 'facebook'; }
  }
});

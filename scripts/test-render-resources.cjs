const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phoenix-resource-tests-'));
const originalCwd = process.cwd();
const originalFree = os.freemem;
require('ts-node').register({ project: path.join(project, 'tsconfig.json'), transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', jsx: 'react-jsx' } });
require('tsconfig-paths').register({ baseUrl: project, paths: { '@/*': ['src/*'] } });
process.chdir(root);
const resources = require(path.join(project, 'src/lib/renderResources.ts'));
const health = require(path.join(project, 'src/lib/studioHealth.ts'));
const directory = path.join(root, 'storage', 'Phoenix Studio Review Files');
const leaseFile = path.join(directory, 'heavy-work-lease.json');
const jobsFile = path.join(directory, 'ai-creation-jobs.json');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const lease = (extra = {}) => ({ version: 1, token: 'test-lease', pid: process.pid, kind: 'Test operation', acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ...extra });
beforeEach(() => { fs.mkdirSync(directory, { recursive: true }); write(leaseFile, null); write(jobsFile, []); os.freemem = () => 8 * 1024 ** 3; });
after(() => { os.freemem = originalFree; process.chdir(originalCwd); fs.rmSync(root, { recursive: true, force: true }); });

test('local lease holds through the operation and releases on success or failure', async () => {
  const result = await resources.tryWithLocalRenderSlot(async () => { assert.equal((await resources.readHeavyLease()).kind, 'Test'); return 42; }, 'Test');
  assert.deepEqual(result, { acquired: true, value: 42 });
  assert.equal(await resources.readHeavyLease(), null);
  await assert.rejects(resources.tryWithLocalRenderSlot(async () => { throw new Error('render failed'); }), /render failed/);
  assert.equal(await resources.readHeavyLease(), null);
});

test('a separate Node process cannot enter the reserved slot', async () => {
  await resources.tryWithLocalRenderSlot(async () => {
    const code = `require(${JSON.stringify(path.join(project, 'node_modules/ts-node'))}).register({project:${JSON.stringify(path.join(project, 'tsconfig.json'))},transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});require('node:os').freemem=()=>8*1024**3;require(${JSON.stringify(path.join(project, 'src/lib/renderResources.ts'))}).tryWithLocalRenderSlot(async()=>{throw Error('overlapping operation')}).then(result=>process.stdout.write(JSON.stringify(result))).catch(e=>{process.stderr.write(e.stack);process.exitCode=1});`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', code], { cwd: root, windowsHide: true });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Child admission test timed out')); }, 20000);
      child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { acquired: false });
  });
});

test('nested admission fails explicitly instead of waiting forever', async () => {
  await resources.tryWithLocalRenderSlot(async () => {
    await assert.rejects(resources.withLocalRenderSlot(async () => {}), /Nested heavy-work/);
  });
});

test('external work survives operation return and network failure until terminal evidence', async () => {
  await resources.tryWithLocalRenderSlot(() => resources.retainExternalRender('job', 'task'));
  assert.equal((await resources.readHeavyLease()).external.taskId, 'task');
  assert.deepEqual(await resources.tryWithLocalRenderSlot(async () => {}), { acquired: false });
  await resources.reconcileHeavyLease(async () => { throw new Error('unreachable'); });
  assert.match((await resources.readHeavyLease()).external.error, /reserved slot was retained/);
  await resources.finishExternalRender('wrong-job', 'task');
  await resources.finishExternalRender('job', 'wrong-task');
  assert.ok(await resources.readHeavyLease());
  await resources.reconcileHeavyLease(async () => ({ state: 'terminal' }));
  assert.equal(await resources.readHeavyLease(), null);
});

test('stale observations cannot release a successor or a newly discovered task', async () => {
  write(leaseFile, lease({ external: { jobId: 'job', submittedAt: new Date().toISOString() } }));
  await resources.reconcileHeavyLease(async () => {
    const current = await resources.readHeavyLease();
    write(leaseFile, { ...current, external: { ...current.external, taskId: 'accepted-task' } });
    return { state: 'terminal' };
  });
  assert.equal((await resources.readHeavyLease()).external.taskId, 'accepted-task');
  await resources.reconcileHeavyLease(async () => {
    const current = await resources.readHeavyLease();
    write(leaseFile, { ...current, token: 'successor' });
    return { state: 'terminal' };
  });
  assert.equal((await resources.readHeavyLease()).token, 'successor');
});

test('dead owner is reclaimed only when no live child or external task remains', async () => {
  const deadPid = 99999999;
  write(leaseFile, lease({ pid: deadPid, childPids: [process.pid] }));
  assert.equal((await resources.tryWithLocalRenderSlot(async () => {})).acquired, false);
  write(leaseFile, lease({ pid: deadPid, external: { jobId: 'old', taskId: 'old-task', submittedAt: '2020-01-01T00:00:00Z' } }));
  assert.equal((await resources.tryWithLocalRenderSlot(async () => {})).acquired, false);
  write(leaseFile, lease({ pid: deadPid, childPids: [deadPid] }));
  assert.equal((await resources.tryWithLocalRenderSlot(async () => {})).acquired, true);
});

test('memory admission is nonblocking and never runs the operation', async () => {
  os.freemem = () => 128 * 1024 ** 2;
  assert.equal((await resources.tryWithLocalRenderSlot(async () => assert.fail('started without memory'))).acquired, false);
  const state = await resources.heavyWorkStatus();
  assert.equal(state.waitingForMemory, true);
  assert.match(state.reason, /Waiting for free memory/);
});

test('diagnostics clear crashed ordinary leases without admitting new work', async () => {
  write(leaseFile, lease({ pid: 99999999 }));
  os.freemem = () => 128 * 1024 ** 2;
  await resources.reconcileReleasedLocalLease();
  assert.equal(await resources.readHeavyLease(), null);
  for (const extra of [{}, { pid: 99999999, childPids: [process.pid] }, { pid: 99999999, external: { jobId: 'job', submittedAt: new Date().toISOString() } },
    { pid: 99999999, localModel: { model: 'qwen2.5:3b', baseUrl: 'http://127.0.0.1:11434', submittedAt: new Date().toISOString() } }]) {
    write(leaseFile, lease(extra));
    await resources.reconcileReleasedLocalLease();
    assert.ok(await resources.readHeavyLease(), 'A live owner/child or uncertain external/model must retain its lease');
  }
});

test('returned owner does not hold the slot forever after its last child exits', async () => {
  write(leaseFile, lease({ ownerReleased:true, childPids:[99999999] }));
  assert.equal((await resources.tryWithLocalRenderSlot(async()=>42)).value,42);
});

test('caught model uncertainty still retains its durable reservation until fresh absence', async () => {
  const inventory=require(path.join(project,'src/lib/localModelResources.ts'));
  const probe=inventory.readLocalModelPresence;
  let calls=0;
  inventory.readLocalModelPresence=async()=>{calls++;return {wasResident:true};};
  try {
    const model={model:'fixture:latest',baseUrl:'http://127.0.0.1:11434'};
    await resources.tryWithLocalRenderSlot(async()=>{
      await resources.retainLocalModelWork(model);
      await resources.reconcileLocalModelWork();
      assert.equal(calls,0,'A live writing session is not reconciled away');
      // Caller has caught a request error: outer operation itself returns.
    });
    assert.equal((await resources.readHeavyLease()).localModel.detached,true);
    assert.equal((await resources.tryWithLocalRenderSlot(async()=>assert.fail('overlap'))).acquired,false);
    inventory.readLocalModelPresence=async()=>{throw Error('offline');};
    await resources.reconcileLocalModelWork();assert.ok(await resources.readHeavyLease());
    inventory.readLocalModelPresence=async()=>({wasResident:false});
    assert.equal((await resources.tryWithLocalRenderSlot(async()=>42)).value,42);
    await resources.tryWithLocalRenderSlot(async()=>{
      await resources.retainLocalModelWork(model);
      await resources.finishLocalModelWork(model);
    });
    assert.equal(await resources.readHeavyLease(),null);
  } finally {inventory.readLocalModelPresence=probe;}
});

test('legacy live tasks reserve the slot until a terminal observation is recorded', async () => {
  write(jobsFile, [{ id: 'old-job', status: 'FAILED', providerTaskId: 'old-task' }]);
  assert.equal((await resources.tryWithLocalRenderSlot(async () => {})).acquired, false);
  assert.equal((await resources.readHeavyLease()).external.taskId, 'old-task');
  await resources.reconcileHeavyLease(async () => {
    write(jobsFile, [{ id: 'old-job', status: 'FAILED', providerTaskId: 'old-task', resourceReleasedTaskId: 'old-task' }]);
    return { state: 'terminal' };
  });
  assert.equal((await resources.tryWithLocalRenderSlot(async () => {})).acquired, true);
});

test('malformed durable state blocks work instead of ignoring a possible owner', async () => {
  for (const bad of [lease({ pid: -1 }), lease({ childPids: [0] }), lease({ external: {} }), lease({ heartbeatAt: 'invalid' })]) {
    write(leaseFile, bad);
    await assert.rejects(resources.tryWithLocalRenderSlot(async () => assert.fail('unsafe admission')), /Invalid heavy-work lease/);
  }
});

test('worker health distinguishes absent, fresh, stale and exited processes', async () => {
  const file = path.join(root, 'storage', 'worker-heartbeat.json');
  assert.equal((await health.studioHealth()).worker.state, 'offline');
  await health.writeWorkerHeartbeat();
  assert.equal((await health.studioHealth()).worker.state, 'healthy');
  write(file, { pid: process.pid, at: new Date(Date.now() - 60000).toISOString() });
  assert.equal((await health.studioHealth()).worker.state, 'unresponsive');
  write(file, { pid: 99999999, at: new Date().toISOString() });
  assert.equal((await health.studioHealth()).worker.state, 'offline');
});

test('health banner renders actionable offline, uncertain and resource-wait messages', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Banner = require(path.join(project, 'src/components/StudioHealth.tsx')).default;
  const render = value => renderToStaticMarkup(React.createElement(Banner, { health: value }));
  assert.match(render(null), /health is not confirmed/);
  const value = { worker: { state: 'offline' }, resources: { busy: false, waitingForMemory: false, freeMiB: 500, reason: 'Heavy-work slot available' }, build: '.next-test' };
  assert.match(render(value), /Queued jobs are saved but cannot start/);
  value.worker.state = 'unresponsive'; assert.match(render(value), /do not submit a duplicate/);
  value.worker.state = 'healthy'; value.resources.reason = 'Waiting for free memory';
  assert.match(render(value), /Waiting for free memory/);
});

test('source mutations reject cross-site/missing origins before accessing uploads or jobs', async () => {
  const route = require(path.join(project, 'src/app/api/source-processing/route.ts'));
  const retry = require(path.join(project, 'src/app/api/source-processing/run/route.ts'));
  for (const origin of [undefined, 'https://untrusted.example']) {
    for (const [method, handler] of [['POST', route.POST], ['DELETE', route.DELETE], ['POST', retry.POST]]) {
      const response = await handler(new Request('http://localhost/api/source-processing', { method, headers: origin ? { origin } : {} }));
      assert.equal(response.status, 403);
    }
  }
  assert.equal((await route.POST(new Request('http://localhost/api/source-processing', { method: 'POST', headers: { origin: 'http://localhost' } }))).status, 400);
  assert.equal((await retry.POST(new Request('http://localhost/api/source-processing/run', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ id: '../invalid' }) }))).status, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(jobsFile)), []);
});

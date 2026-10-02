// A small, fixed-key dispatcher: timer ticks are reminders, not queued jobs.
// Durable job stores remain the source of truth across waits and restarts.
function createWorkflowQueue({ workflows, canRun = async () => true, onError = () => {} }) {
  const callbacks = new Map(Object.entries(workflows));
  for (const [key, run] of callbacks) {
    if (typeof run !== "function") throw new TypeError(`Invalid workflow: ${key}`);
  }
  const pending = [], queued = new Set(), idleWaiters = [];
  let stopped = false, draining = false, active = null;

  async function report(key, error) {
    // A broken logger must not strand the workflow gate.
    try { await onError(key, error); } catch { }
  }
  async function drain() {
    if (stopped || draining || !pending.length) return;
    draining = true;
    try {
      while (!stopped && pending.length) {
        let selected = -1;
        // Keep blocked entries in place, but let a RAM-exempt text task pass a
        // waiting decoder. FIFO order is preserved among runnable workflows.
        for (let index = 0; index < pending.length && !stopped; index++) {
          try {
            if (await canRun(pending[index])) { selected = index; break; }
          } catch (error) {
            await report(pending[index], error);
            return; // Fail closed; the next bounded timer tick can retry.
          }
        }
        if (stopped || selected < 0) break;
        const [key] = pending.splice(selected, 1);
        queued.delete(key);
        active = key;
        try { await callbacks.get(key)(); }
        catch (error) { await report(key, error); }
        finally { active = null; }
        // Fast/reentrant callbacks must still yield to heartbeat and signals.
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      draining = false;
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }
  function resume() { void drain(); }
  function enqueue(key) {
    if (!callbacks.has(key)) throw new RangeError(`Unknown workflow: ${key}`);
    if (stopped) return false;
    const added = !queued.has(key);
    if (added) { queued.add(key); pending.push(key); }
    resume();
    return added;
  }
  // "Idle" means no callback/admission is running; blocked reminders may remain.
  function whenIdle() {
    return draining ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve();
  }
  function stop() {
    stopped = true;
    pending.length = 0;
    queued.clear();
    return whenIdle(); // Do not terminate an active model or encoder.
  }
  return { enqueue, resume, whenIdle, stop,
    snapshot: () => ({ stopped, active, pending: [...pending] }) };
}

function createWorkerDispatcher({ workflows, diagnostics = {}, canRunWorkflow, onError = () => {}, timers = globalThis }) {
  const workflowEntries = Object.entries(workflows), diagnosticEntries = Object.entries(diagnostics);
  for (const [key, entry] of [...workflowEntries, ...diagnosticEntries]) {
    if (typeof entry.run !== "function" || !Number.isInteger(entry.intervalMs) || entry.intervalMs <= 0) {
      throw new TypeError(`Invalid worker schedule: ${key}`);
    }
  }
  const queue = createWorkflowQueue({ workflows: Object.fromEntries(workflowEntries.map(([key, entry]) => [key, entry.run])),
    canRun: canRunWorkflow, onError });
  const intervals = [], checks = new Map(diagnosticEntries.map(([key]) => [key, null]));
  let stopped = false, stopPromise;

  function runDiagnostic(key) {
    if (stopped) return Promise.resolve();
    if (checks.get(key)) return checks.get(key);
    const promise = Promise.resolve().then(() => stopped ? undefined : diagnostics[key].run())
      .catch(async error => { try { await onError(key, error); } catch { } })
      .finally(() => { checks.set(key, null); queue.resume(); });
    checks.set(key, promise);
    return promise;
  }
  // These only inspect/update status; they never submit or finalize media jobs.
  for (const [key, entry] of diagnosticEntries) {
    intervals.push(timers.setInterval(() => { void runDiagnostic(key); }, entry.intervalMs));
    if (entry.immediate !== false) void runDiagnostic(key);
  }
  for (const [key, entry] of workflowEntries) {
    intervals.push(timers.setInterval(() => queue.enqueue(key), entry.intervalMs));
    if (entry.immediate) queue.enqueue(key);
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    for (const interval of intervals) timers.clearInterval(interval);
    const drained = queue.stop();
    stopPromise = Promise.allSettled([drained, ...[...checks.values()].filter(Boolean)]).then(() => undefined);
    return stopPromise;
  }
  return { stop, queue, runDiagnostic, snapshot: () => ({ ...queue.snapshot(),
    diagnostics: [...checks.entries()].filter(([, promise]) => promise).map(([key]) => key) }) };
}

module.exports = { createWorkflowQueue, createWorkerDispatcher };

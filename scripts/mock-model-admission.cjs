// Creative-output unit tests mock the model response, so their hardware
// session boundary is explicitly mocked too. Real admission, cleanup and queue
// behavior is covered by test-local-model-resources, test-local-model-session
// and test-model-queue-waits; those tests must never import this fixture.
const { mock } = require('node:test');
const session = require('../src/lib/localModelSession.ts');
mock.method(session, 'withLocalWritingSession', async work => work());
mock.method(session, 'generateLocalModel', async (body, options = {}) => fetch('http://127.0.0.1:11434/api/generate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...body, stream: false, options: { ...body.options, num_thread: 2, num_batch: 128 } }),
  signal: options.signal || AbortSignal.timeout(options.timeoutMs || 180_000),
}));

// Read Next's normal private environment, but return only launcher settings.
// Never print API keys, tokens, or the full environment.
const path = require('node:path');
const fs = require('node:fs');
const project = path.resolve(__dirname, '..');
function readWriterProvider(file = path.join(project, 'storage', 'private', 'writer-settings.json')) {
  try {
    // Return only the selected provider, never the private key or full settings.
    if (fs.statSync(file).size > 32768) throw new Error('invalid writer settings');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !['ollama', 'groq'].includes(saved.provider)) throw new Error('invalid writer settings');
    return saved.provider;
  } catch (error) {
    if (error.code === 'ENOENT') return 'ollama';
    throw new Error('Phoenix writer settings could not be read. Repair them in Studio health; no fallback writer was selected.');
  }
}
function settings(env, writerProvider = 'ollama') {
  if (!['ollama', 'groq'].includes(writerProvider)) throw new Error('Phoenix writer provider is invalid.');
  const url = new URL(env.MPT_BASE_URL || 'http://127.0.0.1:8080');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MoneyPrinterTurbo must use a plain loopback HTTP base URL. No remote or paid service was started.');
  }
  return { backendDirectory: env.PHOENIX_MPT_DIR || '', backendUrl: url.origin, backendPort: Number(url.port || 80), writerProvider };
}
if (require.main === module) {
  try {
    require('@next/env').loadEnvConfig(project, false, { info() {}, error() {} });
    process.stdout.write(JSON.stringify(settings(process.env, readWriterProvider())));
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
module.exports = { settings, readWriterProvider };

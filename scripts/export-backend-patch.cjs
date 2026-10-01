// Mechanical snapshot of the explicitly reviewed dependency changes. Never
// stage the dependency checkout, copy config.toml, or include runtime files.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const backend = path.resolve(process.env.PHOENIX_MPT_DIR || path.join(project, '..', '..', '..', '..', 'MoneyPrinterTurbo'));
const base = '3ade9fbc40e18db32a5edb340d49e31ea0dd5528';
const tracked = ['.gitignore', 'app/controllers/v1/video.py', 'app/models/schema.py', 'app/services/task.py', 'app/services/video.py', 'config.example.toml', 'docker-compose.release.yml', 'main.py', 'test/services/test_schema.py', 'test/services/test_video.py'];
const additions = ['app/services/phoenix_storyboard.py', 'app/services/phoenix_artifacts.py', 'test/services/test_phoenix_storyboard.py', 'test/services/test_phoenix_artifacts.py'];
const run = (args, differences = false) => {
  const result = spawnSync('git', args, { cwd: backend, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !(differences && result.status === 1))) throw new Error(`Backend patch command failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
};
if (run(['rev-parse', 'HEAD']).trim() !== base) throw new Error('Backend base commit differs; review the patch base before exporting.');
let patch = run(['diff', '--binary', base, '--', ...tracked]);
for (const filename of additions) patch += run(['diff', '--no-index', '--binary', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', filename], true);
if (!patch.trim()) throw new Error('Backend patch is empty.');
const destination = path.join(project, 'integrations', 'moneyprinterturbo-local.patch');
if (process.argv.includes('--write')) fs.writeFileSync(destination, patch, 'utf8');
else if (fs.readFileSync(destination, 'utf8') !== patch) throw new Error('Backend patch differs from the current reviewed files. Run this script with --write after reviewing changes.');
run(['apply', '--reverse', '--check', destination]);
console.log('Backend patch matches the reviewed file allowlist and reverse-checks successfully.');

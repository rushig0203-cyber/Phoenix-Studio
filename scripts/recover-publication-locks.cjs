'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

async function recoverPublicationLocks(root, reviewId) {
  if (typeof root !== 'string' || typeof reviewId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(reviewId)) return false;
  root = path.resolve(root);
  for (const directory of [root, path.join(root, 'storage'), path.join(root, 'storage', 'private'), path.join(root, 'storage', 'private', 'review-publications')]) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fs.realpath(directory), directory)) return false;
  }
  const publications = path.join(root, 'storage', 'private', 'review-publications');
  const story = path.join(publications, `${reviewId}-instagram-story.json`), reel = path.join(publications, `${reviewId}-instagram.json`);
  const locks = [story + '.lock', story + '.operation.lock', reel + '.lock', reel + '.operation.lock', path.join(publications, '.publication-stream.lock'), path.join(root, 'storage', 'private', 'channels.enc.lock')];
  const existing = [];
  for (const filename of locks) {
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64) return false;
      existing.push(filename);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!existing.length) return true;
  const selection = path.join(root, 'storage', 'active-build.json'), selected = await fs.lstat(selection);
  if (!selected.isFile() || selected.isSymbolicLink() || selected.size > 8192) return false;
  const { directory } = JSON.parse(await fs.readFile(selection, 'utf8'));
  const { load } = require('./worker-runtime.cjs').compiledRuntime(root, directory);
  const { recoverAbandonedFileLock } = load('fileLock');
  // Older installed releases remain busy rather than using an unguarded cleanup.
  if (typeof recoverAbandonedFileLock !== 'function') return false;
  for (const filename of existing) if (!await recoverAbandonedFileLock(filename)) return false;
  return true;
}

module.exports = { recoverPublicationLocks };
if (require.main === module) {
  if (process.argv.length !== 4) process.exitCode = 1;
  else recoverPublicationLocks(process.argv[2], process.argv[3]).then(ok => { process.exitCode = ok ? 0 : 1; }).catch(() => { process.exitCode = 1; });
}

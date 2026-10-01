<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Local release and launch discipline

- On the owner's Windows laptop, the current working project is
  `C:\Users\rishi\Documents\Codex\2026-07-29\cehd\PhoenixStudio`.
  `C:\Users\rishi\Desktop\PhoenixStudio` is a junction to that same project.
  Do not run or overwrite `PhoenixStudio-old-backup-*` copies or old ZIP exports.
- Read `IMPLEMENTATION_PROGRESS.md` before reporting release completion. Source
  changes, a verified build, and the process currently serving port 3000 are
  different states. Check `/api/studio-health` against `storage/active-build.json`;
  never claim an update is active from a Git commit or BUILD_ID alone.
- Use `npm run build` for guarded, separate production builds. Do not build over
  a running bundle or weaken the RAM/heavy-work checks. Use the Desktop launcher
  for app lifecycle; `npm start` is intentionally headless.
- Keep runtime videos, private settings, keys, model files and generated bundles
  out of Git. Preserve old media and local changes when consolidating copies.

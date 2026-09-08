# Phoenix Studio

A single-owner, local video workspace. Process uploaded episodes, create stock-footage edits, review outputs, and export MP4s. The active Phoenix workflows do not call paid AI-video providers or publish automatically.

## Current capabilities and limits

- **Source video:** streamed large uploads; coverage/highlights selection; speech and silence analysis; natural clip boundaries; FFmpeg exports, captions, posting copy and review recommendations.
- **Children's stories:** original local narration and simple procedural 2D cut-out animation for ages 3–6. This is **not** anime or professional 3D animation.
- **Children's songs:** requires a user-supplied recording that already contains singing/music and matching lyrics. Automatic high-quality singing is **not installed**; speech is never presented as singing.
- **Business/general:** local Ollama narration (or an owner-supplied script), free Pexels footage, an editable ordered keyword brief, music and subtitles via MoneyPrinterTurbo. Keyword ordering is not verified shot-to-speech alignment. Failed narration does not silently become generic filler.
- **Review library:** real cached thumbnails, one focused video player, visible loading/error/retry states, search, category filters, pagination, posting details, and manual editing.
- **Trash:** one-click recoverable removal, Undo and Restore. Media remains on disk and continues to occupy space. Older versions permanently deleted files; this change cannot restore those earlier deletions.
- **Quality manager:** owner ratings change bounded future children's-story guidance. It does not retrain a model, autonomously rewrite its code, or predict earnings. Text scores do not evaluate visuals or singing.
- **Channel setup:** can verify configured YouTube/Instagram connections. Account consent is still required. Upload links are manual posting, not an automated publisher.

The product is still being improved. Professional animation, automatic singing, and consistent editorial-quality stock selection are not completed acceptance criteria.

## Local setup (Windows)

1. Install Node.js and run `npm ci --legacy-peer-deps`.
2. Copy `phoenix.env.example` to `.env.local`, then fill only the settings you need. Never commit keys.
3. Start Ollama with `qwen2.5:3b` installed.
4. For episode transcription, install `faster-whisper` in a Python environment and set `PHOENIX_WHISPER_PYTHON`. Model downloads require internet access on first use.
5. For stock edits, set up MoneyPrinterTurbo and apply the documented local adjustments in [integrations](integrations/README.md). Configure its free stock keys locally and run it on `http://127.0.0.1:8080`.
6. Run `npm run build`, then `npm start`. Start opens both the web server and the background worker. Development mode: `npm run dev`.
7. Open [Phoenix Studio](http://localhost:3000). It opens the dashboard directly.

FFmpeg/FFprobe are installed through the npm dependencies, or can be configured explicitly. Source preflight reports missing tools. Children's narration and secure local account storage currently rely on Windows facilities; Docker is not a verified full replacement for this Windows workflow.

Uploads, MP4s, queue state, captions, and feedback live under `storage/Phoenix Studio Review Files`. A Desktop shortcut is available in the library. Keep the PC awake for queued work. Local software avoids provider API bills, but still uses your electricity, storage and internet; third-party free stock services have their own limits.

## Checks

```powershell
node scripts/test-review-library.cjs
node scripts/test-quality-manager.cjs
node scripts/test-queue-history.cjs
node scripts/test-review-workflows.cjs
npx tsc --noEmit
npm run build
```

The suites use isolated temporary stores, not user videos. They cover queue and file integrity, real small FFmpeg exports, thumbnail caching and media ranges, editing, and text/feedback behavior—not professional artistic quality. The bundled render tests use Windows executables.

The default build directory is `.next-lumina`. `PHOENIX_BUILD_DIR` can select a separate directory for a staged build; the server must use the same directory as that build.

## Git and privacy

Runtime media, credentials, databases, builds, logs and Python caches are excluded. GitHub Actions is manual-only. Keep paid-provider credentials out of the local configuration. No paid service or public deployment is required for the local workflows.

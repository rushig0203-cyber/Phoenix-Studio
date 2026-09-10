# Phoenix Studio

A single-owner, Windows-first local video workspace. Process uploaded episodes, plan original children's stories or stock-footage videos, approve the content, and export MP4s for manual posting. The active Phoenix workflows do not call paid AI-video providers or publish automatically.

**Status: usable local workflows, with limitations—not a completed automatic song/animation studio.** The September 10 update adds saved storyboards, exact stock-footage approval, richer original 2D artwork, and one-confirmation Trash. A real 60-second story was rendered and played in the dashboard. Automatic singing remains unavailable on the current 8 GB laptop.

See [release notes](CHANGELOG.md), [creation and singing details](integrations/FREE-CREATION.md), and [stock renderer setup](integrations/README.md).

## Current capabilities and limits

- **Source video:** streamed large uploads; coverage/highlights selection; speech and silence analysis; natural clip boundaries; FFmpeg exports, captions, posting copy and review recommendations.
- **Pre-render approval:** persistent planning drafts, editable narration, actual Pexels previews or children's character poses, and explicit **Approve & render**. Duplicate approval requests reuse the same render job. Closing the browser does not discard saved drafts.
- **Children's stories:** local narration and original 2D animation for ages 3–6, with one standalone story or a ten-part series. Version 4 adds fuller characters, expressive eyes, detailed paws/wings, stitched clothing, eight-petal flowers, and layered scenery. It is limited 12 fps illustration, **not** anime or professional 3D animation. New renders use the updated artwork; existing exports are not overwritten.
- **Children's songs:** import a recording that already contains singing/music and matching lyrics. A local-only ACE-Step adapter is included, but its engine/models are **not installed or bundled**. Phoenix disables this automatic mode below 12 GB usable RAM or 4 GB free RAM; these are conservative Phoenix guards. The current laptop cannot enable it. There is no paid fallback, and speech is not a substitute for singing.
- **Business/general:** local Ollama narration (or an owner-supplied script), an editable storyboard, approved Pexels footage, music and subtitles via the patched MoneyPrinterTurbo backend. Choose a distinct, sufficiently long clip for every section. The exact approved asset IDs are sent to the renderer; unavailable or too-short footage fails instead of being silently replaced. Final sections use speech-caption timing; within-caption estimates are labelled. Watch the final crop and audio yourself—this is not reliable automated visual understanding.
- **Review library:** real cached thumbnails, one focused video player, visible loading/error/retry states, search, category filters, pagination, posting details, and manual editing.
- **Trash:** one confirmation when moving a video to Trash; rapid repeated clicks are ignored while saving. Undo and Restore do not ask another deletion confirmation. Media remains on disk and continues to occupy space. Older versions permanently deleted files; this change cannot restore those earlier deletions.
- **Live jobs:** queued/running/completed/failed history, progress, elapsed time and available ETA estimates, plus retry and eligible history-removal controls. Draft planning and finished-video rendering are separate stages.
- **Quality manager:** owner ratings change bounded future children's-story guidance. It does not retrain a model, autonomously rewrite its code, or predict earnings. Text scores do not evaluate visuals or singing.
- **Channel setup:** can verify configured YouTube/Instagram connections. Account consent is still required. Upload links are manual posting, not an automated publisher.

Attention recommendations and text checks do not measure artistic quality or guarantee views, monetization, or income. Automatic singing and consistent editorial-quality output without owner review are not completed acceptance criteria.

## Make your first video

For an episode, choose **Choose a video**, upload the source, and select full coverage or best highlights when offered. This source-processing workflow cuts the original footage; it does not request generated replacement visuals.

For a new creation:

1. Choose **Create a video**, the content type, publishing format and length. For one children's story, change the default ten-part series to **One standalone video**.
2. Enter an idea or use the suggested ideas. You can supply your own narration; stock videos also accept a visual search brief. Songs need sung audio and matching lyrics unless a supported local singing engine is available.
3. Click **Plan video for approval** (or **Plan 10 story drafts**). This queues planning—not a video render.
4. Open **Storyboard approval → Review draft**. Edit and save the sections. For stock videos, search, preview and select actual footage for every section. For children's videos, inspect the character poses; for songs, listen to the audio.
5. Confirm your review and click **Approve & render**. Follow the new job in **Live jobs & history**.
6. Play the finished video in **Your videos**. Use **Edit video** for supported manual edits, **Copy post + tags**, or **Download**. Posting remains manual.

The app's creation presets—not a statement of platform-wide limits—are:

| Preset | Format | Offered lengths |
| --- | --- | --- |
| YouTube full video/song | 16:9 | 2:30, 3:00, 3:30 |
| YouTube Short | 9:16 | 1:00, 1:15, 1:30 |
| Instagram Reel | 9:16 | 0:45, 1:00, 1:15, 1:30, 1:45 |

## Local setup (Windows)

1. Install Node.js and run `npm ci --legacy-peer-deps`.
2. Copy `phoenix.env.example` to `.env.local`, then fill only the settings you need. Never commit keys.
3. Start Ollama with `qwen2.5:3b` installed for local writing and idea generation. Do not load heavy models while the laptop is short on RAM.
4. For episode transcription, install `faster-whisper` in a Python environment and set `PHOENIX_WHISPER_PYTHON`. Model downloads require internet access on first use.
5. For stock edits, set up MoneyPrinterTurbo and apply the documented local adjustments in [integrations](integrations/README.md). Set `PEXELS_API_KEY` in Phoenix's private `.env.local` for draft search, and configure the backend's Pexels key separately for rendering. Run the backend on `http://127.0.0.1:8080`. The approved-footage picker currently uses Pexels; it is not a Pixabay picker.
6. Run `npm run build`, then `npm start`. Start opens both the web server and the background worker. Development mode: `npm run dev`.
7. Open [Phoenix Studio](http://localhost:3000). It opens the dashboard directly.

For one-click startup, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1` once. The **Phoenix Studio** Desktop shortcut starts missing local services and opens a Chrome app window (Edge/default browser fallback). Existing services are reused. Closing the browser leaves processing running; shutting down the PC stops it. The launcher expects the optional backend at `Documents/MoneyPrinterTurbo`, or the `PHOENIX_MPT_DIR` environment variable. It does not install software, download models, or enable paid services. Keep the project folder in place; reinstall the shortcut after moving it.

To start without opening another window, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-phoenix.ps1 -NoBrowser`. Do not run a second copy of `npm start` when the launcher already has the services running. `PHOENIX_MPT_DIR` must be available to the PowerShell launcher as an environment variable; it is not loaded from Phoenix's `.env.local` by that script.

FFmpeg/FFprobe are installed through the npm dependencies, or can be configured explicitly. Source preflight reports missing tools. Children's narration and secure local account storage currently rely on Windows facilities; Docker is not a verified full replacement for this Windows workflow.

Uploads, MP4s, queue state, captions, and feedback live under `storage/Phoenix Studio Review Files`. A Desktop shortcut is available in the library. Keep the PC awake for queued work. Local software avoids provider API bills, but still uses your electricity, storage and internet; third-party free stock services have their own limits.

## Troubleshooting

- **Website opens but jobs remain queued:** the website and worker are separate processes. Run `node run-worker.js --preflight` to check that all processors load without taking a job. Inspect the newest `storage/worker-*-error.log`, then use the Desktop launcher to start missing services. Do not create repeated copies of the same job.
- **Draft says READY but there is no MP4:** this is expected until you review and approve it. Saving edits alone never renders a video.
- **Stock search works but approval/rendering fails:** confirm both applications have their own private stock configuration and the backend patch is applied. An old backend missing `PhoenixStoryBeat.assetId` is rejected. Search for a longer clip if the selected asset cannot cover its narration.
- **Video preview fails:** use **Retry preview** or **Download MP4**. Check that Phoenix is still running and the output still exists. The player loads one video at a time and supports byte-range seeking.
- **Desktop opens an older version:** the launcher reuses a running website. Build updates separately and restart the app only when active jobs have finished; do not overwrite a live build. See staged builds below.
- **Low memory or noisy rendering:** avoid simultaneous builds, renders and model downloads. Local FFmpeg thread counts are bounded and animation rasterization uses one worker with a 24 MB image cache, but this is not a guarantee against system-wide memory pressure from other apps.
- **Automatic song option is unavailable:** this laptop does not meet Phoenix's singing memory guard. Import a sung recording, or use a separately installed local engine on suitable hardware. No paid service is enabled automatically.
- **A channel is not connected:** use **Connection setup**, configure the required app credentials privately, and complete account consent yourself. Opening a platform upload page does not connect or publish to that account.

## Checks

```powershell
node --test --test-concurrency=1 scripts/test-review-library.cjs scripts/test-quality-manager.cjs scripts/test-queue-history.cjs scripts/test-review-workflows.cjs scripts/test-stock-storyboard.cjs scripts/test-creation-drafts.cjs scripts/test-animation-and-delete.cjs scripts/test-worker-startup.cjs
node scripts/verify-kids-animation.cjs --stills-only
node scripts/verify-kids-animation.cjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Automated suites use isolated temporary stores or mocks, not user videos. They cover queue/file integrity, small real FFmpeg exports, media ranges, editing, draft approval and duplicate submissions, exact stock IDs, character rasterization, and deletion/restore behavior. Singing adapter tests use a mock engine; they do not prove a real generated song sounds good. The bundled render tests use Windows executables.

The animation proof script writes local samples under `storage/Phoenix Studio Review Files/work/animation-quality-proof-v4`. Its 12-second video uses instrumental test audio, **not singing**. The `--stills-only` option avoids a video encode. These proof artifacts are not uploaded to Git.

The September 10 live check verified a completed 60-second, 720×1280 children's story, visible queue progress, burned-in captions, saved hashtags, browser playback and recoverable Trash. It did not certify all possible inputs, a complete 49-minute episode, or automatic singing. See [CHANGELOG.md](CHANGELOG.md).

## Staged builds and updates

The default build directory is `.next-lumina`. `PHOENIX_BUILD_DIR` selects a separate directory for a staged build; a directly started server must use the same value. On the tested laptop the verified release was built in `.next-storybook`.

The Desktop launcher optionally reads `storage/active-build.json`, for example `{"directory":".next-storybook"}`. It accepts only a `.next-...` directory name with a `BUILD_ID`. This marker is local runtime state and is not committed. A fresh clone has no marker and uses `.next-lumina`. `npm start` does **not** read the marker; set `PHOENIX_BUILD_DIR` yourself if using that command with a staged build.

Do not build over the directory used by a running website. Check the build has completed, wait for active jobs to finish, then switch the launcher marker and restart the website/worker. Keep the previous verified build available for rollback. No rebuild or server restart is needed for documentation-only changes.

## Git and privacy

Runtime media, credentials, databases, builds, logs and Python caches are excluded. GitHub Actions is manual-only. Keep paid-provider credentials out of the local configuration. No paid service or public deployment is required for the local workflows.

GitHub contains application source, tests, examples and the local backend patch—not a backup of your private Review Files folder. Back up that folder separately if you need to preserve uploads, drafts, finished videos and metadata. Never commit filled `.env` files, backend `config.toml`, account tokens, or song/model downloads.

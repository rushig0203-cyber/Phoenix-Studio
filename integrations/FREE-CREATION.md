# Free creation and final-video review

## Three distinct creation paths

- **Real footage reels:** `GET /api/stock-reels?q=...&provider=all` searches the configured free Pexels/Pixabay libraries. `POST /api/stock-reels` accepts a provider/asset ID, request UUID, descriptive caption and maximum duration. The server resolves the media address itself, bounds downloads to 500 MB, streams to local storage and queues `sourceProcessing`. No Ollama, Whisper transcription, synthetic visuals or generated voice runs for this path. The overlay is explicitly labelled descriptive, not a transcript. Existing short footage stays short.
- **Narrated business/general videos:** local writing and a timed stock storyboard, with automatic exact-asset selection and final review. Structured ratings for the matching creation type guide new narration; supplied scripts remain unchanged.
- **Children's original 2D:** the local illustrated-animation path remains available, with optional ten-part stories and the previously documented singing limits.

The manager/dashboard topic explorer uses `GET /api/content-ideas` for 42 curated, original prompts across 10 categories, with balanced initial suggestions and local title-history rotation. It is not limited to those prompts: search for any stock subject or supply your own creation topic. It does not claim live trend discovery or guaranteed earnings.

Phoenix's dashboard creates persistent preparation records which **automatically dispatch render jobs**. Records live in `storage/Phoenix Studio Review Files/creation-drafts.json` and are planned by `run-worker.js`. No scene approval is required for new creations.

1. Choose a story, song, business video, or general video and select **Create video**.
2. Phoenix plans the narration and visual sequence. Stock selection checks catalog descriptions, sufficient duration, aspect fit, uniqueness and contributor continuity. It does not understand actual video frames or guarantee the same people across clips.
3. The saved plan automatically becomes a render job. Repeated submissions and interrupted dispatch reuse its identity; partially selected footage survives retry. No automatic publishing is enabled.
4. Watch the finished video in Library, listen to its audio, and edit if necessary before posting. Older waiting plans resume automatically at worker startup. The plan editor and manual finish button have been removed from the app.

Stock footage is resolved by its selected Pexels ID on the server. Missing or too-short assets fail explicitly instead of switching to random footage. A descriptive but off-topic catalog result is rejected; ID-only catalog entries are labelled as having unknown descriptive relevance. Shot durations are ultimately tied to the spoken caption timestamps, not the pre-render estimate. Inspect the final crop and captions before posting.

## Singing: supported does not mean installed or quality-verified

Phoenix includes a local-only adapter for [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5), an MIT-licensed music/singing engine. No paid API, hosted inference fallback, cloud account, or subscription is enabled. The adapter follows the [official API](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md): health/models → release_task → query_result → streamed local audio download.

The engine is **not bundled or automatically downloaded**. Its [installation guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INSTALL.md) lists approximately 10 GB for core models and warns CPU-only inference is significantly slower. Phoenix conservatively disables automatic singing below 12 GB usable system RAM or 4 GB currently free RAM. This is Phoenix's responsiveness guard, not a vendor minimum or a promise that larger machines will render quickly.

The current 8 GB laptop therefore cannot enable this automatic mode through Phoenix. The lightweight route remains importing a sung recording with accompaniment and the exact lyrics. Automatic singing quality is not verified on this machine.

On suitable hardware where the user has separately installed and started ACE-Step, configure the **local** endpoint in private `.env.local`:

```dotenv
PHOENIX_ACE_URL=http://127.0.0.1:8001
# Only if local ACE-Step authentication is enabled:
# PHOENIX_ACE_TOKEN=your-local-server-token
```

Use the official local server, not OpenRouter or a hosted endpoint. Limit ACE-Step to one queue worker, disable its optional language model (`ACESTEP_INIT_LLM=false`) and set CPU thread limits in the engine environment. Phoenix sends one audio result per request, explicit duration and lyrics, and disables prompt/lyric rewriting. It never downloads models, initializes additional model slots, or calls a paid service for you.

If submission becomes uncertain, Phoenix retains that state and will not blindly resubmit. If a task ID is known, retry reconnects to it. Network status checks retry at most three times with backoff. Generated audio still requires a human listening check: lyrics, singing presence, musical quality, and caption timing cannot be proven by file metadata alone.

## Animation limits

The version 5 local renderer retains the detailed version 4 artwork and adds sentence-level story cues, acting/listening roles, and persistent tangled/held/flying kite states. Narrated scenes no longer alternate fake speaking mouths; quoted dialogue uses a speaker heuristic, not audio-derived lip sync. A tangled kite has visible knotted string (and a branch when specified), stays tangled through reaction lines, and changes state on resolution. These are bounded scene rules, not a general physical simulation. Sharp's image cache is capped at 24 MB with one raster worker.

This remains limited 2D illustration at 12 fps, rendered sequentially with bounded threads. It is **not** a general anime/3D generation model. No downloaded character artwork or commercial animation subscription is used. Existing videos are preserved; the updated drawing system applies to new renders and draft previews.

## Deleting a review video

Move to Trash asks one confirmation. Cancelling sends no delete request, and another click while saving is ignored. Undo/Restore does not ask a second deletion confirmation. Files stay recoverable on disk.

## Checks

```powershell
node --test scripts/test-creation-drafts.cjs scripts/test-stock-storyboard.cjs
node --test scripts/test-animation-and-delete.cjs scripts/test-worker-startup.cjs
node scripts/verify-kids-animation.cjs
```

`node scripts/verify-kids-animation.cjs` renders a bounded 12-second **instrumental animation test**, not a sung-song demonstration. It does not submit production queue jobs. Add `--stills-only` to check character frames without encoding a video. See `test/services/test_phoenix_storyboard.py` in the patched MoneyPrinterTurbo checkout for approved-asset and actual FFmpeg-frame tests.

## Developer interfaces

The dashboard sends `POST /api/generations` with `planOnly: false`. It returns `draftIds`, `count`, `status` and `planOnly: false`; follow each preparation record to its `approvedJobId`, then poll `/api/generations` for render progress. Older `planOnly: true` submissions are accepted but now also render automatically. All API creation requests pass through durable planning; clients must not assume an immediate `jobId`. Source-processing endpoints remain separate.

| Interface | Purpose |
| --- | --- |
| `GET /api/creation-drafts` | List saved, non-archived drafts |
| `PATCH /api/creation-drafts` | `save`, `choose`, `approve`, `finish` (automatically), `retry`, or `archive` a draft |
| `GET /api/creation-drafts/footage?q=...&aspect=9:16` | Search real Pexels choices |
| `GET /api/creation-drafts/:id/preview?scene=0&frame=6` | Preview the children's SVG pose for a saved section |
| `GET` / `HEAD /api/creation-drafts/:id/audio` | Stream the saved song, including byte-range playback |
| `GET /api/singing/status` | Explain local engine availability or its blocker |

Draft mutations require `id` and the current `version`; approval also requires `reviewConfirmed: true`. Stock selection sends a section `index` and `assetId`, not an arbitrary media URL. A stale version returns HTTP 409. The draft routes enforce loopback access, and mutations require a same-origin request. API callers should retain the creation `requestId` for safe retries and poll the saved record instead of resubmitting a new creation.

Planning states are `QUEUED`, `PLANNING`, `READY`, `FAILED`, `APPROVING`, `APPROVED`, and `ARCHIVED`. For `input.reviewMode: "final"`, the legacy `APPROVING`/`APPROVED` states mean automatic dispatch, **not human approval**. The render input uses `scriptLocked: true` and `scriptApproved: false`; the immutable narration retains its true origin. Dispatched records retain `approvedJobId`; follow `/api/generations` for progress and `/api/review-files` for outputs. Planning leases recover interrupted work. A failed plan is not a finished video.

Approval is an editorial checkpoint, not a guarantee of audience engagement, commercial rights, or monetization. Check source licences and platform requirements before publishing. Local processing still uses electricity, disk space, and any existing internet connection.

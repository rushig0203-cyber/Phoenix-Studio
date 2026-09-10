# Free creation and the approval boundary

Phoenix's dashboard creates persistent **drafts**, not finished-video jobs. Drafts live in `storage/Phoenix Studio Review Files/creation-drafts.json` and are planned by `run-worker.js`.

1. Choose a story, song, business video, or general video and select **Plan video for approval**.
2. Review and edit the narration. Stock drafts require selecting actual Pexels footage for every section. Children's drafts show poses from the same original 2D renderer used for export.
3. Listen to any song audio in the draft. Confirm the story, visuals, and audio, then choose **Approve & render**.
4. The approved snapshot becomes one render job. A repeated approval returns the same job. Existing finished videos are kept. Interrupted approvals are safely dispatched when the worker resumes.

Stock footage is resolved by its approved Pexels ID on the server. Missing or too-short assets fail explicitly instead of switching to random footage. Shot durations are ultimately tied to the spoken caption timestamps, not the pre-render estimate. Inspect the final crop and captions before posting.

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

The version 4 local renderer has fuller face and body silhouettes, shaded eyes with highlights, paws and feathered wings, stitched overalls and pockets, detailed eight-petal flowers, a garden cottage and fence, and separate foreground plants. Room scenes have curtains, shelves, books and a rug; night and ocean scenes have their own scenery. Independent blinks, contextual facial reactions, articulated legs, and four-second motion cycles remain lightweight. Kite flight makes characters hold a string, not fly themselves. Sharp's image cache is capped at 24 MB with one raster worker.

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

The dashboard sends `POST /api/generations` with `planOnly: true` to create drafts. Older direct-generation callers are retained for compatibility; the approval workflow should explicitly opt into planning. Source-processing endpoints remain separate.

| Interface | Purpose |
| --- | --- |
| `GET /api/creation-drafts` | List saved, non-archived drafts |
| `PATCH /api/creation-drafts` | `save`, `choose`, `approve`, `retry`, or `archive` a draft |
| `GET /api/creation-drafts/footage?q=...&aspect=9:16` | Search real Pexels choices |
| `GET /api/creation-drafts/:id/preview?scene=0&frame=6` | Preview the children's SVG pose for a saved section |
| `GET` / `HEAD /api/creation-drafts/:id/audio` | Stream the saved song, including byte-range playback |
| `GET /api/singing/status` | Explain local engine availability or its blocker |

Draft mutations require `id` and the current `version`; approval also requires `reviewConfirmed: true`. Stock selection sends a section `index` and `assetId`, not an arbitrary media URL. A stale version returns HTTP 409. The draft routes enforce loopback access, and mutations require a same-origin request. API callers should retain the creation `requestId` for safe retries and poll the saved record instead of resubmitting a new creation.

Planning states are `QUEUED`, `PLANNING`, `READY`, `FAILED`, `APPROVING`, `APPROVED`, and `ARCHIVED`. Approved drafts retain their `approvedJobId`; follow `/api/generations` for render progress and `/api/review-files` for completed outputs. Planning leases recover interrupted work, and interrupted approval dispatch reuses its job identity. A failed plan is not a finished video.

Approval is an editorial checkpoint, not a guarantee of audience engagement, commercial rights, or monetization. Check source licences and platform requirements before publishing. Local processing still uses electricity, disk space, and any existing internet connection.

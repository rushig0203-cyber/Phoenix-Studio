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

The current 8 GB laptop therefore cannot enable this automatic mode through Phoenix. The working lightweight route remains importing a sung recording with accompaniment and the exact lyrics. A better engine connection cannot magically make a low-memory laptop produce professional songs.

On suitable hardware where the user has separately installed and started ACE-Step, configure the **local** endpoint in private `.env.local`:

```dotenv
PHOENIX_ACE_URL=http://127.0.0.1:8001
# Only if local ACE-Step authentication is enabled:
# PHOENIX_ACE_TOKEN=your-local-server-token
```

Use the official local server, not OpenRouter or a hosted endpoint. Limit ACE-Step to one queue worker, disable its optional language model (`ACESTEP_INIT_LLM=false`) and set CPU thread limits in the engine environment. Phoenix sends one audio result per request, explicit duration and lyrics, and disables prompt/lyric rewriting. It never downloads models, initializes additional model slots, or calls a paid service for you.

If submission becomes uncertain, Phoenix retains that state and will not blindly resubmit. If a task ID is known, retry reconnects to it. Network status checks retry at most three times with backoff. Generated audio still requires a human listening check: lyrics, singing presence, musical quality, and caption timing cannot be proven by file metadata alone.

## Animation limits

The original local renderer now has shaded faces and clothes, layered scenery, independent blinks, contextual facial reactions, articulated walking legs, and four-second reusable motion cycles. It remains limited 2D illustration at 12 fps, rendered sequentially with bounded threads. It is **not** a general anime/3D generation model. No downloaded character artwork or commercial animation subscription is used.

## Checks

```powershell
node --test scripts/test-creation-drafts.cjs scripts/test-stock-storyboard.cjs
node scripts/verify-kids-animation.cjs
```

The second command renders a bounded 12-second **instrumental animation test**, not a sung-song demonstration. It does not submit production queue jobs. See `test/services/test_phoenix_storyboard.py` in the patched MoneyPrinterTurbo checkout for approved-asset and actual FFmpeg-frame tests.

Approval is an editorial checkpoint, not a guarantee of audience engagement, commercial rights, or monetization. Check source licences and platform requirements before publishing. Local processing still uses electricity, disk space, and any existing internet connection.

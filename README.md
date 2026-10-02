# Phoenix Studio

### Connection and writing reliability (October 2 source follow-up)

Instagram's private token form accepts a raw token, matching outer quotes or an
`Authorization: Bearer ...` header, including Enter submission. Verification
requires an actual Instagram identity: Instagram Login works directly, while
Facebook User/Page tokens must resolve a linked professional Instagram account.
A Facebook profile name alone is never treated as an Instagram connection.
Expired/revoked tokens, missing permissions, quota and network failures have
distinct safe messages; credentials never appear in connection status. Repeated
submissions are single-flight, and cancelled/replaced checks cannot reconnect an
account after Disconnect. Provider responses are bounded to 256 KiB.

YouTube connection setup still requires your Google OAuth client and account
consent. Its backend verifies the channel using read-only access, checks
browser-bound state/PKCE, and renews an expired saved connection only when you
choose **Check connection**. Connecting does not upload or publish a video;
reviewed outputs retain their manual platform-upload links. No paid AI service
or additional publishing permission is enabled by these changes.

The stock script editor now saves initial review, rewrite, length adjustment and
final review separately. A quota wait resumes the unfinished phase rather than
repeating completed calls. Reuse requires matching script/model/policy/brief and
real saved evidence; local length/disclosure guards are recomputed. Invalid review
JSON gets at most one correction. Provider error text is not retained or exposed;
only recognized error codes receive a safe structured-output diagnosis. The
cause of the earlier generic HTTP 400 is not established retroactively.

This follow-up is tested source, not yet the running production bundle. Check
`IMPLEMENTATION_PROGRESS.md` before assuming it is active. A guarded build and
idle activation are still required; old failed jobs are not retried automatically.

### Original reels and expressive stories (October 2 local update)

Stock search now supports one useful moment or up to six ordered, related shots,
with interval controls, portrait-first results, full-picture framing for unsafe
crops, original ambience and optional quiet locally composed music. Sources are
streamed to disk sequentially with a shared 500 MB limit. Selected endings survive
proportional shortening at the chosen cap. No loops, generated voice or automatic
publication are added. Shot/theme selection is manual; Phoenix does not claim to
identify the best moment or prove that different footage depicts the same place.

Original vector character rigs have complete limbs, directional expressions,
finite action/reaction sequences, camera compositions and persistent prop states.
Stories use the installed Windows voices. Bounded per-utterance PCM assembly
avoids legacy voice-switch/resampling clocks; measured word events drive caption
starts and visemes drive named character mouths. Brief captions merge where they
remain readable. Unknown speakers remain narration; imported songs retain their
explicit timing limitations. This is limited 2D, not a new 3D/anime model or a
professional singing synthesizer. Genuine songs still require a suitable sung
recording or the separately configured local singing engine and its RAM needs.

Automatic child writing, including series, now receives exact cast identities,
saved visual constraints and opening → attempt → consequence → reaction → payoff
direction. Stock writing emphasizes concrete information and an answered promise.
Automatic child plans and narration also receive conservative supported-action,
object-continuity and dialogue checks. Rejected content is saved before one
bounded correction; a quota interruption resumes the correction rather than
discarding the plan. Speaker-labeled JSON retains the exact two-character cast.
Closed schemas use Groq structured output; optional schemas remain non-strict.
These checks are not a semantic or artistic judge. Owner-locked text stays exact.
No guarantee of factual accuracy, quality, growth or income; review finished videos.

A real four-shot Pexels/Pixabay reel rendered through the production stock API and
queue: 45 seconds, 720×1280, 1,080 decoded frames, all source credits, local music
and no unwanted title overlay. It played to the end without a browser media error;
the downloaded MP4 matched the saved output hash. The running website matches
the new guarded build, with a healthy manager and ready renderer. Sampled-frame
analysis generated specific posting copy and hashtags while retaining every source.
A complete 71.8-second actual-manager story also rendered, with two installed
voices, 440 unique raster frames and measured speech timing. Its Node parent peak
was 158 MiB RSS; observed minimum system free RAM was 1,223 MiB for that story and
2,188 MiB for the real reel. These are **not** process-group RAM bounds or measured
optimization gains. Full artistic/motion/listening acceptance remains pending;
technical playback and three sampled frames do not establish engaging content.
See `IMPLEMENTATION_PROGRESS.md` for the exact installed/running release status.

### Desktop lifecycle and one current project

The Desktop shortcut opens an isolated Phoenix app window. Closing that window
stops the website, Lumina worker, owned renderer/model servers and observed child
rendering processes after a short debounce. Queue records and completed videos
remain on disk; interrupted work can resume on the next launch. The guardian
verifies process start time, executable and command identity, so unrelated browser
tabs and independently started Ollama/renderer servers are not stopped. Unknown
pre-existing ownership is preserved rather than guessed.

`npm start` (`-NoBrowser`) and development service startup remain headless: they
do not stop merely because a browser tab closes. Use **Phoenix Studio.lnk** for
close-with-the-app behavior. This launcher update takes effect next time that
shortcut opens a fresh app window; ordinary browser tabs are not desktop sessions.

An open window is not treated as proof that services are healthy. Reopening the
shortcut checks the website, matching manager heartbeat, renderer and installed
build before reusing the window. The guardian logs unexpected service exits and
can request up to three bounded repairs while the verified app window stays open.
Recovery waits for at least 768 MiB free RAM and no active/unknown heavy-work
reservation; it does not rebuild, preload a model or explicitly retry failed jobs.
Healthy polling uses cheap process/window checks, with descendant inventory every
10 seconds. Logs are in `storage/desktop-session-*.log` and
`storage/desktop-recovery-*.log`. The original simultaneous service-exit cause has
not been established.

`scripts/reload-desktop-session.ps1` refreshes the guardian for a verified existing
app window without stopping its services. The replaced guardian exits on the new
session token. Browser-message changes still require a guarded production build:
the updated dashboard reports one offline notice, labels cached lists as stale,
backs off to 15-second retries and disables creation/preparation queue controls
until the server reconnects.

On the owner's laptop, `Desktop/PhoenixStudio` now points to the same current
project as `Documents/Codex/2026-07-29/cehd/PhoenixStudio`. The older Desktop copy,
including its local changes and media, was preserved as
`Desktop/PhoenixStudio-old-backup-20261001`. Do not use the backup or old ZIP as the
live project. Git contains source changes, not the local installed build; see
**Staged builds and updates** and `IMPLEMENTATION_PROGRESS.md` for activation.

### Video-specific posting copy and automatic subtitles (October 1)

Finished videos expose their posting caption, hashtags, copy button, downloads and
manual Instagram/YouTube upload links directly in Jobs, Library and the player.
Platform links open the upload page; they do not publish the file automatically.

With sampled-frame permission enabled in Writing settings, the manager extracts
three small chronological frames from each finished video, sequentially with one
FFmpeg thread, and sends them plus bounded caption context to the configured Groq
Free-plan account. The full video/audio file stays local. The vision model is
`qwen/qwen3.8-27b`; no local vision weights or alternate provider are loaded.
Copy is specific to the sampled output and retains source/report citations.
Clear sampled visual/script conflicts are flagged; three frames cannot establish
that an entire video is accurate or engaging. Edited posting text is preserved
unless you request analysis. Unchanged results are reused, with an explicit
re-analysis action. Permission can be revoked in Settings.

Source subtitles use confidently detected speech. Stock search titles are no
longer burned into footage. Silent/music-only clips stay free of speech captions;
unavailable or uncertain speech recognition is flagged instead of guessing.
Stock speech checks use the cached local model only with safe memory headroom.
Old MP4s are not automatically re-rendered by this update.
Edited copies retain subtitle on/off and styling, with timed cues available for a
later explicit opt-in. Stock reels accept an empty optional description.

Groq rate-limit headers pace writing and visual analysis. Quota waits preserve
work and show the next automatic check. A finished MP4 remains downloadable
while its posting copy waits. Free quotas and account/model access still apply;
Phoenix relies on your Free-plan confirmation and never upgrades the account.

Stock selection rejects explicit word-sense mistakes such as chainsaw footage for
repair records. For a selected shot with a measured narration deficit of at most
2.5%, the renderer can slow that visual slightly; at most three end frames handle
frame-rate rounding. Larger deficits still fail with the exact section identified.

### Prompt-first creation update (October 1)

Create a video starts with your idea, not a four-category menu. Workflow routing
uses conservative keywords: name children and a story/animation or song explicitly
when you want those workflows. Suggestions and the optional narration/visual brief
are collapsible. Routine service details live in Settings; actionable warnings remain
visible. Submitting a job opens Jobs; an observed active-to-completed transition
returns to Jobs with a Watch video action. Opening old history does not redirect.

World news suggestions read the BBC World RSS feed on request (10-minute cache).
Selecting a report fetches its accessible article text before queueing an attributed
explainer. Failed, stale, oversized or unreadable sources stop news preparation;
headlines alone are not used as evidence. Report mode does not reuse a previously
entered custom script/shot brief. Source date/link and single-source limitations are
retained with the output. This is not independent fact checking or a controversy/
popularity ranking. Review allegations, uncertainty and current developments yourself
before posting. Stock visuals are illustrative, not evidence of the reported event.
No publisher footage or paid news API is used. Text is sent to your selected writer.

The lightweight 2D renderer retains its 12-fps bounded pose cache. This update adds
jump anticipation/landing and reaction continuity; named observers no longer copy
the other actor's action. These are limited-animation improvements, not a new anime
model or a claim of studio-quality animation. See IMPLEMENTATION_PROGRESS.md for
the actual build/activation and verification status.

### Optional low-RAM writing with Groq (September 27)

In **Studio health → Writing settings**, select Groq, paste a key from your **Free-plan** account, confirm the tier, and save. Saving checks key/model access before activating it. Briefs, narration, editorial checks and shot planning use `openai/gpt-oss-20b` through Groq; no Ollama model is loaded for these steps. The launcher does not require Ollama in this mode. Video/audio files and rendering remain local; text prompts, scripts and review guidance are sent to Groq. This does not remove FFmpeg/voice/transcription RAM requirements or improve animation by itself.

Keep the Groq account on Free, with no billing/paid upgrade. Phoenix **cannot verify account billing tier via the key** and cannot guarantee zero charges if the account is upgraded externally. There is no automatic provider/model fallback or billing action. Quota errors queue saved work with a shared cooldown instead of loading Ollama. Connectivity/authentication errors are explicit; no invented replacement script is rendered for Groq errors. See [Groq limits](https://console.groq.com/docs/rate-limits) and [billing](https://console.groq.com/docs/billing-faqs).

The key is stored in `storage/private/writer-settings.json`, excluded from Git and API responses. It is not encrypted by Phoenix; protect your Windows account and backups. Do not put keys in chat or commit them. Connection tests read model access only and do not generate content. Existing queued work reads the saved provider automatically after the updated worker is running.

A single-owner, Windows-first local video workspace. Process uploaded episodes, plan original children's stories or stock-footage videos, approve the content, and export MP4s for manual posting. The active Phoenix workflows do not call paid AI-video providers or publish automatically.

**Status: usable local workflows, with limitations—not a completed automatic song/animation studio.** The September 13 update makes final-video review the default: creation plans and renders without scene-by-scene approval. It adds metadata-based stock selection and more contextual 2D acting. Automatic singing remains unavailable on the current 8 GB laptop.

See [release notes](CHANGELOG.md), [creation and singing details](integrations/FREE-CREATION.md), and [stock renderer setup](integrations/README.md).

### Low-memory operation

The desktop shortcut and `npm start` reuse the installed production build; they
do not build the website on each launch. Startup uses single-thread local render
and transcription defaults, below-normal process priority, and 512 MiB Node heap
ceilings for the website and worker (not a total system-RAM cap). Heavy jobs share
one slot. Submitted source, generation, editing, planning and posting-analysis
workflows additionally use a bounded one-at-a-time dispatcher. Heartbeat and
status reconciliation remain responsive, including live external-render progress.
Idle or RAM-blocked media queues return without holding the dispatcher; crashed
ordinary leases recover only when no live owner/child or uncertain model/render
remains. Local writing releases Phoenix-owned model weights before rendering;
completed planning and clips are reused on retry. Long episode transcription reads
five-minute audio windows, not the whole episode at once.

Low memory queues work for automatic retry; it does not require repeatedly clicking
Generate. This trades speed for responsiveness, not output resolution. The local
3B writing model still requires several GB of free RAM for a cold load; a nearly
full 8 GB laptop cannot run it safely merely by lowering the admission threshold.
Installing a code update requires a separate one-time build and more free RAM than
opening the existing app. No paid hosting or replacement provider is enabled.

With Groq selected, bounded draft text/stock-catalogue planning does not load or
reserve RAM for a local writing model. It can pass RAM-blocked local workflows,
but intentionally does not overlap another active production workflow. Local Ollama
writing, audio generation and video rendering still use the shared heavy-work
slot and their existing memory safeguards. Only one draft is planned at a time;
a memory-blocked song cannot starve a later eligible Groq text plan. Provider quota
waits retain saved progress. Drawing clears its bounded Sharp cache before encoding
and music WAV generation uses one PCM/header buffer instead of duplicating it.
These changes reduce avoidable overlap/temporary buffers, not all system memory.
No paid VM/new dependency is needed, and a nearly full laptop may still have to wait.

The stock renderer also reuses unchanged encoded shots across attempts. Its
optional disk cache is capped at 256 MiB/512 files, with seven-day expiry. Source
content, source offset, output frame count, format and encoder identity determine
reuse; changed shots are encoded again. Cache damage or unavailable cache storage
falls back to normal rendering. Narration, captions and final assembly are not
skipped. This saves repeated encoding work, not the RAM needed for a first render.

### Music library versus song generation

[Navidrome](https://www.navidrome.org/docs/overview/) streams a music collection
you already have. It is not a singing generator or a licence for reusing songs in
videos, and Phoenix does not require or install it. For this low-RAM laptop, use
the existing song-audio upload for an original or appropriately licensed sung
recording and its lyrics. Check the licence for the intended platform and retain
any required attribution. The [YouTube Audio Library](https://support.google.com/youtube/answer/3376882)
is an option for YouTube background music; do not assume every track is licensed
for other platforms. Adding a backing track does not turn spoken TTS into singing.

### Quality-first implementation in progress

The September16 source changes add a shared stock-preparation path for creation,
regeneration and retries, immutable editing artifact references, and an editable
stock master with actual timed captions. Ranked highlight captions no longer rely
on display position; different concurrent edits return a conflict instead of an
older job. Square metadata and manager duration/count checks are corrected.

These foundation changes are **not a completed quality release**. The mixed-media
manager, stronger structured writing, global resource scheduling and real varied
comparison exports still need work. Track the complete requirements and evidence
in [implementation progress](IMPLEMENTATION_PROGRESS.md). New stock jobs require
the matching backend `phoenix_artifacts_version: 1` capability; older completed
videos are retained and are not retroactively given nonexistent clean masters.

## Current capabilities and limits

- **Source video:** streamed large uploads; coverage/highlights selection; speech and silence analysis; natural clip boundaries; FFmpeg exports, captions, posting copy and review recommendations.
- **App-style workspace:** Create, Jobs, Library and Settings are separate screens with persistent navigation. Forms retain their state when switching screens. Six recommendations appear inside the creation form for the selected type, with More ideas and a saved rotation between visits. These come from 152 local editorial starting points, not live trends or unlimited AI inventions.
- **Final review only:** creation persists its plan, selects footage, then queues rendering automatically. Older waiting plans resume when the worker starts. No plan editor or manual finish button is shown; even older `planOnly: true` API submissions now proceed automatically. Failed jobs retain their cause and a retry action instead of looping indefinitely. Duplicate submissions and interrupted dispatch reuse the same job identity.
- **Real stock reels:** **Find real footage** searches both configured Pexels/Pixabay libraries, favoring native portrait results. Select one to six shots, order them and set useful trims; sources stream to disk under one shared byte limit and enter the real source-processing queue, with no generated replacement visuals or narration. Preserve source sound, select a quiet local instrumental, or combine usable ambience with music. Automatic music replacement applies when all selected sound is absent/effectively silent, not merely quiet. Conservative framing keeps the full picture when a crop would discard too much. Posting copy, hashtags and every provider credit remain separate from on-screen subtitles; silent footage has no posting-title overlay. Short footage is not looped to fake duration.
- **Broader ideas:** 42 original starting points across 10 categories, including nature, places, food, crafts, business, practical skills, learning, hobbies and children’s stories. Initial suggestions mix categories, and exact previously used titles are demoted using local review history. Any search/topic is allowed; these are not live trend predictions.
- **Children's stories:** local narration and original 2D animation for ages 3–6, with one standalone story or a ten-part series. Version 4 adds fuller characters, expressive eyes, detailed paws/wings, stitched clothing, eight-petal flowers, and layered scenery. It is limited 12 fps illustration, **not** anime or professional 3D animation. New renders use the updated artwork; existing exports are not overwritten.
- **Children's songs:** import a recording that already contains singing/music and matching lyrics. A local-only ACE-Step adapter is included, but its engine/models are **not installed or bundled**. Phoenix disables this automatic mode below 12 GB usable RAM or 4 GB free RAM; these are conservative Phoenix guards. The current laptop cannot enable it. There is no paid fallback, and speech is not a substitute for singing.
- **Business/general:** narration from the selected writer (configured Groq Free account or local Ollama), or your supplied script, with a topic-appropriate continuity/comparison brief, automatically selected Pexels footage, music and subtitles via the patched MoneyPrinterTurbo backend. Selection filters duplicate/short/low-resolution clips and ranks descriptive catalog matches, format fit and contributor continuity. Exact selected IDs are sent to the renderer; unavailable or too-short footage fails instead of being silently replaced. These are metadata heuristics, not frame-level visual understanding. Watch the final crop and audio yourself.
- **Review library:** real cached thumbnails, one focused video player, visible loading/error/retry states, search, category filters, pagination, posting details, and manual editing.
- **Trash:** one confirmation when moving a video to Trash; rapid repeated clicks are ignored while saving. Undo and Restore do not ask another deletion confirmation. Media remains on disk and continues to occupy space. Older versions permanently deleted files; this change cannot restore those earlier deletions.
- **Live jobs:** queued/running/completed/failed history, progress, elapsed time and available ETA estimates, plus retry and eligible history-removal controls. Draft planning and finished-video rendering are separate stages.
- **Quality manager:** owner ratings change bounded future children's-story guidance and matching business/general narration prompts. Stock guidance no longer tells business videos to use animal characters. It does not retrain a model, autonomously rewrite its code, or predict earnings. Text scores do not evaluate visuals or singing.
- **Channel setup:** can verify configured YouTube/Instagram connections. Account consent is still required. Upload links are manual posting, not an automated publisher.

Attention recommendations and text checks do not measure artistic quality or guarantee views, monetization, or income. Automatic singing and consistent editorial-quality output without owner review are not completed acceptance criteria.

## Make your first video

For an episode, choose **Choose a video**, upload the source, and select full coverage or best highlights when offered. This source-processing workflow cuts the original footage; it does not request generated replacement visuals.

For a natural/real-footage reel, choose **Find real footage**, enter any concrete search, and select **Search real videos**. Add one to six results, order and trim the shots, choose sound/framing, and create the reel. It uses those real sources up to your chosen duration cap without looping short assets. An optional description seeds draft posting copy; it is not an overlay or a fabricated speech transcript. With sampled-frame permission, later analysis can produce video-specific posting text. Both providers use their own private free keys (`PEXELS_API_KEY`, `PIXABAY_API_KEY`). Partial search failures are shown without hiding successful results from the other provider.

For a new creation:

1. Choose **Create a video**, describe your idea, and select publishing format and length. There is no content-type picker; conservative prompt keywords select the workflow. The default is one video—not a ten-part animation batch. Explicit children's story prompts still offer a ten-part series.
2. Enter an idea or use the suggested ideas. You can supply your own narration; stock videos also accept a visual search brief. Songs need sung audio and matching lyrics unless a supported local singing engine is available.
3. Click **Create video** (or **Create 10 story videos**). Phoenix automatically prepares the narration, visuals and render.
4. The app opens **Jobs** after submission. Preparation and rendering are automatic. Failed preparation retains its cause and saved progress for **Retry job**.
5. Play the finished video from **Jobs** or **Library**. Use **Edit video** for supported final-video edits, **Copy caption + hashtags**, or **Download**. Posting remains manual.

The app's creation presets—not a statement of platform-wide limits—are:

| Preset | Format | Offered lengths |
| --- | --- | --- |
| YouTube full video/song | 16:9 | 2:30, 3:00, 3:30 |
| YouTube Short | 9:16 | 1:00, 1:15, 1:30 |
| Instagram Reel | 9:16 | 0:45, 1:00, 1:15, 1:30, 1:45 |

## Local setup (Windows)

1. Install Node.js and run `npm ci --legacy-peer-deps`.
2. Copy `phoenix.env.example` to `.env.local`, then fill only the settings you need. Never commit keys.
3. Choose your writing provider in Settings. Local writing needs Ollama with `qwen2.5:3b`; the explicitly configured Groq Free-plan workflow does not start or require Ollama. Do not load heavy models while the laptop is short on RAM.
4. For episode transcription, install `faster-whisper` in a Python environment and set `PHOENIX_WHISPER_PYTHON`. Model downloads require internet access on first use.
5. For stock edits, set up MoneyPrinterTurbo and apply the documented local adjustments in [integrations](integrations/README.md). Set `PEXELS_API_KEY` in Phoenix's private `.env.local` for draft search, and configure the backend's Pexels key separately for rendering. Run the backend on `http://127.0.0.1:8080`. The approved-footage picker currently uses Pexels; it is not a Pixabay picker.
6. Run `npm run build`, then `npm start`. On Windows, headless Start uses the same service launcher as the Desktop shortcut: it starts/reuses the selected writer dependencies, MoneyPrinterTurbo, the verified website build and Lumina. It returns after startup; headless background services stay running. Development mode: `npm run dev` starts dependencies first, then the development website and manager.
7. Open [Phoenix Studio](http://localhost:3000). It opens the dashboard directly.

For one-click startup, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1` once. **Phoenix Studio** starts missing services and opens a dedicated Chrome/Edge app profile, with a hidden close-to-stop guardian. Closing this app window stops verified Phoenix-owned work; saved records are retained. If only a default-browser tab can be opened, automatic shutdown is unavailable and a warning explains it. The optional backend is at `Documents/MoneyPrinterTurbo`, or `PHOENIX_MPT_DIR`. No software/model installation or paid service is enabled. Keep the project folder in place; reinstall the shortcut after moving it.

To start without opening another window, run `npm start` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-phoenix.ps1 -NoBrowser`. Repeated starts reuse the existing services. The launcher reads `PHOENIX_MPT_DIR` and `MPT_BASE_URL` from Phoenix's private environment, including `.env.local`, without printing credentials. It checks the renderer protocol and the manager heartbeat, not just open ports. Missing dependencies or readiness failures produce actionable warnings; no installer or model download runs automatically.

**Lumina** is the local production manager in `run-worker.js`: it plans submitted work, advances the local queues and retains final-video review. Startup does not enable the retired daily business-video booster or automatic social posting. The selected local Ollama or configured Groq writer supplies text; MoneyPrinterTurbo renders narrated stock videos. Settings health distinguishes these services and shows the running build. A browser bookmark alone cannot start programs when the server is off—use the Desktop shortcut or `npm start`.

FFmpeg/FFprobe are installed through the npm dependencies, or can be configured explicitly. Source preflight reports missing tools. Children's narration and secure local account storage currently rely on Windows facilities; Docker is not a verified full replacement for this Windows workflow.

Uploads, MP4s, queue state, captions, and feedback live under `storage/Phoenix Studio Review Files`. A Desktop shortcut is available in the library. Keep the PC awake for queued work. Local software avoids provider API bills, but still uses your electricity, storage and internet; third-party free stock services have their own limits.

## Troubleshooting

- **Website opens but jobs remain queued:** the website and worker are separate processes. Run `node run-worker.js --preflight` to check that all processors load without taking a job. Inspect the newest `storage/worker-*-error.log`, then use the Desktop launcher to start missing services. Do not create repeated copies of the same job.
- **Older job says READY but there is no MP4:** the worker resumes older approval-gated plans automatically at startup. Keep the local worker running and check **Jobs** for progress or an actionable failure.
- **Stock search works but approval/rendering fails:** confirm both applications have their own private stock configuration and the backend patch is applied. An old backend missing `PhoenixStoryBeat.assetId` is rejected. Search for a longer clip if the selected asset cannot cover its narration.
- **Video preview fails:** use **Retry preview** or **Download MP4**. Check that Phoenix is still running and the output still exists. The player loads one video at a time and supports byte-range seeking.
- **Desktop opens an older version:** compare Settings health with `storage/active-build.json`, use the current project (not a backup/ZIP), and activate a verified build while jobs are idle. A Git pull does not rebuild or replace an already running website. See staged builds below.
- **Low memory or noisy rendering:** avoid simultaneous builds, renders and model downloads. Local FFmpeg thread counts are bounded and animation rasterization uses one worker with a 24 MB image cache, but this is not a guarantee against system-wide memory pressure from other apps.
- **Automatic song option is unavailable:** this laptop does not meet Phoenix's singing memory guard. Import a sung recording, or use a separately installed local engine on suitable hardware. No paid service is enabled automatically.
- **Instagram rejects a pasted token:** use the masked field in **Settings → Your channels → Connection setup**. Paste a complete access token, not an app secret, URL, curl command or JSON object. Read the specific verification error. A Facebook Login token needs the appropriate linked Instagram professional account/permissions; a direct Instagram Login token does not need a Facebook Page. Never paste a real token into chat or Git.
- **YouTube is not connected:** use **Connection setup**, configure your Web application OAuth client privately, add the exact displayed callback URI and complete consent using the account owning the channel. **Check connection** can renew a saved expired connection. Opening an upload page does not connect or publish to that account.

## Checks

```powershell
node --max-old-space-size=192 --test --test-concurrency=1 scripts/test-channel-connections.cjs scripts/test-channel-connections-ui.cjs scripts/test-groq-writer.cjs scripts/test-stock-editorial.cjs scripts/test-creation-drafts.cjs
node --test --test-concurrency=1 scripts/test-review-library.cjs scripts/test-quality-manager.cjs scripts/test-queue-history.cjs scripts/test-review-workflows.cjs scripts/test-stock-storyboard.cjs scripts/test-creation-drafts.cjs scripts/test-animation-and-delete.cjs scripts/test-worker-startup.cjs scripts/test-natural-stock.cjs
node scripts/verify-kids-animation.cjs --stills-only
node scripts/verify-kids-animation.cjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Automated suites use isolated temporary stores or mocks, not user videos. They cover queue/file integrity, small real FFmpeg exports, media ranges, editing, draft approval and duplicate submissions, exact stock IDs, character rasterization, and deletion/restore behavior. Singing adapter tests use a mock engine; they do not prove a real generated song sounds good. The bundled render tests use Windows executables.

The animation proof script writes local samples under `storage/Phoenix Studio Review Files/work/animation-quality-proof-v4`. Its 12-second video uses instrumental test audio, **not singing**. The `--stills-only` option avoids a video encode. These proof artifacts are not uploaded to Git.

The September 10 live check verified a completed 60-second, 720×1280 children's story, visible queue progress, burned-in captions, saved hashtags, browser playback and recoverable Trash. It did not certify all possible inputs, a complete 49-minute episode, or automatic singing. See [CHANGELOG.md](CHANGELOG.md).

## Staged builds and updates

Next's fallback directory is `.next-lumina`. `npm run build` uses the guarded build helper, creates a new timestamped `.next-build-*` directory and updates the active-build marker only after success. `PHOENIX_BUILD_DIR` can select a separate new staged directory; a directly started server must use that same value.

The Desktop launcher and `npm start` read `storage/active-build.json`, for example `{"directory":".next-build-20261001094026074"}`. They accept only a `.next-...` name with a `BUILD_ID`. This marker is private local runtime state, not committed. After cloning/pulling, run the guarded build once; do not expect Git to contain installed bundles or credentials.

Do not build over the directory used by a running website. Check the build has completed, wait for active jobs to finish, then switch the launcher marker and restart the website/worker. Keep the previous verified build available for rollback. No rebuild or server restart is needed for documentation-only changes.

**Apply Phoenix Update.lnk** runs `scripts/restart-phoenix.ps1 -Rebuild`.
It refuses during active heavy work, stops only identified Phoenix services,
runs the guarded build, then opens the desktop app. A rejected/failed build
restores the last verified website and reports the failure. It does not weaken
memory limits, erase media, upgrade a provider or retry failed jobs. Automatic
execution of a service restart may be blocked by the agent's approval review;
the owner can run this visible helper directly.

## Git and privacy

Runtime media, credentials, databases, builds, logs and Python caches are excluded. GitHub Actions is manual-only. Keep paid-provider credentials out of the local configuration. No paid service or public deployment is required for the local workflows.

GitHub contains application source, tests, examples and the local backend patch—not a backup of your private Review Files folder. Back up that folder separately if you need to preserve uploads, drafts, finished videos and metadata. Never commit filled `.env` files, backend `config.toml`, account tokens, or song/model downloads.

# Phoenix Studio

A single-owner Windows app for creating, editing and reviewing local videos.
The website, worker and native renderer run on this PC. Docker is not required;
putting local files in a container would not move their storage or RAM elsewhere.

## Use the app

Open **Phoenix Studio** from the Desktop shortcut, then use
[the dashboard](http://localhost:3000/dashboard).

- **Clip a Video:** stream a local episode to disk, select coverage or highlights,
  and produce real source-video clips. The original footage is not replaced by AI.
- **Create a Video:** describe an idea or choose a recommendation. Narrated stock
  videos and children's 2D stories use separate rendering paths. Planning finishes
  automatically; review the finished video before posting.
- **Make a Reel:** enter a short, concrete subject, select a starting video and let
  Phoenix assemble related footage. Length follows usable content, not a padded
  duration. Automatic recipes do not slow, loop or freeze shots to fill time.
  Each suggestion batch mixes wildlife, nature, places, movement and everyday
  subjects; it does not scroll through a long country-only block.
- **Jobs** sits below creation. It retains progress, failures and explicit retry.
  **Library** separates generated and confirmed posted videos, with previews,
  posting copy, native editing and recoverable Trash.
- **Settings** holds private writer/channel setup and content-quality feedback.

Available automatic stock sources are Pexels, Pixabay, eligible Wikimedia Commons
and NASA footage. Commons/NASA results require supported rights and source
evidence. These sources share the same Make a Reel flow. Required credits for
existing and new videos are retained; Coverr is not included.
No arbitrary internet video scraping is enabled.

## Writers, captions and quality

Choose Groq Free or Cloudflare Workers AI Free in Settings. Save keys in the app,
not chat or Git, and confirm the free plan. Known quota waits can rotate between
independently configured free cloud writers; exhausted quotas still have limits.
They never silently start a local model or paid provider. Local Ollama is a
separate explicit choice with model/RAM checks.

Posting captions and hashtags are separate from burned-in speech subtitles.
With consent, up to three small sampled frames can be sent to a configured free
vision provider. Phoenix checks the returned evidence and preserves owner edits;
quota or invalid evidence is shown rather than disguised as a successful analysis.
Silent scenic reels do not need invented subtitles.
For narrated videos, sampled frames receive the saved caption window at each
sample time, including late scenes. Missing timing or silent gaps stay unverified;
topical similarity alone is not proof of narration-to-picture synchronization.
These are three limited picture samples, not full-video or audio listening.

New Make a Reel music-only exports use two-pass loudness mastering toward
−16 LUFS, with peak headroom, and measure the actual encoded soundtrack before
marking it ready. This is an export target, not an Instagram requirement or a
claim of musical quality. Existing recipes and original-audio mixes keep their
saved sound; manual edits discard the old measurement until measured again.

New automatic reels use six compact CC0 instrumental recordings bundled with
the app, with rights/source evidence retained. Queue reservations avoid the last
three soundtracks even when requests arrive together; retries keep their saved
recording and native-tempo excerpt. No music-model download, paid API or extra
account is required. See [recording sources](assets/music/lofi-cc0-v1/SOURCES.md).
These are recorded lofi instrumentals, not a claim of current Instagram trends.
Per-reel editing audio uses lossless FLAC at 48 kHz to avoid large PCM copies.
New soundtrack choices prioritize a matching editorial mood over an unused but
mismatched track, while preserving the last-three cooldown and saved retry choice.
New adaptive reels with frame-analysis consent check three tiny samples of the
planned cuts before reserving the final recording. Trim, order, framing and
playback speed determine those samples. The same validated evidence supplies
posting captions; retries retain both the soundtrack and evidence. If free
analysis is unavailable, the queued recording remains and its unverified fit is
recorded. The small instrumental library cannot guarantee a perfect soundtrack.
Commons WebM footage can supply picture duration through its video-stream
duration tag; a longer audio/container duration is never used to extend picture.

Quality ratings supply bounded guidance for matching future work. Supported
Instagram performance metrics can guide experiments after the necessary insights
permission is granted. Collection runs in small background batches; fresh,
age/exposure-comparable measured videos can guide experiments while older history
is still scanning. Incomplete history is labelled, missing metrics remain unknown,
and disconnected/stale data cannot teach new work. No manual rating is required.
For source reels, a sufficiently supported low-watch-time signal can enable a
saved shorter-opening experiment; footage capacity and the meaningful-picture
floor still take priority. Existing recipes are never changed by new statistics.
Neither mechanism retrains a model, edits app code by
itself, proves causation or guarantees views, monetization or income.

Children's animation is lightweight original 2D, not professional anime/3D.
Songs need a real sung recording and matching lyrics on this laptop. The optional
local ACE-Step adapter does not bundle its engine/models and is disabled below
Phoenix's hardware guard; narration is not advertised as singing.

The optional VoiceStudio narration adapter uses the separately installed,
user-approved Supertonic-3 engine (SDK 1.3.1, pinned model revision) for English
and Hindi 2D stories. Local configuration lives in ignored
`storage/voicestudio.json`: `enabled`, `licenseAccepted`, absolute `python` and
`modelDirectory` paths. No model or desktop app is started with the website.
The voice worker uses one CPU thread, runs offline, exits before rendering and
retains measured phrase boundaries for captions. It does not provide phoneme
alignment, singing or music. A low-memory wait preserves the queued request.
Without this optional configuration, the existing Windows story voice remains
available; an explicitly selected Windows voice remains authoritative.

## Posting

Use **Post / export** on a finished video:

- **Instagram:** verified professional-account access and publishing permission
  are required. Reel/Story support, locations, people tags and catalogue audio
  also depend on Meta's eligibility, permissions and available results. A missing
  eligible location or music track is not fabricated. Music suggestions use
  sampled visual evidence and catalogue metadata, not audio listening or BPM
  analysis. Instagram catalogue music is not embedded in the downloaded MP4.
- **YouTube:** complete the channel's OAuth connection in Settings. A channel URL
  or an open upload page alone does not connect it.
- **Rumble upload:** an assisted handoff. **Download & open Rumble** requests the
  existing MP4 download, copies its description and opens the official upload
  page. Copy the title, select the file and review/publish on Rumble. Phoenix does
  not claim upload progress or mark this handoff Posted. Its Rumble panel stays
  open alongside Instagram and does not interrupt Instagram's upload monitoring.
  Phoenix reuses the Rumble window it opened where browser policy permits;
  unrelated manually opened tabs cannot be detected or controlled.
- **Bilibili.tv:** automatic publishing is not connected. No supported free
  account-specific publishing route has been verified.

Only confirmed, matching completed uploads count as Posted. An ambiguous upload
needs checking, not a duplicate submission. Final posting approval remains yours.
The older scheduled Rumble/Bilibili access follow-up is paused.

## Setup and startup (Windows)

1. Use Node.js **24.19.0** and install the locked packages with
   `npm ci --legacy-peer-deps --no-audit --no-fund`.
2. Copy `phoenix.env.example` to `.env.local` and fill only the settings needed.
   FFmpeg/FFprobe binaries are installed through npm, or can be configured there.
3. Episode speech analysis needs Python with `faster-whisper` and
   `PHOENIX_WHISPER_PYTHON`. First use can download a transcription model.
4. Narrated stock creation needs the separately installed, patched local
   MoneyPrinterTurbo renderer. Follow [integration setup](integrations/README.md).
   Its private stock configuration is separate from Phoenix's search keys.
5. Install a verified Windows build, or use the guarded `npm run build` only with
   enough free memory. Run `npm start` for headless startup. Install shortcuts with
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1`.

The launcher reuses the selected website, worker and required dependencies. Cloud
writing does not require Ollama. The dedicated Desktop app window has a guardian
that stops verified Phoenix-owned services when closed; an ordinary browser tab
does not provide that lifecycle guarantee. `npm start` is intentionally headless.
A bookmark cannot start a stopped local server.

Canonical checkout on the owner's PC:
`C:\Users\rishi\Documents\Codex\2026-07-29\cehd\PhoenixStudio`.
The Desktop `PhoenixStudio` folder is a junction to it. Do not run an old ZIP or
backup checkout. Every launcher uses `storage/active-build.json`; confirm its
directory matches `/api/studio-health` before calling a release live.

## Low RAM, files and updates

Work is serialized under shared memory/heavy-work admission. Video uploads and
downloads stream; previews support byte ranges; thumbnail decoding and native
animation are bounded. Local rendering still needs physical RAM. Free cloud
writers reduce local model memory, not the renderer's needs. No cleanup or Docker
setting can promise to solve system-wide RAM exhaustion.

Runtime media, originals, editable masters, captions and queue records live in
`storage/Phoenix Studio Review Files`. Trash is recoverable and still uses disk.
Temporary shot cleanup follows the saved policy; originals and retry/history
records are not silently deleted. Back this folder up separately from Git.

The public **Phoenix Windows update** workflow verifies committed source on a
standard Windows runner without uploading owner media, credentials or models.
It runs serial regressions, Python checks, real isolated FFmpeg/public-footage
proofs, TypeScript and the production build, then creates a hashed installation
archive. Stage it with `scripts/install-phoenix-build.cjs`, then activate it with
`scripts/activate-packaged-build.ps1` only when work is idle. Existing package
validation, rollback and RAM safeguards remain active.

**Apply Phoenix Update** performs a guarded local rebuild/restart. A Git pull or
push alone does not install a running bundle. On a low-memory laptop, prefer the
verified remote archive instead of repeatedly attempting local builds.
Vercel verifies the web deployment separately; it is not a persistent Windows
FFmpeg/voice worker, a backup of local videos, or a replacement local server.

## Verification and troubleshooting

Small, isolated checks can run serially:

```powershell
node --max-old-space-size=192 --test --test-concurrency=1 scripts/test-project-cleanup.cjs scripts/test-local-mutation-boundaries.cjs scripts/test-review-publication-summary.cjs
```

Use the Windows workflow for the full release suite/build rather than starting
parallel test compilers on this laptop. Tests use temporary stores and mocked
providers or explicit public footage, not owner videos or real publishing.

- **Queue not moving:** check Settings health and saved error details. Worker
  `--preflight` loads processors without accepting work. Do not duplicate jobs.
- **Preview failing:** check the server/output exists, then Retry preview or
  download the MP4. Cached thumbnails do not prove the video was rendered.
- **Channel failure:** read the actual permissions/format/error details. Login,
  account identity, upload readiness and successful publication are different.
- **Old editor bookmark:** the retired whole-file browser/WASM editor now links
  to Library's native **Edit video**. Old project files/timelines are preserved,
  not automatically converted. Historical database archive routes are not the
  current production workflow; they are not a public multi-user service.

See [AUDIT.md](AUDIT.md) for the cleanup scope and remaining limits,
[IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) for dated release
evidence, and [integration notes](integrations/README.md) for renderer contracts.
Private settings, tokens, databases, media, logs and generated bundles stay out of
Git. No paid service, upgrade or actual social post is part of a verification run.

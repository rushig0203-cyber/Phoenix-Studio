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
- **Jobs** sits below creation. It retains progress, failures and explicit retry.
  **Library** separates generated and confirmed posted videos, with previews,
  posting copy, native editing and recoverable Trash.
- **Settings** holds private writer/channel setup and content-quality feedback.

Available automatic stock sources are Pexels, Pixabay, eligible Wikimedia Commons
and NASA footage. Commons/NASA results require supported rights and source
evidence. Mixkit Free and Dareful clips can be imported after downloading and
confirming their licence. Required credits are retained; Coverr is not included.
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

Quality ratings supply bounded guidance for matching future work. Supported
Instagram performance metrics can guide experiments after the necessary insights
permission is granted. Neither mechanism retrains a model, edits app code by
itself, proves causation or guarantees views, monetization or income.

Children's animation is lightweight original 2D, not professional anime/3D.
Songs need a real sung recording and matching lyrics on this laptop. The optional
local ACE-Step adapter does not bundle its engine/models and is disabled below
Phoenix's hardware guard; narration is not advertised as singing.

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
  not claim upload progress or mark this handoff Posted.
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

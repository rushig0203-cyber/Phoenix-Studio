# Phoenix Studio

A single-owner Windows app for creating, editing and reviewing local videos.
The website, worker and native renderer run on this PC. Docker is not required;
putting local files in a container would not move their storage or RAM elsewhere.

## Use the app

Open **Phoenix Studio** from the Desktop shortcut, then use
[the dashboard](http://localhost:3000/dashboard).

Create has three dedicated workspaces:

- **[Make a Reel](http://localhost:3000/dashboard#create)** (`#create`): start
  from six templates based on saved videos, confirmed posts and available
  feedback. One click finds related footage and queues a reel; its exact finished
  video opens for review. Interrupted confirmations reuse the saved request.
  **More templates** rotates the choices. **Choose your own topic** opens a custom
  footage search where you can select a reference video. Length follows usable
  content, not a padded duration; automatic recipes do not slow, loop or freeze
  shots to fill time.
- **[Clip a Video](http://localhost:3000/dashboard#create?mode=clips)**
  (`#create?mode=clips`): choose a real source file and one of two suggested
  styles. **Full coverage** keeps the complete episode in natural clips;
  **Best highlights** ranks moments after upload, favoring a clear speech opening
  and complete lines when reliable local transcripts are available. Choosing a
  style only changes the mode; **Process video** starts the upload and processing.
  Find each upload's clips under **Library → Episode clips**.
- **[Create a Video](http://localhost:3000/dashboard#create?mode=video)**
  (`#create?mode=video`): start from five nature mini-documentary ideas, explore
  other categories, or describe your own.
  Selecting an idea fills the form; **Create video** explicitly queues it.
  Ideas refresh on opening the workspace. **More ideas** checks the latest saved
  work. Narrated stock videos and children's 2D stories use separate rendering
  paths. Planning finishes automatically.
  Narration keeps its natural speaking speed and ends with the story or
  explanation. Song exports use the complete recording within the chosen format's
  upper limit. Review the finished video before posting.
- **Jobs** sits below creation. It retains progress, failures and explicit retry.
  **Library** has Generated, Posted and Episode clips views with previews,
  posting copy, native editing and recoverable Trash. Episode folders use the
  uploaded filename and retain posted clips and edits with their source episode.
- **Insights** shows saved Instagram results, Facebook Page Reel counts and basic
  YouTube counts for confirmed Phoenix uploads. Open a posted video to see its
  matching result, or open the Rumble creator dashboard from its tab.
- **Settings** holds private writer/channel setup and content-quality feedback.

Shared startup-style activity covers loading, tool checks, preparation, uploads
and connection checks. Percentages appear when measured progress is available;
secondary explanations stay in disclosures while errors and retries remain visible.

The video review opens its posting controls directly at a verified available
destination. Check the visible destination, posting text, visibility, soundtrack
and optional tags/location, then use the final **Post** button. Less common edits
stay in **Posting details**. Opening a review or changing destinations never posts
a video. Instagram, Facebook Page and YouTube can remain open together as
independent rows in one posting area, each retaining its own draft and progress.
Existing upload requests retain their saved approval and duplicate protection;
Rumble remains an assisted upload rather than an automatic connection.

Available automatic stock sources are Pexels, Pixabay, eligible Wikimedia Commons
and NASA footage. Commons/NASA results require supported rights and source
evidence. These sources share the same Make a Reel flow. Required credits for
existing and new videos are retained; Coverr is not included.
Create a Video uses Pexels footage and may use a labelled CC0 or public-domain
Wikimedia Commons photo for a scene that can be illustrated with a still.
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
Silent scenic reels do not need invented subtitles. New Create captions can
start with a short, complete line from their own narration or lyrics. Report
captions retain the source and identify illustrative visuals. New report plans
try relevant neutral catalogue searches while preserving the saved narration
and selected clips. When suitable footage is missing, a section can use an
original editorial 2D illustration, visibly labelled **Illustration**.
Court reports prefer unbranded legal objects, such as a gavel or documents,
rather than a stock courthouse, flag or judge standing in for the reported
jurisdiction. Stock remains illustrative context, not verified event footage.
The fallback depicts neutral objects or infrastructure, without invented people,
flags, event photos or statistics. It uses the existing renderer and offline voice,
not a new image model or unlicensed internet photographs. These are original static
illustrations rather than full animation. Older saved news recipes keep their
original visual policy and approved choices.
New news reports use a concise bulletin: one development, its necessary context
and a complete qualified ending. Smaller white subtitles with a light outline and
no background box sit above social controls. Short phrases follow measured speech events;
no spoken qualification is deleted to shorten a caption. News speech is synthesized
at a modestly brisk rate, without post-production stretching. Random background
music is disabled for reports so it cannot contradict the subject or mask narration.
For narrated videos, sampled frames receive the saved caption window at each
sample time, including late scenes. Missing timing or silent gaps stay unverified;
topical similarity alone is not proof of narration-to-picture synchronization.
These are three limited picture samples, not full-video or audio listening.

Requesting **Re-analyze this video** records a separate, bounded caption
improvement signal for the manager. It retains your manual reviews, rejects
the same rejected caption when choosing replacement copy, and guides future
matching creations toward a natural audience-facing angle. Queue/quota waits
retain that feedback; initial background analysis does not count as a complaint.

New Make a Reel music-only exports use two-pass loudness mastering toward
−20 LUFS for quiet instrumentals or −16 LUFS for livelier recordings, with peak
headroom, and measure the actual encoded soundtrack before
marking it ready. This is an export target, not an Instagram requirement or a
claim of musical quality. Existing recipes and original-audio mixes keep their
saved sound; manual edits discard the old measurement until measured again.

New automatic reels use eleven compact CC0 instrumental recordings bundled with
the app, with rights/source evidence retained. Queue reservations avoid the last
three soundtracks even when requests arrive together; retries keep their saved
recording and native-tempo excerpt. No music-model download, paid API or extra
account is required. See [recording sources](assets/music/lofi-cc0-v1/SOURCES.md).
Five are gentle acoustic guitar, piano or ambient recordings. The others are
livelier instrumentals.
Per-reel editing audio uses lossless FLAC at 48 kHz to avoid large PCM copies.
New soundtrack choices prioritize a matching editorial mood over an unused but
mismatched track, while preserving the last-three cooldown and saved retry choice.
New adaptive reels with frame-analysis consent check three tiny samples of the
planned cuts before reserving the final recording. Trim, order, framing and
playback speed determine those samples. The same validated evidence supplies
posting captions; retries retain both the soundtrack and evidence. If free
analysis is unavailable, the queued recording remains and its unverified fit is
recorded. New automatic recipes start with a quiet instrumental; saved visual
evidence can select a livelier recording when the subject calls for it. Peaceful
low-energy footage keeps the quiet pool and softer fades. Short picture cuts alone
do not raise its music energy. The small library cannot guarantee a perfect soundtrack.
Within that catalogue, the selected mood takes priority over the repeat cooldown.
If every suitable track is recent, Phoenix reuses the least recent suitable one
instead of choosing an unrelated mood. Saved soundtrack recipes stay fixed.
New recordings also use offline-measured low-frequency attacks from the exact
bundled files. Within the matching, available catalogue, the final cut pattern
guides the recording excerpt. Nearby cuts can move by at most four picture
frames inside genuine source/movement windows; total duration, playback speed,
source framing and sampled visual evidence stay valid. This aligns to measured
attacks, not an inferred musical downbeat or a promised beat-perfect edit. It
adds no model or audio scan during normal rendering. Legacy saved recipes keep
their original offsets. The compact nine-track library still limits musical variety.
Commons WebM footage can supply picture duration through its video-stream
duration tag; a longer audio/container duration is never used to extend picture.

Instagram catalogue recommendations rank supported mood/energy fit before trending
membership. A trend only breaks an equal-fit tie. An animal or train alone does not
prove playful or adventurous music, and serious/devotional observations do not
receive a cheerful scenery-based fallback. Original songs and narrated/news outputs
keep their finished soundtrack. No track listening, beat synchronization or perfect
musical fit is claimed for Instagram catalogue tracks. Existing footage without
the new timing marker searches a fitting original recording as well as current
Meta trends and a relevant instrumental, within the same three-request limit.
Guided meditation/sleep utilities are excluded from automatic Reel choices.
New timing-matched or quiet-instrumental reels keep their mastered soundtrack through Instagram posting
and matching Stories, so the reviewed preview is not replaced by differently timed
catalogue music. Original songs and narration keep their saved audio as before.
Automatic Instagram people tags recognize specific animals and scenery in saved
visual observations and choose relevant profiles from the existing checked pool.
Each video's identity varies the combination while repeat approval and saved
upload requests retain their tags. Instagram still decides tagging eligibility;
the posting status distinguishes requested tags from tags sent.
The dashboard pairs a navy navigation rail and an aurora header with a cream
workspace. Create actions fit on one row on phones, and the queue status links
to Jobs. An optional locally supplied portrait JPEG with its horizon on the
right edge can be placed at `storage/ui/studio-wallpaper.jpg` (maximum 512 KiB).
The main Create banner shows the picture by itself, with queue status beside the
creation controls. Put the optional brand picture at `storage/ui/studio-logo.jpg`
(maximum 512 KiB). Both images stay on this PC. Hosted or fresh installations use
the navy backdrop and Phoenix initial. Insights keeps each platform separate.
Instagram provides measured results and manager guidance. Facebook refreshes
basic Page Reel counts using the existing Page connection. YouTube refreshes
views, likes and comments for up to 25 confirmed Phoenix uploads using the
existing read permission. Missing counts remain unknown. Detailed YouTube
analytics are in YouTube Studio. Use the Rumble tab to open its creator dashboard.
Posted Library videos open their exact confirmed Instagram, Facebook or YouTube
publication in Insights. Only comparable Instagram results currently guide
suggestions, alongside saved video feedback.
Job rows show a compact progress bar and percentage when measured, with failure
details collapsed. Hourly housekeeping soft-archives local failed history after
seven days; originals, finished videos and protected publishing journals stay saved.
Locked stores wait for a later idle pass. Active or uncertain provider work is
excluded from this cleanup.
Create a Video and Make a Reel suggestions reconsider saved work every 15 days,
when reopened and when you choose **More ideas** or **More templates**. Confirmed posts, recent visual subjects,
structured story/visual feedback and fresh comparable Instagram results guide
relevance. A posted edit contributes to the original video's topic, and multiple
versions count as one piece of evidence. Recently posted
subjects and the last 48 shown ideas are excluded when possible. Each concise
card explains its basis; a longer creation premise stays optional. No extra model
or provider search is used to load suggestions. Unavailable browser storage keeps
history only for that visit. Report refresh bypasses the short news cache without
inventing headlines when the source has not changed. Changed creation selections
use a new request identity, and saved requests cannot silently return an older topic.
Earlier custom narration, visual searches and lyrics remain saved when the topic
changes, but stay inactive for the new idea until the corresponding field is edited.
See [the free-media source audit](docs/FREE_MEDIA_SOURCES.md)
for researched libraries, their access limits and which workflows actually use them.

Quality ratings supply bounded guidance for matching future work. Supported
Instagram performance metrics can guide experiments after the necessary insights
permission is granted. Collection runs in small background batches; fresh,
age/exposure-comparable measured videos can guide experiments while older history
is still scanning. Incomplete history is labelled, missing metrics remain unknown,
and disconnected/stale data cannot teach new work. No manual rating is required.
For source reels, a fresh low-watch-time signal can enable a saved attention
experiment. Eligible new requests test four related native-speed shots against
the existing montage; the four-shot version ends naturally without twelve-second
filling and can open with a native portrait shot verified from decoded dimensions.
The selected reference stays in the reel. Greenery validation retains its larger
source pool. UUID assignment stays fixed on retries; manual and saved recipes
remain unchanged. Insights shows the measured watch diagnosis and collects
separate outcomes only for exact published outputs carrying an experiment marker.
Comparisons require mature posts in the same age/exposure band; historical
unlabelled posts are not controls, and no view or engagement improvement is assumed.
Neither mechanism retrains a model, edits app code by
itself, proves causation or guarantees views, monetization or income.

Children's animation uses lightweight original 2D with a limited cast, settings
and props. In **Create a Video**, describe a new Krishna story to let the
selected writer plan it. Choose one video or a ten-part series under **Output
quantity**. Under **Explore suggestions → Starter examples**, **Krishna and
the Butter Pot** and **कृष्ण और मक्खन की मटकी** remain optional standalone
stories with eight authored visual beats. A standalone starter with blank
story text skips the writing provider. The Hindi starter requires the
installed VoiceStudio voice.
Songs can use an uploaded sung recording or the official free hosted
[ACE-Step service](https://huggingface.co/spaces/ACE-Step/ACE-Step). Hosted
generation requires permission to send the description and lyrics; video and
reference-audio files are not uploaded. It uses shared free GPU access without
loading a music model on this laptop. Free quotas and service availability still
apply, with no paid or local-model fallback. Saved task IDs and completed audio
destinations prevent an uncertain retry from creating another song. Choose
English or Hindi. Leave lyrics blank to have your selected writer create
original verses for the idea, subject to its quota and memory limits. Phoenix
suggests a musical direction based on the topic, which you can change under
**Song options & engine details**. For your own recording, supply the exact
words sung. Listen to the result before posting. The optional local ACE-Step
adapter remains subject to the existing hardware guard. Songs require
recorded or generated singing.

The optional VoiceStudio narration adapter uses the separately installed,
user-approved Supertonic-3 engine (SDK 1.3.1, pinned model revision) for English
and Hindi speech. Local configuration lives in ignored
`storage/voicestudio.json`: `enabled`, `licenseAccepted`, absolute `python` and
`modelDirectory` paths. No model or desktop app is started with the website.
The voice worker uses one CPU thread, runs offline, exits before rendering and
retains measured phrase boundaries for captions. It does not provide phoneme
alignment, singing or music. A low-memory wait preserves the queued request.
Without this optional configuration, the existing Windows story voice remains
available; an explicitly selected Windows voice remains authoritative.

Approved visual scenes retain available measured speech boundaries, and the
animation holds its previous pose through pauses. Estimates remain labelled when
measurements cannot locate a boundary. Animation action planning currently needs
English scene text for open-ended prompts. The authored Hindi Krishna starter has its own matched visual beats.

## Posting

Library cards show a small cover from inside the finished MP4 when its
duration is known. Select the cover to open the video preview. These covers
are used in Phoenix's Library.

Use **Post / export** on a finished video to expand its posting controls in
Library. Choose a destination, review the caption and posting options, then
use its final Post or Upload action. **Close** collapses the controls.
Instagram, Facebook Page and YouTube show separate icons and progress rings in
one posting area. Select a platform to see its draft, recover an upload or open
a completed post. New Instagram posts start as Reel only. Choose **Also publish one
matching Story** before posting when you want both. Rumble keeps its assisted handoff
in the same posting area.

- **Instagram:** verified professional-account access and publishing permission
  are required. Reel/Story support, locations, people tags and catalogue audio
  also depend on Meta's eligibility, permissions and available results. A missing
  eligible location or music track is not fabricated. Music suggestions use
  sampled visual evidence and catalogue metadata, not audio listening or BPM
  analysis. Instagram catalogue music is not embedded in the downloaded MP4.
- **YouTube:** complete the channel's OAuth connection in Settings. The app needs
  a Google Cloud web OAuth client, YouTube Data API access and its exact callback
  `http://localhost:3000/api/channels/youtube/callback`. Then authorize the actual
  channel account. A channel URL or an open upload page alone does not connect it.
  New requests default to **Public**; Private and Unlisted remain available in
  Posting details. Checking status keeps your chosen visibility. Existing saved
  requests retain their approved setting, so continuing an older Private request
  keeps it Private. Review requested and YouTube-confirmed visibility separately.
  Google Cloud requires 2-Step Verification; an account-verification rejection
  must be resolved on Google's side before credential setup can continue.
  Request only `youtube.readonly` and `youtube.upload` for this workflow. An
  expired short-lived access token with proven upload permission and a saved
  refresh grant stays eligible for the final Post action, which renews access
  and checks the saved destination again. Opening a screen does not refresh
  credentials. A rejected grant or disconnected account remains blocked.
  The public [About](https://phoenix-studio-theta.vercel.app/about),
  [Privacy](https://phoenix-studio-theta.vercel.app/privacy) and
  [Terms](https://phoenix-studio-theta.vercel.app/terms) pages describe this
  personal installation and its Google data handling.
  An external Google app left in Testing receives a seven-day refresh token for
  these scopes; normal token refresh cannot extend that account policy. Complete
  production configuration and any required Google verification before relying
  on long-lived unattended access. See
  [Google's OAuth expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).
- **Facebook Page:** connect only the Page already verified as linked to your
  Instagram account. The same Meta app needs `pages_show_list`,
  `pages_read_engagement` and `pages_manage_posts`, and the authorizing person
  must be able to create Page content. Settings verify this before saving a
  separate protected Page connection. For a Page linked to a Meta business
  account, [Meta also requires](https://developers.facebook.com/docs/graph-api/changelog/version17.0/)
  `business_management` and a user role on that business for Page discovery.
  This scope permits broader Business Manager read/write access and needs
  explicit authorization; Phoenix uses it to identify the linked Page.
  The saved Meta app credentials exchange
  the User token for up to 60 days; Phoenix records Meta's actual expiry.
  **Post to Facebook Page** reviews the public destination and saved MP4 before
  queuing. Current [Meta Reel specifications](https://developers.facebook.com/documentation/video-api/guides/reels-publishing)
  require portrait 9:16, 3–90 seconds, at least 540 × 960 and 24–60 fps.
  Phoenix probes the file before accepting it; incompatible files are not
  silently trimmed or stretched. Its saved audio is used, without Instagram
  catalogue music, people tags, location or companion Story settings. Uploads
  stream from disk, and interrupted or uncertain publishing checks the retained
  video ID instead of creating a duplicate. An interrupted transfer resumes only
  at the byte offset Meta confirms for that same upload. A returned finish acknowledgement
  does not count as Posted until Meta confirms publishing completion.
- **Rumble upload:** an assisted handoff. **Open Rumble & show saved video**
  reveals the existing MP4 in Windows File Explorer, copies its description and
  opens the official upload page. Drag that file onto Rumble, paste the text and
  review/publish there. No duplicate download is created. Phoenix does
  not claim upload progress or mark this handoff Posted. Its Rumble panel stays
  open alongside Instagram and does not interrupt Instagram's upload monitoring.
  Phoenix reuses the Rumble window it opened where browser policy permits;
  unrelated manually opened tabs cannot be detected or controlled. Showing the
  file requires Phoenix on the same Windows PC; Download MP4 remains available.
- **Bilibili.tv:** automatic publishing is not connected. No supported free
  account-specific publishing route has been verified.

Only confirmed, matching completed uploads count as Posted. An ambiguous upload
needs checking, not a duplicate submission. Final posting approval remains yours.
The older scheduled Rumble/Bilibili access follow-up is paused.

## Setup and startup (Windows)

Verified desktop releases include a compiled queue worker, so normal startup
does not need the TypeScript compiler. Development uses the source worker.
Queue memory safeguards and automatic Instagram feedback remain enabled.

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

The compiled worker avoids loading TypeScript at runtime and checks physical
job-file versions before rereading unchanged completed histories. Pending work
keeps its normal polling. Its Node old-space allowance is 192 MiB; this does not
cap total process or whole-laptop RAM. Existing admission guards remain active.

The first November 1 update reduced startup overhead, but an idle worker later
grew to 256.8 MiB. After the history-polling fix, a November 5 observation took
31 identity-checked samples over about 16 minutes: the 29 idle samples used
85.02–95.5 MiB private memory. A separate 47-second idle interval read about
4.3 MB instead of the earlier 95.3 MB. This verifies sustained idle-worker
improvement over that interval; long rendering peaks and other apps still matter.

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

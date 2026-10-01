# Phoenix Studio release notes

These notes distinguish shipped code from demonstrated output. No release here is a guarantee of artistic quality, audience growth, or earnings.

## 2026-10-01 — Desktop lifecycle and current-project consolidation

- Dedicated app browser/guardian stops verified Phoenix-owned background work
  on window close; preserves saved work and unrelated/shared applications.
- Canonical path, shared lifecycle mutex, process start/command identities and
  atomic session writes protect reopen and PID-reuse cases. Seven mocked
  startup/lifecycle tests passed; live window-close validation remains pending.
- Older Desktop checkout was retained as a backup; its usual path now points to
  the current project. Shortcuts and future-agent instructions use one project.
- Apply Phoenix Update performs an idle-only guarded build/restart with the
  previous verified bundle retained on failure. Five mocked restart regression
  tests passed. No memory guard was weakened.
- Blank optional stock descriptions work; edited exports retain subtitle off/style
  without losing editable timed cues. Seventy-four focused app tests passed.
- Source is updated locally. A staged bundle was verified on temporary port 3001,
  but normal-port activation and the final small frontend rebuild are pending.

## 2026-10-01 — Posting copy from footage and conditional subtitles

- Visible captions/hashtags, copy controls and manual platform-upload links on
  completed outputs, including stock reels and edited files.
- Optional three-frame Groq visual analysis produces per-output posting text,
  retains citations, flags sampled script/visual conflicts and shows quota waits.
- Source subtitles now require confident speech; stock titles stay in posting
  metadata. Missing speech analysis is explicit and does not invent subtitles.
- Unchanged source retries retain analyzed copy. Frame extraction yields to heavy
  jobs and uses bounded images, one decoder thread and no local vision model.
- Added repair-record word-sense guards and a bounded renderer timing correction
  for slight measured narration/shot mismatches.
- Live vision analysis succeeded on three existing outputs. Production activation
  remains pending; existing MP4s have not been silently re-rendered.

## 2026-10-01 — Prompt-first creation (activated locally)

- Removed the creation-kind dropdown; collapsed inspiration and optional briefs.
- Moved routine health details to Settings; added completion navigation and direct
  playback from finished Jobs cards.
- Added optional, attributed BBC World report research with bounded source fetching,
  freshness checks and explicit single-source/illustrative-footage limitations.
- Improved limited 2D jump motion, reaction continuity and observer poses without
  increasing the frame rate or adding a model.
- 72 focused tests and the production build/typecheck passed. Live report fetching,
  collapsed creation controls and playback from Jobs were verified in the browser.
  Website/manager/renderer are running on the updated build. No new complete
  creative video has been accepted; singing/animation quality limitations remain.

## 2026-09-16 — Quality foundations (implementation in progress)

- Shared script/shot/asset preparation for new stock creation and regeneration;
  checkpoints retain selected footage across interruption. Legacy selected asset
  IDs are resolved without replacement searches.
- Versioned review artifact references preserve clean editing inputs and real
  timed captions. Source clip artifact folders use immutable IDs, not rank/order.
  The legacy reversed-highlights lookup is corrected without changing user media.
- Stock backend retains a clean master by copying the uncaptioned picture and
  exact final audio streams. Caption/mix metadata reflects actual saved artifacts.
  Required artifacts are downloaded and validated before new jobs become ready.
- Different pending edit requests return an explicit conflict; square exports
  keep square metadata, and editor navigation points back to Library.
- Manager uses the production publishing range rather than an exact target and
  includes preparation failures/resource-blocked source jobs in queue totals.
- Verification:92 app tests and15 backend storyboard/artifact tests passed. These
  include real small FFmpeg fixtures, not a complete new creative-quality video.
- Separate `.next-quality-foundation` production build passed with a640MB heap;
  stored active build was not switched during this foundation checkpoint.
- This is not the final plan acceptance: see IMPLEMENTATION_PROGRESS.md. No paid
  service, model installation, posting, user-media deletion or Git upload occurred.

## 2026-09-14 — Smaller source-video subtitles

- Follow-up: removed the separate Ideas navigation item. Creation forms now show six type-specific recommendations, a More ideas action and per-type local rotation between visits, replacing two fixed suggestions.
- Incomplete local shot lists receive one bounded schema-constrained repair. Asset selection expands the same query across additional results and orientations before reporting no suitable footage; relevance, length and duplicate checks remain in force.

- Reorganized the dashboard into separate Create, Ideas, Jobs, Library and Settings screens with persistent desktop/mobile navigation, section bookmarks and preparation-aware queue counts.
- Removed the visible plan editor, manual finish control and intermediate approval gate. Creation submissions—including older API clients—always proceed automatically; the worker resumes legacy waiting plans once without reviving archived or repeatedly failed jobs.

- Replaced implicit SRT styling with an explicit output-sized ASS canvas. Source clips now use a restrained font (30px at 720x1280), two-line cues and a lower safe-area position instead of oversized text over the footage.
- Retained downloadable SRT caption text and bumped the render signature so safe retries cannot reuse an old caption layout.
- Corrected the one-minute waterfall review example while preserving its original exports in a local backup. No source footage or audio was replaced.

## 2026-09-13 — Automatic creation, final review only

- Added a visible Pexels/Pixabay-to-reel workflow that streams real source footage into the local processing queue. Preserves usable audio, uses a local music bed otherwise, adds descriptive captions/copy/hashtags, and retains provider provenance without AI visuals or narration.
- Added a balanced 42-idea, 10-category explorer to the dashboard and manager, with editable arbitrary topics/searches and local-history rotation. General video is now the creation default; 2D remains an optional category.
- Business/general writing now consumes matching structured manager feedback; stock visual guidance no longer uses animal-only rules.
- New creations plan, select exact footage and queue rendering automatically. Only the finished video needs human review before manual posting. Legacy drafts can use **Finish automatically**; scene editing remains optional.
- Durable per-scene selection and idempotent render dispatch resume failed/interrupted work without duplicating finished jobs. Automatic script locking is not recorded as owner approval.
- Stock selection filters short, repeated and visibly described off-topic catalog results; it ranks metadata relevance, aspect fit and contributor continuity. Writing and shot prompts keep one concrete example and consistent setting. These are editorial/metadata heuristics, not verified frame-level understanding.
- Added explicit query/narration mismatch checks (including the saved training/chatbot/follow-up swaps) and one bounded local repair before failing with an actionable cause.
- Story animation uses finer sentence cues, differentiated acting/listening poses, and persistent tangled/held/flying kite states. Narration no longer makes both characters alternately pretend to speak.
- A recovered preparation-monitor connection clears its stale connection error without discarding action errors.
- No paid service added. Existing videos are not rewritten; the changes apply to new renders. Singing and general animation-quality limitations remain.

## 2026-09-10 — Storyboard approval and detailed 2D rendering

Application commits: `8bac56c` and `a014c46`.

### Added

- Persistent, editable creation drafts before rendering, with actual footage or character-pose previews and explicit approval.
- Exact approved Pexels asset IDs in the local backend patch; unavailable or too-short footage fails rather than being replaced.
- Local-only ACE-Step adapter with health checks, durable task identity, bounded status retries and a conservative memory guard. Engine/model installation and real singing on this laptop remain unavailable.
- Worker startup preflight and a launcher check for immediate worker failure.
- Regression tests for drafts, duplicate approvals, stock selection, character rasterization and single-confirmation deletion.

### Improved

- Original 2D artwork: fuller character shapes, eyes and facial reactions, paws/feathered wings, stitched overalls, detailed flowers, cottage/fence scenery, and distinct room, night and ocean settings.
- Four-second reusable motion cycles at 12 fps, one raster worker and a bounded image cache. Kite-related narration retains its kite instead of becoming an unrelated letter prop.
- Recoverable Trash with one confirmation, duplicate-click protection, immediate hiding of deleted cards, and Undo/Restore.
- Local staged-build selection through the Desktop launcher's private active-build marker.

### Verification performed

- Production build, type checking and targeted lint passed. A 512 MB build heap was too small for type checking; the final local build passed with a 640 MB heap and one build worker. This is a test result, not a universal memory requirement.
- The 29-test combined draft/library/worker/animation suite passed during the release work; the six animation/delete tests were rerun after the final artwork and deletion changes.
- All seven character types rasterized in both output orientations. A 12-second instrumental animation proof rendered 144 distinct frames.
- A live original children's story completed at 60 seconds, 720×1280, with captions, saved posting metadata and hashtags. Browser playback reached a playable state and advanced in time.
- The test story was moved to recoverable Trash and restored; its output remains available. Existing user exports were not regenerated.
- Pexels search, a real stock preview, saved editorial changes and approval gating were exercised in the browser. Exact-asset rendering behavior has backend regression coverage; this release did not complete a new full stock-video render from its saved draft.

### Still limited / not certified

- Automatic singing on the current 8 GB laptop; no genuine generated song was demonstrated.
- Fully scene-specific professional animation, precise lip synchronization, or reliable automatic visual-quality judgments. Story/caption and finished-video review remain necessary.
- Every possible source input, including a complete 49-minute episode, was not re-tested in this release.
- Social account consent and posting remain owner actions. No paid service, public deployment, or automatic publisher was added.

## 2026-09-09 — Desktop launcher and timed stock storyboards

Application commit: `e68d45d`.

- Added the Windows Desktop launcher with local-service reuse and a Chrome app window.
- Added narration-section stock storyboards and caption-timed backend assembly.
- Kept local source processing, original children's creation and stock-footage processing separate from paid provider workflows.
# September 21, 2026 — startup and editorial reliability

- Windows `npm start` and the Desktop shortcut now use the same local service
  launcher for the website, Lumina submitted-job manager, Ollama and MoneyPrinterTurbo.
  Readiness checks distinguish missing/incompatible services; Python logs use UTF-8.
- Dashboard service health exposes manager heartbeat, renderer compatibility,
  configured model availability and the active build without exposing credentials.
- Added cross-process reservation tests, stale-observation protection and local
  origin guards for source job mutations.
- Narrated creation plans three candidate angles and a structured outline before
  writing. Editorial attempts retain exact-quote evidence and failures; style
  warnings are distinct from hard blockers. No independent fact-checking or
  automatic quality/monetization guarantee is implied.
- These changes are not a completion claim for animation, singing, mixed-media
  timelines or the full real-video acceptance plan.

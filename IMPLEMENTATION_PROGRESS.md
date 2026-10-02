# Quality-first implementation — September 16, 2026

## October 2: original channel-quality work (not yet activated)

- Travel/cartoon public profile artwork was inspected. Individual reel playback
  required Instagram login, so reference motion/audio was not evaluated. The
  objective is attractive original content, not copies or guaranteed growth.
- Stock source changes add one to six ordered trimmed shots, portrait-first
  search, conservative near-native crop/full-frame fitting, original ambience,
  optional quiet local instrumentals and brief transitions. All source credits,
  clean edit masters, deterministic outputs and shared streaming byte limits are
  retained. Silent outputs no longer get an unwanted boxed posting-title overlay.
- New original rigs, finite action/reaction/holds and measured character speech
  replace repeated sine-wave mouths. One Windows process assembles small PCM
  utterances with an 8 KiB buffer. Native 16 kHz avoids the legacy .NET resampling
  clock mismatch; real tests also exposed voice-change clock resets. Absolute
  offsets now come from written samples. No new model or paid provider was added.
- Caption starts use measured word events when every token matches. Natural
  brief captions merge without rewriting speech; unmergeable short cues are
  recorded for review rather than aborting an otherwise valid story. Songs and
  unavailable speech timings remain explicitly estimated, not forced alignment.
- Manager direction preserves visual constraints and requires named fixed-cast
  dialogue in prompts. Automatic story planning is checkpointed before writing;
  isolated tests prove quota resume without repeated planning and final-only
  dispatch. Series no longer bypass this planning when writing is available;
  explicit local offline composition remains. Owner-locked scripts stay verbatim.
- Actual manager trials exposed unsupported plans and ambiguous attribution.
  Automatic child plans/narration now receive conservative production checks and
  speaker-labeled JSON. Rejected content is checkpointed before one bounded
  correction; quota waits resume that correction without a new outline. Strict
  Groq output is used only for fully closed schemas. A provider validation error
  was observed in isolated trials; successful output is not a reliability guarantee.
- Submitted source/generation/edit/planning/posting workflows use one bounded FIFO
  dispatcher. Heartbeat and resource checks remain independent, including live
  external progress. Empty/RAM-blocked media queues return promptly. Crashed ordinary
  leases recover without releasing live children or uncertain model/external work.
  A waiting song can be passed by eligible bounded Groq text planning. Sharp cache
  is cleared before encoding; music avoids a duplicated PCM/header buffer. No new
  dependency/model/paid VM was added and no memory safety threshold was lowered.
- Full project semantic TypeScript checking passed after these integrations.
  148 focused story/visual/stock/queue/editor/dispatcher tests passed; a later
  63-test monitor/settings/queue recheck and seven admission regressions also passed.
  These suites overlap; their totals are not a unique-test count.
  Actual stock fixture: 3.000 seconds, 720×1280, 72 decoded frames, preserved
  landscape edge markers and quiet source tone. It is not real travel footage.
- Latest actual-manager story: 71.8 seconds, H264/AAC, two installed voices,
  440 unique raster frames, measured caption/viseme timing and editable master.
  Node parent observed peak 158 MiB RSS, minimum observed system free RAM
  1,223 MiB. These observations are not a process-group RAM bound, measured
  optimization gains or a full listening review. The automatic writer's final
  script passed current production checks; this is not a singing proof.
- Earlier authored-fixture visual samples revealed premature kite untangling,
  missing final flight and a stretched non-owner reach. Those corrections now pass
  raster/contact tests. Four snapshots from the actual-manager MP4 show complete
  characters, petals, retained knots during attempts and a final airborne kite.
  Full motion/listening and real travel-reel acceptance remain outstanding.
- Ports 3000/8080 were absent when checked; an existing Ollama server remains
  untouched. No service was stopped and no failed production job was retried.
  The guarded production build declined at 1,374 MiB free after bootstrap versus
  its 1,664 MiB requirement; no compilation started or active bundle was replaced.
  Last verified bundle remains `.next-build-20261001094026074`. Worker changes load
  from source on the next canonical launch; no live-worker activation is claimed.
  Website source changes still need a safe build. Do not weaken the memory guard
  or claim a finished release from source, snapshots or isolated tests alone.

## October 1: disconnected dashboard recovery

- The app browser and guardian were alive while registered website, worker and
  renderer processes had exited. The desktop session record remained. Available
  logs do not identify the exit cause; no RAM crash or window-close cleanup is
  inferred. Missing services were started without terminating the app or retrying
  failed video jobs. All six dashboard data endpoints returned HTTP 200.
- Fixed the launcher early "already open" exit: service health, matching fresh
  worker heartbeat, installed/running build identity and current guardian revision
  must match. Missing dependencies are repaired while reusing the existing window.
- Guardian v2 uses native process-lifetime/window checks and indexed descendant
  inventory every ten seconds. Timestamped logs identify exits, close cleanup and
  recovery attempts. Recovery is bounded to three attempts, requires the same
  verified open session, 768 MiB free RAM and no active/unknown heavy-work lease.
  Missing/released leases permit recovery; corrupt/external/model reservations
  block it. Recovery does not build, preload models or explicitly retry failed jobs.
- `reload-desktop-session.ps1` activated guardian v2 (PID 11788) with browser PID
  17932 and existing services retained. Old guardian PID 15872 exited naturally;
  new guardian logged readiness with an empty error log. No actual service-failure
  or close-trigger shutdown was executed; recovery safety is covered by mocks.
- Dashboard source now collapses six network errors into one actionable offline
  notice. Saved snapshots remain explicitly stale, connection retry is GET-only,
  creation/preparation mutations are disabled offline, polling avoids overlap,
  pauses hidden pages and backs off to fifteen seconds. Cleanup aborts do not
  update unmounted state. Twenty-four focused monitor/navigation/startup/lifecycle/
  rebuild tests passed; the final preparation-control regression also passed in
  a ten-test monitor/navigation recheck.
- Website still serves `.next-build-20261001094026074`. The frontend error-message
  change is NOT in that bundle yet. Free memory remains below the guarded build
  threshold; no unsafe rebuild was started. Script changes are live without a
  website rebuild. Private settings, videos, logs and runtime records stay out of Git.

## October 1: desktop shutdown and canonical project consolidation

- Desktop launch uses an isolated Chrome/Edge profile and hidden guardian.
  Closing the app debounces for about 5–7 seconds, then stops verified owned
  dispatchers/dependencies and observed descendants. PID, start time, executable
  and command hash are checked; shared/unregistered servers remain untouched.
  Queues, source files and finished videos are retained. Headless mode is unchanged.
- Atomic session writes, token-specific logs and a shared canonical-root mutex
  prevent an old guardian from stopping a replacement desktop session. Shutdown
  captures direct children created at the close boundary using retained parent
  handles. Snapshot tracking is not a guarantee for unobserved detached children.
- The old Desktop checkout had unique staged edits. It was moved recoverably to
  `Desktop/PhoenixStudio-old-backup-20261001`; `Desktop/PhoenixStudio` is now a
  junction to the current July 29 project. Desktop shortcuts use that canonical
  project. AGENTS.md documents release/launch/privacy checks for future agents.
- Current known Phoenix renderer identities were registered without stopping
  them. No live desktop close/shutdown was executed. Seven focused lifecycle/
  startup tests passed using fake process stoppers, including reused PID,
  unrelated Ollama protection, close-boundary children and junction resolution.
- Buyer fixes: optional stock description can be blank; edited copies preserve
  subtitle off/style with editable cues retained. Seventy-four focused application
  tests passed, including these isolated export/reopen regressions.
- Local bundle `.next-build-20261001094026074` passed production compilation and
  type checking before the final buyer/desktop follow-ups. Temporary port 3001
  confirmed visible specific copy/tags/platform handoff and an actual 720×1280
  waterfall player with readyState 4 and no media error; test server/tab closed.
  The normal port 3000 still serves the earlier bundle until activation. The final
  UI follow-ups need the guarded build; no low-memory build was forced.
- Updated Apply Phoenix Update helper performs an idle-only guarded build and
  activation, retaining/restoring the previous verified bundle on failure.
  Five isolated mocked restart tests passed, including build-failure recovery,
  busy-job rejection and holding the lifecycle mutex through recovery/startup.
  Automatic service termination was rejected even after owner consent; no other
  kill method was used to evade that rejection. Owner-run helper remains available.
- Owner ran Apply Phoenix Update and reported completion. Live verification now
  confirms port 3000 matches the selected `.next-build-20261001094026074`, Lumina
  has a new healthy heartbeat, the renderer is ready, the dedicated browser and
  guardian identities are live, and all three service roles are registered.
  No newer build was selected: the final small frontend source follow-ups remain
  pending a safe guarded build. At verification only 207 MiB free was reported;
  no additional build/render was started. Live close/reopen has not been tested.

## October 1: posting analysis and conditional subtitles

- Posting actions are visible on all completed-output surfaces. Platform handoff
  is manual; no publication was performed.
- Owner authorized sending up to three small sampled frames to the existing Groq
  Free account. Permission is persisted and can be disabled in Settings. Live
  model access was verified, and three existing finished videos received distinct
  copy from real frame analysis. This does not validate the full video.
- Source subtitles are selected per clip from confident local speech, with explicit
  none/uncertain reasons. Stock metadata is no longer converted into speech text.
- Added durable vision quota waits, output identity, independent posting status,
  nonblocking heavy-work admission and retention on unchanged source retry.
- Fixed explicit repair-record/timber and missing-part/shipping-label mismatches.
  Renderer handles measured shortages up to 2.5% with bounded visual slowing and
  frame-count verification. No failed generation job was retried during this work.
- Focused app tests and 25 backend storyboard tests passed, including actual
  small MP4 rendering. The staged production build passed; final buyer follow-up
  build and activation on the usual port are pending, as detailed above.

## October 1: simpler creation and sourced news (activated)

- Prompt-first creation replaces the four-kind picker. Existing internal workflows
  remain; conservative prompt keywords choose them. Suggestions and narration/visual
  brief are collapsed by default, and routine service health is Settings-only.
- Active-to-completed job transitions open Jobs; completed job cards open the existing
  video player directly. Historical completion on first load does not steal navigation.
- Added on-demand BBC World feed suggestions, a ten-minute in-memory cache, fixed
  source allowlist, redirect rejection, bounded response streams and a full-text gate.
  The selected report reaches brief/narration/editor prompts; stale research blocks.
  No arbitrary client URL or client-supplied research is accepted. Source attribution
  and illustrative-visual disclosure are checked, and output copy/metadata retain
  source/date/limitations. This is single-source assistance, not independent checking.
  No source video download, automatic publication, model download or paid API added.
- 2D v6 adds grounded jump anticipation/flight/landing and emotion continuity. Named
  observers retain listening poses. Existing frame rate and memory limits stay intact.
  Rasterized character/settings tests and a three-pose contact-sheet inspection passed;
  this is not an end-to-end finished-video quality acceptance.
- Verification: 72 focused tests passed (navigation/SSR, news parsing/fetch limits,
  drafts, editorial corrections, creative planning, animation/delete and build safety).
  Full production build, including the final observer/API guards and TypeScript
  checks, passed. A live read-only BBC check returned
  22 recent reports and 5,538 characters of article text. No news video was generated.
- First build admission refused at 1,378 MiB free; after owner closed unused apps,
  guarded production build completed. Active bundle is `.next-build-20260930204405758`.
- Activation: verified website/worker processes were restarted while all queues were
  idle; renderer was reused. Browser checks confirmed collapsed creation options,
  no category picker, no routine health panel outside Settings, 22 live news choices,
  report selection without submission, and Watch video controls on finished Jobs.
- October 1 afternoon resume: services had stopped since the previous session.
  `npm start` restarted the verified bundle, manager and renderer without rebuilding
  or resubmitting jobs. Health reports the new bundle, healthy worker and ready renderer.
  Opened the existing potter video directly from Jobs; actual video and burned captions
  played in the browser, and a bounded media request returned HTTP 206/video-mp4.
  Closed the player to release decoding resources; website remains running.
- Two existing jobs now have completed outputs (children's story and potter). This
  proves those files exist/play, not that their scripts/art meet full quality acceptance.
  No new generation or news job was submitted during these activation checks.

### Previous cleanup and fresh generation test checkpoint

- At the owner's request, old active content was cleared recoverably: nine videos
  moved to Trash, five drafts archived, and one AI/two source history entries archived.
  Project, settings and reusable assets were preserved. This was not disk erasure.
- One new potter test was attempted and retried once. It did not produce a video:
  first an editorial rewrite exceeded the word limit; then review evidence validation
  failed. One questionable factual detail also means the narration was not accepted
  as a demonstrated quality result.
- Editorial v4 now resolves evidence IDs to exact saved narration excerpts and gives
  an oversized rewrite one bounded length correction plus re-review. Targeted mocked
  tests pass; no claim that a live new generation has succeeded after these fixes.

## September 30: low-RAM planning, cached stock shots and activation

### Follow-up: potter failure diagnosis and quieter health UI

- Inspected saved draft `ace428ab-6edb-43f1-bc48-1011ee3e24f8` (A potter shaping clay). Writing completed, but editorial review validation failed for `causalOrder` before stock selection/rendering. The saved record retains narration and the validation error, not the raw offending model response; missing evidence, non-verbatim evidence and field-length violations cannot be distinguished retrospectively. This is not evidence of a RAM/render failure or proof that the narration itself failed causal reasoning.
- Follow-up fix implemented on explicit request: each malformed editorial review receives at most one validation-guided correction. Specific field/type/quote/length errors guide the correction; the narration is unchanged, rejected attempts are saved, exact quotations remain required and genuine meaning failures still block. Provider, settings, quota and transport errors propagate without a content-repair retry. Existing bounded narration rewrite remains separate.
- Verification: 60 targeted tests passed across editorial correction, draft processing/admission, Groq transport and worker startup. Includes correction exhaustion, causal-order evidence recovery, precise field guidance, malformed JSON, unchanged narration, persisted failed attempts, downstream meaning rejection and provider/quota errors during correction.
- Worker activation completed after the owner stopped the old worker manually. `npm start` launched the updated source-loaded worker and reused the existing website/backend; live health confirms a healthy worker and compatible renderer ready. All four queue-store SHA-256 hashes match their pre-start values. No saved job was retried or new video submitted. The earlier automatic stop had been rejected by execution policy; no alternative termination method was attempted.
- Routine health details and writer settings are now Settings-only in source; other screens show compact service/memory warnings with a Settings link. Background polling is unchanged. Nineteen navigation/resource regression tests passed.
- UI activation pending: the guarded build refused to start for insufficient free RAM. Existing website/worker/backend were left running; the visible health panel still uses the previous production bundle.

- Groq draft writing and catalogue-metadata selection no longer acquire the local heavy-render lease. Local Ollama takes that lease before opening its writer session; audio generation and actual rendering retain their existing guards. Provider changes fail closed, quota waits preserve progress, and failed final-mode drafts are not automatically retried.
- Added isolated admission tests for low available RAM, an existing render lease, local lock ordering, song admission, provider changes, serialization and preserved failed jobs. Corrected the fixture narration length rather than weakening production validation.
- The stock backend now optionally reuses content-addressed clean encoded shots. Cache keys include source content/offset, cumulative output frame count, dimensions and encoder identity. Streaming hashes, a 256 MiB/512-file/seven-day disk budget, integrity checks and cache-miss fallback bound its cost. This is visual-shot reuse, not per-scene narration repair or a final-output quality guarantee.
- Cold worker startup now waits up to 45 seconds for the matching fresh heartbeat and detects an exited process instead of reporting readiness after a fixed short delay.
- Verification: 86 app tests and 27 backend tests passed, including a real two-second FFmpeg encode/decode and cross-task reuse check. The backend integration patch was regenerated and reverse-checked against the reviewed allowlist.
- Recovered the earlier test-isolation mistake by removing only its eight identified fixture records. The new suite changes to a temporary workspace before module imports and refuses to run against another review root. Both live draft and generation stores matched their original SHA-256 baselines before activation.
- Started the installed production website, updated source-loaded worker and updated Python backend without a heavyweight frontend rebuild. Live checks returned dashboard HTTP 200, healthy Lumina heartbeat and compatible renderer ready; Groq is configured (no new live generation or account-tier verification performed).
- No saved failed job was retried and no new real video was submitted. Final video quality/singing acceptance remains unverified. Physical RAM and provider quota can still delay appropriate stages; the unnecessary cloud-planning RAM gate is removed, not all resource constraints.

## September 28: creative-planning validation fix

- Confirmed saved Groq credentials and model access; the two existing drafts had passed the local-writer RAM gate but failed the audience field's eight-character minimum.
- Audience labels now accept bounded, nonempty text (including `general`); all other descriptive and semantic validation remains in place. The prompt requests specific intended viewers instead of echoing a creation category.
- Invalid returned outlines receive one bounded, validation-guided correction in the same provider session. Quota, configuration, and transport errors are not swallowed or retried as content failures. Exhausted validation reports concise field guidance.
- Regression verification: 26 tests passed across creative planning and Groq transport, including short audience labels, invalid values, one-attempt repair bounds, saved-plan reuse, quota propagation, and no fallback.
- Per the owner's latest instruction, no saved jobs were retried and no new videos were started. These tests do not establish finished-video quality or end-to-end rendering acceptance.
- At the time, activation was pending because the idle-worker restart was blocked by execution policy. The September 30 restart above activates the worker-side fix; no heavyweight website rebuild was needed for that path.

## September 27: optional Groq writing to address local RAM admission

- Added explicit Free-plan-confirmed Groq text adapter and private localhost setup field. Groq is opt-in; no credential is committed or returned in responses.
- Routed creative brief, narration, editorial, storyboard and children's writing through a provider-fixed session. Groq never enters local model memory admission and does not silently fall back to local templates/providers.
- HTTP 429 preserves queue work using a shared, key-scoped cooldown; partial/invalid responses are rejected. Schema and editorial validators still apply.
- Key/model access is checked before saving activation. No content generation in connection tests; account billing tier cannot be API-verified. Local video RAM safety remains unchanged.
- Startup skips optional Ollama in Groq mode; health distinguishes configured from verified readiness.
- Live content quality and rendering still require a real key and a completed sample review. Do not treat mocked provider tests as a live video acceptance result.

Goal: execute the agreed quality-first plan, not merely pass the existing tests.
This checklist is an implementation log, not a completion certificate.

## Locked product decisions

- Free services/local processing only; no paid fallback or heavy model installation.
- One mixed recommendation pool across practical skills, food, crafts, nature,
  everyday science, hobbies, workplace situations, fiction, and children.
- Mixed visuals: relevant stock video/photos, original diagrams, worked examples,
  and lightweight original 2D. Do not substitute unrelated stock clips.
- Automatic planning; only finished-video approval. Preserve owner scripts and
  completed exports; regeneration creates a new revision.
- Repair weak source audio first; replacement is allowed, with original retained
  and a visible warning when speech is replaced.
- No guaranteed views, earnings, factual correctness, or autonomous model training.

## Requirements and evidence

- [ ] Shared durable create/regenerate/retry pipeline: structured brief → outline →
  script/editorial attempts → measured narration → validated mixed visuals → render
  → actual output checks → final review. Policy/model/feedback fingerprints.
- [ ] Broad six-at-a-time recommendations, mixed audiences, semantic repetition
  memory, audience tags and corresponding content safeguards.
- [ ] Useful script checks: topic meaning, evidence, contradictions, promised
  content, leakage, repetition, hook and complete payoff. One rewrite/re-review;
  persist attempts; separate hard blockers from subjective warnings.
- [ ] Versioned feedback consumed by writing, footage, narration and captions;
  transparent check results rather than deceptive quality percentages.
- [ ] Provider-qualified video/photo assets, actual intervals and evidence; safe
  crop/fit; coherent fallback diagrams; provenance/licences; backend capabilities.
- [ ] Typed 2D actor/object/action/state timeline, non-kite continuity, native720p,
  complete anatomy, cause/action/reaction rather than indefinite motion loops.
- [ ] Measured speech timings, bounded tempo, correct song alignment, truthful
  voice engine labels, mood-tagged licensed music, normalization/ducking.
- [ ] Source audio repair/replacement decisions with original retention; actual
  caption/music artifact validation; accurate copy and semantic hashtags.
- [ ] Canonical editable artifacts for every workflow; immutable clip identity;
  stock caption replacement; edit fingerprint conflicts; square metadata/navigation.
- [ ] Durable cross-process heavy-work lease, resource admission and recovery;
  low-memory defaults, no concurrent builds/models/renders, idle model release.
- [ ] Unified health/progress/ETA confidence/stall states; compatible backend;
  consistent publishing-duration contract; free-provider request allowlists.
- [ ] Additive migrations, diagnostics with build/policy versions, separate build,
  service startup, backend patch and accurate docs; no private data in Git.
- [ ] New regression coverage for all audited failures, concurrency, recovery,
  artifact integrity, missing outputs, UI preview/trash/edit flows.
- [ ] Twenty brief evaluations across eight topic families with recorded defects.
- [ ] Five real sequential comparison exports: practical, food/craft, sourced
  nature/science, diagram-led, and children's story. Full shot/audio/caption review.
- [ ] Real long episode coverage, middle-clip interruption/resume and every output
  preview/download (requires a suitable available local source).

## Baseline

- September15 read-only audit: existing84 tests passed. Those tests do not prove
  editorial quality or the new uncommitted editorial gates.
- Stored active build `.next-inline-ideas` predates the editorial changes.
- Current uncommitted work belongs to this workspace; preserve it and review it.
- Automatic singing remains unavailable on this8GB laptop; supplied recordings
  are supported, and synthetic test tones do not prove singing quality.

## Implementation log

- September16: resumed from current files; first changes target immutable artifact
  identity/edit safety and consistent production paths. Remaining requirements
  above are still open until supported by current tests and real output evidence.
- Implemented: shared stock preparation for draft and generation entry points;
  saved exact IDs/checkpoints; explicit versioned editing artifacts for source,
  children, stock and edit copies; new backend artifact protocol with lossless
  clean-master mux; streamed/validated actual captions and audio; legacy highlight
  index repair; edit fingerprint conflict; square aspect and navigation fixes;
  manager publishing-range and preparation/blocked-job counts.
- Evidence:92/92 app regressions, backend storyboard/artifact tests, including
  actual small FFmpeg master/audio-copy and edit tests. A512MB TypeScript check
  exhausted its heap; the standalone640MB check passed before the final shared
  preparation changes. The separate `.next-quality-foundation` production build
  then passed compilation, full TypeScript, page generation and build tracing at
  a640MB heap. It has not been made the active release.
- Backend patch regenerated from an explicit file allowlist and reverse-check
  passed. No user media was modified, no paid calls, no model downloads or Git
  push. Stored active-build marker is unchanged; no service restart yet.
- An additional backend HTTP-response test confirms artifact references become
  valid task download URLs without changing private task state. Backend combined
  suite now contains15 tests; rerun recorded at this checkpoint.
- Next: finish the cross-process heavy-work lease and resource/health diagnostics;
  then structured broader briefs/editorial evidence and mixed-media production.
  Do not mark the whole goal complete based on the foundation tests.

### September 21 continuation

- Added cross-process resource tests (including real second-Node-process exclusion,
  dead-owner/live-child handling, external reservation retention and stale-probe
  races), malformed-state guards, nested-admission rejection and visible worker
  health. Source upload/delete/retry now require same-origin local mutation calls.
- Evidence at this checkpoint:104/104 full app tests passed and standalone
  TypeScript passed. These do not certify the remaining memory-stage admission,
  build integration, orphan tracking or true media quality requirements.
- Extended local editorial review to require exact narration excerpts and reasons,
  retain failed/successful attempts through queue checkpoints, distinguish soft
  warnings after one rewrite, and invalidate cached verdicts on model/policy/
  feedback/brief changes. Seven focused tests pass; owner scripts remain unchanged.
- Added a local structured creative brief: three distinct candidate angles, selected
  explanation/comparison/demonstration/worked-example/story structure, ordered
  points and promised payoff. Removed the compulsory one-setting fictional-example
  writing/rewrite instruction. Three focused mocked-model tests pass. Real model
  evaluation and creative-output comparison are still outstanding.
- Unified Windows npm start with the desktop launcher; developer startup now checks
  dependencies too. Launcher loads allowed settings from private env files, waits
  for compatible MoneyPrinterTurbo/Ollama responses, verifies Lumina's heartbeat,
  and preserves Unicode Python logs. Six startup/service-health tests pass.
- Lumina here is the submitted-job production manager; the old database-backed
  daily business-video booster and autonomous posting remain disabled. Startup
  does not download models or install software. Live service probes report missing
  model, incompatible renderer and offline states separately.
- A fresh `.next-client-readiness` build is being verified; do not infer activation
  or live startup success from this in-progress entry. Full requirements remain open.
- Follow-up evidence: that build passed and was activated. Live startup reports
  Lumina, Ollama and the compatible stock renderer healthy. Repeating npm start
  retained website PID16804, renderer11012, Ollama17384 and worker8760: no duplicate
  services. Archived missing renderer tasks now persist a terminal resource marker
  without reviving hidden jobs; the live heavy-work reservation was released.
- Removed conflicting general/business feedback and visual-planning instructions
  that forced every topic into one setting/character story. Bounded optional
  feedback choices now affect planning, narration review and rewrite; revisions
  include the policy and actual choices, and narrated exports retain guidance.
  Notes remain inert review records. Removed the duplicate ideas panel in Manager.
- Added per-model/context memory admission before active local writing calls.
  Queues retain saved work and wait30 seconds without consuming failed attempts;
  children's generation cannot swallow that wait and substitute a template.
  Cold-model requirements include weights, context, runtime and OS headroom.
  At roughly1.3–1.5GB free, this laptop was not admitted to load the1.93GB model.
  No actual model-quality evaluation or new full creative render occurred here.
- Focused writing/feedback regressions passed34/34 before resource integration.
  The integrated full run passed135/136; the sole failure was an obsolete test
  demanding the fixed single-setting prompt. Its replacement asserts conditional
  continuity plus comparison freedom; a fresh full run is still required.

### September 25 — existing editor and RAM repairs (not deployed yet)

- Fixed the interrupted heavy-work module syntax error; its import now succeeds.
  Detached writer reservations and exited child processes are covered by tests.
- Connected active local writing to one nested session: brief/script/editor/shot
  planning share a runner, then unload Phoenix-owned weights before footage/render.
  Cached plans issue no model calls. Raw narration is saved before editorial work.
  Model memory admission remains conservative; this does not make a 3B writer fit
  in a few hundred MB of free RAM or unload unrelated users' models.
- Source silence scans now disable video decoding; source input decoding is capped
  at one thread. Transcription extracts sequential 300-second audio windows with
  5-second context, word-boundary ownership, validated checkpoints and resume.
- Editor repairs: no zero-length added captions; visible save/export feedback;
  immediate accepted-job display; bounded, scoped progress polling; persisted
  export drafts; decoder cleanup on close. Missing legacy clean masters remain
  explicitly non-editable for baked captions, not silently advertised as editable.
- Evidence: 18 resource/lock tests passed; 50 writing/session/queue tests passed;
  18 Python window tests passed before the small per-window progress callback was
  added; 7 actual component-handler editor tests passed. The real edit regression
  rendered playable captioned copies with original hashes unchanged. The remaining
  review suite was stopped when available RAM fell to ~180 MB (Chrome ~2.9 GB).
- No new build was created or activated. `storage/active-build.json` still selects
  `.next-client-readiness`. Full typecheck, remaining tests and browser verification
  of the rebuilt editor are still required. No paid services or model downloads.

### September 25 — editor/RAM update activated

- Follow-up editor/component and actual FFmpeg workflow suite passed 18/18;
  bounded Python transcription suite passed 18/18 including the progress change.
  Startup/build safety tests passed 5/5. No new paid service or model download.
- First build compiled but the 640 MiB TypeScript heap limit was insufficient.
  Build preparation now removes only obsolete generated Next type includes,
  preserving owner source includes/settings; it uses an 896 MiB heap with a
  1664 MiB free-memory admission floor. Type checking remains enabled.
- Full production build and typecheck passed. Active build is now
  `.next-build-20260925140552047`; startup reports healthy Lumina, local Ollama and
  compatible MoneyPrinterTurbo. Website and worker use 512 MiB Node heap ceilings;
  ordinary startup reuses the production bundle without compiling it. The desktop
  launcher sets single-thread render/transcription defaults and below-normal priority.
- Browser verified: current library loads, children's clean-master caption editor
  opens, Add caption at a full timeline gives a useful non-destructive error, and
  Save draft returns “Draft saved on this PC.” Existing caption content was retained.
- The queued photography creation remains waiting for the configured 3B writer's
  ~3397 MiB cold-load estimate. Low-RAM handling is safe retry, not a claim that
  a large model can fit in 1 GB. General animation/singing/content-quality acceptance
  remains open; this entry verifies the editor/RAM update, not the entire product.

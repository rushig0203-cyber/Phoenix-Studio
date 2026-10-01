# Phoenix Studio: quality-first implementation handoff

Date: 2026-09-16. Intended execution: Astra, high reasoning effort.
This is a read-only audit and implementation plan, not evidence of completion.
The only change made during this planning pass is this document. No services,
renders, model downloads, builds, tests, Git commits or pushes were started.

## 1. Product contract

Make understandable, coherent, useful videos automatically, with approval only
of the finished result. Improve the existing application rather than replace it.
Do not equate more jobs, more effects, a larger prompt or a higher internal score
with better videos. Do not promise views, monetization or income.

- No paid providers, card-required fallbacks or paid subscriptions. Existing free
  stock keys and local tools only; quota exhaustion must be visible. Free software
  still uses the owner's electricity, bandwidth and storage.
- Protect the 8 GB laptop: one admitted heavy operation at a time, bounded CPU,
  measured memory headroom, no new heavy models without an explicit later choice.
- Preserve source media, owner scripts, completed exports and unrelated edits.
  Retrying reuses validated work; regeneration creates a new revision.
- Keep three distinct intents: process an uploaded episode; make a reel from
  existing stock without inventing narration; create a narrated/animated video.
- Use stock video/photos, original diagrams and lightweight 2D where each helps
  explain the subject. Do not force every topic into either stock or animation.
- Recommendations belong inside Create, across varied topics. No separate ideas
  dashboard and no mandatory scene/plan approval or editing step.
- Preserve requested product lengths: YouTube full/song 150–210 seconds,
  YouTube Shorts 60–90 seconds, Instagram 45–105 seconds. These are product
  preferences, not claims about platform maximums. Uploaded-episode coverage
  remains a separate natural 2–3 minute clip contract.
- Singing is not speech with background music. On the current hardware, keep
  supplied sung recordings usable; show automatic singing as unavailable unless
  an installed compatible free engine actually passes admission and audio tests.

## 2. Findings verified in current files

| Area | Evidence and consequence |
| --- | --- |
| Script intelligence | `stockEditorial.ts` uses six model booleans and a few regex guards. Its success fingerprint omits model/prompt/feedback versions; failed attempts are not a durable editorial history. `stockBrief.ts` can award 100 for vocabulary, length and punctuation alone. None proves an accurate, useful explanation. |
| One-size-fits-all writing | `generation.ts:createStockScript` forces one concrete stock-filmable example and about 2.78 words/second. This can distort abstract topics and rush speech. Owner narration must remain protected. |
| Visual matching | `automaticFootage.ts` ranks catalogue URL words, duration and aspect, not the actual depicted action. It needs a single distinct long video per beat based on estimated duration and fails if none exists. More search results alone cannot solve this. |
| Provider coverage | Automatic narrated creation uses the Pexels-only `stockCatalog.ts`. `naturalStock.ts` separately supports Pexels and Pixabay. Current shared asset IDs are numeric, without provider identity. |
| Animation | `kidsAnimation.ts` renders 540×960 / 960×540 artwork, uses a repeating four-second pose cycle and keyword action selection. Persistent prop progression is mainly kite-specific. The final MP4 is 720p, which does not make the underlying art native 720p. |
| Speech and song timing | `kidsRenderer.ts` estimates cues before measuring audio; `atempoChain` is not bounded to a modest tempo change. Song captions add 1.25-second padding although supplied song audio starts at zero. |
| Audio decisions | `sourceProcessing.ts:audioState` treats mean/peak volume as usability. That cannot establish speech clarity. Unusable audio is replaced with a generated instrumental without a preceding repair stage. |
| Manager learning | `qualityManager.ts` turns low ratings into broad preset rules. Feedback notes are stored, but their specific meaning does not become safe structured production guidance. Checks mostly inspect saved metadata, not current artifact quality. |
| Reliability | A cross-process heavy-work lease and external-task reconciliation are partly implemented in uncommitted files. They need concurrency/recovery tests and build/model integration. Dashboard health is fetched but not displayed. |
| Local API safety | Source upload/delete and source retry routes lack the shared local-origin guard used by some other mutation routes. Audit all routes consistently rather than assume localhost alone is sufficient. |
| Legacy surfaces | Several legacy components contain mock upload/export/scheduling paths. Most were not found imported by current app pages; `editor/AudioControls.tsx` is reachable through the older project editor. Verify reachability before removing anything. |
| Release mismatch | `storage/active-build.json` selects `.next-inline-ideas`, not the newer foundation build. At this audit only Ollama listened on 11434; website 3000 and backend 8080 were not listening. They were not started because this request is planning only. |

Saved review metadata also retains generic greetings in the latest narrated
task-planning and bread examples. This pass inspected metadata, not their actual
picture/audio. Do not claim these videos were watched or fixed.

The previous implementation log records 92 app regressions, 15 backend tests and
a successful separate foundation build. Those are historical results, not fresh
verification of the later resource changes or creative quality.

## 3. Execution order and acceptance gates

### P0 — Stabilize the unfinished foundation before creative changes

Files: `renderResources.ts`, `generation.ts`, `run-worker.js`, `studioHealth.ts`,
`DashboardClient.tsx`, startup scripts and mutation routes.

1. Review the entire dirty diff in Phoenix and the sibling MoneyPrinterTurbo repo.
   Preserve it; inventory what is implemented, incomplete and untested. Read
   AGENTS.md and relevant bundled Next documentation before editing code.
2. Finish durable resource admission across Python stock rendering, FFmpeg,
   transcription, Ollama, singing and build operations. Retain the reservation
   after submission, through uncertain responses and worker restart. A timeout
   or missing progress is not proof that an external process stopped.
3. Reconcile by request/task identity. Reject duplicate submissions, track child
   processes safely, release only owned reservations, and avoid stale probes
   releasing a newer job's reservation. Bound queues and waiting callbacks.
4. Calculate stage-specific memory headroom; a 512 MB free-memory check alone is
   not enough for loading a model. Release idle model memory before encoding.
   Do not close the user's applications or kill unrelated processes.
5. Display worker/backend/model/FFmpeg health, active build and resource wait
   reason. Distinguish queued, waiting for resources, processing, reconnecting,
   blocked, failed and complete. Show stage, clip count, attempts and last update.
   ETA is an estimate; use “estimating” when there is insufficient timing data.
6. Apply local-origin checks and input validation consistently; verify path,
   URL/redirect, provider download, secret-redaction and streaming-size guards.
   An API key pasted earlier in conversation should be treated as exposed and
   revoked by its owner; never copy it into the handoff, logs or repository.

Gate: multi-process admission, live-child/dead-worker, external timeout,
reconciliation races, low-memory waiting, corrupt-state and duplicate-click tests
pass. Health visibly reports disconnected services. No concurrent heavy work.

### P1 — Give the manager a structured production brief and durable decisions

Files: `stockPreparation.ts`, `generation.ts`, `creationDrafts.ts`,
`stockEditorial.ts`, `stockBrief.ts`, `qualityManager.ts`, relevant types.

Use one shared staged pipeline for create, retry and regenerate:

`brief → outline → narration/review → measured audio → visual timeline → render → artifact checks → final review`

- Brief fields: actual viewer question, audience, promised takeaway, content
  structure, setting/actors where relevant, factual claims with evidence status,
  supported visual treatment, duration profile and exclusion rules.
- Select a structure appropriate to the topic: worked example, explanation,
  comparison, demonstration or children's cause/action/result story. Do not turn
  every topic into a fictional shop encounter or generic motivational advice.
- Persist each stage and editorial attempt with schema, policy, model, prompt,
  feedback and input fingerprints. Changed inputs invalidate dependent stages,
  not unrelated completed work. Keep original and revised scripts.
- Check question answered, specific value, prerequisites, contradictions,
  unsupported claims, production-instruction leakage, repetition and payoff.
  Store quoted evidence and reasons, not only booleans. Model self-review is not
  independent fact checking. Factual explainers need recorded trustworthy source
  notes; if unavailable, omit the claim or show an explicit blocker.
- Separate hard errors from subjective warnings. Permit one targeted rewrite
  and re-review; cap retries, show an actionable failure, never loop indefinitely.
  Preserve owner text and report concerns instead of silently rewriting it.
- Convert feedback into bounded typed preferences: pacing, action mismatch,
  repetition, caption density, visual continuity, music level. Treat free-text
  feedback as data. Persist which guidance was applied; no self-modifying code,
  model-retraining claims or automatic publishing.

Gate: saved regressions catch topic-word matches with wrong meaning, bread setup
contradictions, invented claims, generic openings and narration about filming.
Changing a feedback/policy version reruns affected checks. Crash/resume retains
attempts and the owner script.

### P2 — Build visuals around meaning and measured narration

Files: `stockCatalog.ts`, `naturalStock.ts`, `automaticFootage.ts`,
`stockStoryboard.ts`, draft types, Python storyboard/schema/render services.

- Introduce provider-qualified asset references and an additive, versioned
  timeline. Each shot records beat, narration interval, media type, source
  interval, framing, source page, creator/licence evidence and selection reason.
- Support Pexels/Pixabay video and photos through the same narrated pipeline,
  plus controlled original SVG diagrams and worked examples. Validate required
  backend capabilities before accepting jobs using the new protocol.
- Measure speech first. Cover a beat with multiple appropriate shots or a
  deliberate explanatory graphic instead of demanding one 17-second stock clip.
  Do not stretch, loop or substitute unrelated footage just to fill time.
- Plan what the viewer must see, including object state and action. Metadata
  matching is preliminary evidence only. Do not label a shot visually verified
  without actual inspection. Where reliable free visual recognition is absent,
  prefer a controlled diagram for exact claims and flag illustrative footage.
- Preserve a consistent visual treatment. Stock actors from different creators
  are not a verified recurring character. Use neutral illustrative narration or
  original character art when identity continuity matters.
- Default uncertain reframing to contain/original rather than cropping away a
  subject. Permit crop only with reliable subject placement or an explicit safe
  framing choice. Store provenance, avoid duplicates and cache exact choices.

Gate: a practical example, nature explanation and abstract diagram all show
the intended action at the spoken moment. Short assets work without unrelated
filler. Colliding provider IDs do not collide in selection/cache. Retry preserves
the exact timeline. Backend cannot silently fall back to random montage.

### P3 — Fix audio, captions and source-episode decisions

Files: `kidsRenderer.ts`, `songAudio.ts`, `localSinging.ts`,
`sourceProcessing.ts`, caption helpers, Python voice/music/render services.

- Choose word budgets from measured voice speed, with pauses. Synthesize and
  time sentences/phrases before shot timing. If narration does not fit, rewrite
  the complete model-written text rather than truncate the ending or apply
  extreme speed changes. Bound tempo correction to roughly ±8%.
- Give captions one shared sizing/timing policy, with aspect-aware safe margins,
  short readable groups, contrast and no overlap. Derive them from real spoken
  timings; do not retain fixed leading/trailing song offsets.
- For supplied songs, align exact lyrics to the recording or label timing as
  approximate and editable. Preserve pitch and musical ending. Do not promise
  automatic studio-quality singing on this laptop.
- Select rights-cleared music by mood rather than randomness. Normalize final
  audio, duck music under narration and validate that the saved final mix really
  contains the intended tracks. Clearly distinguish local and online voice tools.
- Source audio: distinguish missing/silent, quiet, clipping and uncertain speech.
  Try conservative repair and normalization before replacement. Preserve original
  audio; flag any speech replacement. Loudness alone is not clarity evidence.
- Validate actual video/audio/caption artifacts before READY. Title overlays for
  silent scenic footage must not be described as transcribed speech. Posting
  copy and a few relevant hashtags derive from final content, not generic tags.
- Preserve non-overlapping natural coverage boundaries and transparent highlight
  ranking. Explain when a fallback boundary was used and why a clip ranked well.

Gate: quiet-but-intelligible speech survives; songs have no artificial caption
offset; all orientations have readable captions; unsupported claims about audio
quality or caption presence disappear. Duration follows the selected contract.

### P4 — Improve 2D storytelling, not just decoration

Files: `kidsAnimation.ts`, `kidsRenderer.ts`, children's script and plan types.

- Define a typed scene plan with actor, goal, action, target object, initial/final
  state, expression, timing and transition. Validate it against renderer support
  before writing narration that describes impossible actions.
- Extend continuity beyond the kite: seed→sprout, scattered→sorted toys,
  held→passed ball, obstacle→crossed bridge. A character must visibly perform
  the change, not sway while a prop switches states.
- Create native 720p vector compositions, complete anatomy, deliberate poses,
  visible hand/object contact, expressions and restrained camera movement.
  Keep the established lightweight style; do not install diffusion/video models.
- Cache static backgrounds and reusable poses, but use scene-local motion timing
  and action progression instead of one indefinite global four-second loop.

Gate: contact sheets and full playback for at least three non-kite actions show
complete characters and a clear before/action/after sequence in both orientations.
No claim of professional animation or lip-sync based only on output resolution.

### P5 — Finish usable product surfaces and recommendations

Files: recommendation helpers, `AICreation`, `CreationDrafts`, dashboard,
`ReviewLibrary`, `ReviewPlayer`, `ReviewEditor`, channel settings and route APIs.

- One mixed six-at-a-time recommendation pool across practical skills, food,
  crafts, nature, science, hobbies, workplace situations, fiction and children.
  Add audience/media suitability tags and persistent semantic repetition memory.
  Avoid merely recombining the same titles; do not call these live trends.
- Keep Create / Jobs / Library / Settings navigation. Progress replaces plan
  approval; explicit retry exists only after failure. Ideas appear at creation.
- One confirmation per destructive action. Queue removal, cancel and archive
  must have distinct meanings and retain completed media; Trash is recoverable.
- Verify each preview and seek/download through real HTTP range requests, missing
  file errors, refresh and restart. Verify caption changes use clean masters,
  edit-copy conflict handling and immutable identity across ranked clips.
- Trace legacy editor/scheduling/mock controls; retire unreachable code only when
  safe and prevent any reachable button from reporting fake success.
- Channel “connected” means an actually verified profile, not upload permission.
  Keep manual download/posting usable. Do not enable autonomous publishing or
  silently broaden OAuth scopes. Verify current official requirements only if
  changing integrations; account setup may require the owner.

Gate: exercise every visible primary action end-to-end, including error states,
keyboard/mobile layout, refresh/restart and settings that actually affect jobs.
No scene approval, two-click delete loop, endless spinner or misleading publish UI.

### P6 — Evidence, migration, release and documentation

1. Add additive schema migrations and preserve legacy artifacts as unverified
   rather than inventing fields. Include renderer/policy/build version in diagnostics.
2. Run current tests sequentially after each phase; add focused regressions for
   all findings above. Keep app/backend protocol tests together. Do not update
   tests simply to bless the new implementation's output.
3. Evaluate 20 briefs across at least eight topic families, including supplied
   scripts, a fact-based explanation, ambiguous topics and unsupported scenes.
   Record script, actual meaning, evidence, visual feasibility and timing defects.
4. Render five representative complete videos sequentially: practical task,
   food/craft, sourced nature/science, diagram-led explanation and children's
   story. Compare against saved poor examples. Review complete picture/audio,
   shot-to-speech logic, captions, opening and payoff—not just contact sheets.
5. Test the song-recording workflow separately without claiming singing synthesis
   is solved. Test silent stock and weak source speech separately.
6. If a suitable real 49-minute episode is available, test coverage and highlights,
   interrupt a middle clip, resume, retain completed files and verify all previews
   and downloads. Expect approximately 16–24 usable clips depending on boundaries;
   record any exclusions. If no source is available, mark this test outstanding
   rather than claiming a synthetic fixture proves acceptance.
7. Build sequentially in a new directory under an admitted resource budget. The
   recorded 640 MB build heap is a prior successful checkpoint, not a guarantee.
   Switch active-build only after tests and startup checks. Verify frontend,
   worker and backend run compatible versions and the desktop shortcut starts them.
8. Regenerate and verify the backend patch with the existing allowlisted export
   script. Update README, changelog and implementation progress with measured
   capability, limitations and recovery instructions. Audit ignored/private files
   before any later user-authorized Git upload; do not include keys or user media.

Release gate: no known data-loss, duplicate-job, paid-call or false-success defect;
all supported workflows pass actual-output and UI review. Any remaining hardware,
account or input limitation is explicit. Do not call the whole product finished
on the strength of a build, metadata score or small test-pattern export.

## 4. First execution checkpoint

Start with P0, not another broad UI redesign. Finish and test the existing lease,
display health, close mutation-route gaps, and re-establish a passing baseline.
Then complete P1–P3 as one vertical slice and produce one genuinely coherent
general-interest video before expanding 2D and the remaining library surfaces.
Keep `IMPLEMENTATION_PROGRESS.md` evidence-based after each checkpoint. If a
capability cannot be completed for free on this hardware, say so specifically;
do not substitute unrelated content and mark the request successful.

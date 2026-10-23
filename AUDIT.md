# Phoenix cleanup audit — October 23, 2026

## What this repo does

Phoenix is a single-owner, native Windows video app: streaming episode clips,
licensed-stock reels, narrated/2D creation, final-video editing and reviewed
publishing. This audit assumes one owner on an 8 GB laptop, not a publicly hosted
multi-user production service. Vercel is a separate web build, not the renderer.

## Fixed or removed

1. **Unused upload endpoint could exhaust RAM.** The old multipart/remote
   `POST /api/review-files` buffered up to 5 GB and only made placeholder records.
   No retained caller used it. Removed it; GET/library summaries remain. Active
   uploads keep the bounded `/api/source-processing` stream and preflight.
2. **Local mutations lacked consistent request checks.** Generation retry/delete,
   song staging and Desktop-shortcut creation now reject nonlocal/cross-origin
   requests before parsing input or starting work. Valid local actions retain
   their existing queue, stream and native-shortcut paths.
   Unused legacy project/settings/stock/admin writes were removed rather than
   maintained as a second workflow. Archive owner lookup now reads an existing
   account instead of creating one during a GET.
3. **Broken browser editor was a second, RAM-heavy rendering path.** Its core
   renderer was absent, it fetched whole source blobs, and Back/Ultimate links
   led back to itself. Retired its unreachable UI/store/exporter/analysis code.
   Old editor/review bookmarks show an honest Library/native-editor notice.
   Saved timelines/files are untouched and are not automatically migrated.
4. **Dead UI and dependencies added maintenance with no user benefit.** Removed
   the unused upload consoles, duplicate ideas screen, mock Ultimate widgets,
   unused UI primitives, landing/starter graphics and orphaned WASM assets.
   Removed their unused packages; native FFmpeg/FFprobe stay installed.
5. **Obsolete deployment paths gave misleading setup instructions.** Removed
   the unused Docker files and old AuraClip CI. The supported Windows lifecycle,
   remote verification/installer and separate Vercel verification remain.
   Unused old provider, topic-explorer and manual-scene GET wrappers are also
   removed; current automatic stock search/planning helpers remain shared.
6. **README mixed years of historical instructions with current operation.**
   Replaced duplicate release essays and obsolete menus/lengths with a current
   user/operator guide. Dated release evidence stays in IMPLEMENTATION_PROGRESS
   and Git history; retired booster/gateway setup documents are removed.

Removed tracked source/assets/configuration can be recovered from Git history.
No owner video, original, editable master, credential, database, saved job,
timeline, review or unrelated PC file is part of this cleanup.

## Retained deliberately

- Source/stock/creation queues; automatic planning; retry and duplicate guards.
- Native source rendering and editing; subtitle timing and visual/source checks.
- Public stock rights/provenance and required posting credits.
- Free writer rotation, explicit local-model choice and sampled-frame consents.
- Quality/performance feedback, library previews/Trash, reviewed publishing.
- Native startup/shutdown, low-RAM admission, release validation and rollback.
- Legacy database schema/migrations and read-only archive access for saved data;
  no destructive migration or automatic database cleanup is performed.

## Verification

Cleanup regression checks cover retired modules/packages, retained local imports,
bookmark behavior, mutation trust boundaries and the existing library GET. The
Windows release workflow also runs the retained editor, queue/file, resource,
preview, posting, provider, animation and deployment checks serially, with real
isolated render proofs and TypeScript/build validation. Exact run results and
the installed source/build belong in IMPLEMENTATION_PROGRESS after verification.

## Remaining limits / not checked

- No real social video is posted as a test. Instagram eligibility/music/location
  results vary; YouTube requires its own OAuth grant. Rumble is assisted export,
  not automatic publishing; Bilibili.tv publishing access remains unverified.
- Whole-film editorial quality, genuine automatic singing and growth/revenue
  are not established by tests. A 49-minute owner episode is not rendered here.
- Legacy PostgreSQL archives are preserved, not certified as a multi-user app or
  migrated into the native editor. Filled credentials and personal media are
  excluded from the remote build and are not inspected for content.
- Removing dead code reduces maintenance/install/browser baggage, not the RAM
  demanded by all other apps or the minimum needed to encode a real video.
- This is a risk-led audit of entrypoints and connected workflows, not a claim
  that every line or possible provider response has been exhaustively tested.

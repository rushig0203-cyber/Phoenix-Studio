# Phoenix Studio release notes

These notes distinguish shipped code from demonstrated output. No release here is a guarantee of artistic quality, audience growth, or earnings.

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

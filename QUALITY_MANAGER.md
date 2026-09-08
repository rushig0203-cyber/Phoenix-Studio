# Local content quality manager

Open `/dashboard/manager`, or select **Rate quality / teach manager** on a review file.

- Reads the same on-disk AI, source and edit queues as the worker, excluding archived records.
- Keeps rendering completion separate from owner approval. Missing captions, invalid output metadata and legacy spoken songs block quality approval.
- Records one current review per output (story, visuals, audio, captions, decision and notes). Re-rating updates that review rather than counting it twice.
- Ratings of 1–2 create bounded production rules for matching children's creation types. They affect future story briefs, word budgets and caption groups. User notes are saved as review records, not executed as instructions.
- Source/stock feedback is recorded for manual review; it does not yet train those workflows. There is no model retraining, autonomous code editing, automatic posting or validated view prediction.
- New children's renders record the exact feedback-rule snapshot in their work directory and review metadata.
- Children’s scores are explicitly text-only heuristics, with no artificial minimum. They are not assessments of singing, acting, animation quality or monetization.

## Still incomplete

Automatic sung vocals are not installed. A song requires user-supplied audio and lyrics, with manual listening and synchronization review. Uploaded audio is not proof of singing quality. Animation remains lightweight 2D rigs at 12 fps / 720p, not professional nursery-rhyme animation. Existing exports are not automatically rerendered.

## Verification

Run `node scripts/test-quality-manager.cjs`, `node scripts/test-queue-history.cjs`, and `node scripts/test-review-workflows.cjs` (23 tests). `node scripts/verify-song-render.cjs` checks a bounded 20-second supplied-audio render in temporary storage; its test tone does **not** test singing quality. Then run TypeScript, targeted ESLint and `npm run build`.

September 8 recovery: the edit queue was found to contain two zero bytes. The original damaged file was preserved beside the queue as `review-edit-jobs.json.corrupt-<uuid>` and the empty queue restored. Edit-queue and feedback writes now flush temporary files before replacing the store. Never silently reset a damaged queue containing real job data.

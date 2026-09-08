# Generation autopilot

> Historical design notes, not the active Phoenix workflow. The current local worker disables autonomous generation and cloud publishing. The quality manager reads local queues and owner feedback; see README.md and QUALITY_MANAGER.md for current behavior. The schedules and targets below are not running.

Lumina's daily booster runs between **2:00 PM and 10:00 PM IST**. During that window it builds review-ready business and money education drafts until it reaches its daily target of 28 (within the 25–30 range). It never publishes a clip.

Set these server-only variables in `.env` on the machine that runs `npm run dev` or `npm start`:

```env
MPT_BASE_URL=http://127.0.0.1:8080
MPT_API_TOKEN=your-private-generator-token
PHOENIX_AUTOPILOT_USER_ID=auraclip-owner
LUMINA_LLM_BASE_URL=http://127.0.0.1:11434/v1
LUMINA_LLM_MODEL=your-local-model
```

At worker startup, and every minute after that, Lumina checks the booster state, chooses unique business-and-money education ideas, scripts them, and starts a bounded number of jobs. It counts only completed **Review queue** videos, adds caption/hashtag metadata, and backs off safely if a local service is unavailable. The Command Center's Booster card shows the live heartbeat, progress, and any blocker.

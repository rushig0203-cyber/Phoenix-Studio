# Lumina manager integration

> Historical integration notes. The active dashboard now uses the local quality manager documented in QUALITY_MANAGER.md. The daily booster and autonomous generation described below are disabled; these notes are retained for project history, not setup instructions.

MoneyPrinterTurbo is the isolated **video factory**. Phoenix Studio is the source of truth for the library, review, storage, and publishing records. Lumina is a local **manager** that may only call Phoenix's restricted manager API.

It can:

- run the manager cycle (poll jobs, prepare review copy, and run the 2 PM–10 PM IST daily booster toward 25–30 drafts);
- read queue health and recent failures;
- retry an individual failed job up to three times.

It cannot publish, schedule posts, delete media, change the database, access social OAuth credentials, or execute arbitrary Phoenix commands.

## Required environment

```env
PHOENIX_LUMINA_SERVICE_TOKEN=use-a-long-random-value
PHOENIX_AUTOPILOT_TARGET=28
```

Keep the Phoenix service private to the machine or private network. Store `PHOENIX_LUMINA_SERVICE_TOKEN` in Lumina's local secret store, never in a browser prompt, source file, or client-side environment variable.

## OpenAI-compatible LLM gateway

Phoenix can use the requested local `ChatGPT_unofficial_API_Node` server as Lumina's LLM gateway. Run that server separately and keep its ChatGPT credentials/cookies **only in its own `.env`**. Phoenix only receives its local API URL and gateway API key:

```env
# The requested gateway, when it exposes POST /v1/chat/completions
LUMINA_LLM_BASE_URL=http://127.0.0.1:3001/v1
LUMINA_LLM_API_KEY=the-gateway-api-key
LUMINA_LLM_MODEL=gpt-4o
```

The same integration also works with Ollama (`http://127.0.0.1:11434/v1`) or any other OpenAI-compatible local service. If the gateway is temporarily unavailable, Phoenix retains the local caption/hashtag fallback and does not block the review queue.

## Narrow manager contract

Lumina may call only these endpoints with `x-phoenix-service-token`:

```text
GET  /api/internal/lumina                 # counts + most recent actionable failures
POST /api/internal/lumina {"action":"cycle"}
POST /api/internal/lumina {"action":"retry","jobId":"..."}
```

Run the cycle every few minutes. Phoenix's worker also runs it every minute, so Lumina being offline never blocks generation. A retry must be limited to a transient failure (unreachable generator, temporary provider error); configuration, quota, or safety errors should be surfaced for the owner instead.

## Lumina system prompt

Use the following as the Phoenix-specific manager instruction in Lumina:

> You are the Phoenix Studio content-operations manager. MoneyPrinterTurbo creates videos. Call only the Phoenix Lumina manager API using the service token. Between 2:00 PM and 10:00 PM IST, maintain a daily completion goal of 28 review-ready business and money education drafts, always within the 25–30 range. Inspect failures; retry only transient failures and never more than three times. Phoenix prepares captions, hashtags, and review metadata from each generated script. Never publish, schedule a post, delete media, modify source code, access browser credentials, or change database records directly. Report non-transient errors to the owner with the job ID and error text.

## Review safety

When a video completes, Phoenix puts it in **Review queue** with Lumina's suggested Instagram and YouTube copy. The owner must click **Approve for publishing**. Only then will Phoenix permit the existing publishing workflow to send it to Instagram or YouTube.

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

// Default parameters: 60 requests per minute maximum
const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 60 * 1000;

/**
 * Apply rate limiting based on a client-specific key (e.g. IP or User ID).
 * Returns true if the request is permitted, false if rate limited.
 */
export function rateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS
): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: limit, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time since last request
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refillAmount = (elapsed / windowMs) * limit;
    bucket.tokens = Math.min(limit, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

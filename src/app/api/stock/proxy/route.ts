import { MAX_STOCK_REEL_BYTES } from "@/lib/stockReel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set([
  "cdn.pixabay.com",
  "images.pexels.com",
  "videos.pexels.com",
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 120_000;
const MEDIA_TYPES = /^(?:video\/[a-z0-9.+-]+|image\/(?:jpeg|png|webp|avif|gif))$/i;

class ProxyError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function safeInteger(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ProxyError("The stock source returned invalid size headers.");
  }
  return Number(value);
}

function byteRange(value: string | null) {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    throw new ProxyError("Only a single valid byte range is supported.", 400);
  }
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if ((start !== undefined && !Number.isSafeInteger(start)) ||
      (end !== undefined && !Number.isSafeInteger(end)) ||
      (start !== undefined && end !== undefined && end < start) ||
      (start === undefined && end === 0)) {
    throw new ProxyError("Only a single valid byte range is supported.", 400);
  }
  return { value, start, end };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return Response.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return Response.json({ error: "Invalid stock URL" }, { status: 400 });
  }

  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) ||
      url.username || url.password || (url.port && url.port !== "443")) {
    return Response.json({ error: "Unsupported stock source" }, { status: 400 });
  }

  const abort = new AbortController();
  let upstream: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let downstream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;
  let finished = false;
  let timedOut = false;
  const cleanup = () => {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", disconnected);
  };
  const stop = (reason: unknown) => {
    if (finished) return cancellation;
    finished = true;
    cleanup();
    abort.abort(reason);
    if (reader) {
      const activeReader = reader;
      cancellation = activeReader.cancel(reason)
        .finally(() => activeReader.releaseLock()).catch(() => undefined);
    } else {
      cancellation = upstream?.body?.cancel(reason).catch(() => undefined);
    }
    try { downstream?.error(reason); } catch { /* The browser may have already cancelled. */ }
    return cancellation;
  };
  const disconnected = () => { void stop(new ProxyError("The stock transfer was cancelled.", 408)); };
  const timeout = setTimeout(() => {
    timedOut = true;
    void stop(new ProxyError("The approved stock transfer timed out.", 504));
  }, TRANSFER_TIMEOUT_MS);
  timeout.unref?.();
  req.signal.addEventListener("abort", disconnected, { once: true });

  try {
    if (req.signal.aborted) {
      disconnected();
      throw new ProxyError("The stock transfer was cancelled.", 408);
    }
    const range = byteRange(req.headers.get("range"));
    const requestHeaders = new Headers({ "Accept-Encoding": "identity" });
    if (range) {
      requestHeaders.set("Range", range.value);
      const ifRange = req.headers.get("if-range");
      if (ifRange && ifRange.length <= 1024) requestHeaders.set("If-Range", ifRange);
    }
    upstream = await fetch(url.toString(), {
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: requestHeaders,
      signal: abort.signal,
    });
    if (finished) {
      // Also close a late response if a fetch implementation ignores cancellation.
      void upstream.body?.cancel(abort.signal.reason).catch(() => undefined);
      throw new ProxyError("The stock transfer was cancelled.", 408);
    }
    if ((upstream.status !== 200 && upstream.status !== 206) || !upstream.body) {
      throw new ProxyError("The approved stock source did not return media.");
    }
    const contentType = upstream.headers.get("content-type") || "";
    const mime = contentType.split(";", 1)[0].trim();
    if (!MEDIA_TYPES.test(mime)) {
      throw new ProxyError("The stock source returned an unsupported media type.");
    }
    const encoding = upstream.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") {
      throw new ProxyError("The stock source returned an unsupported content encoding.");
    }
    const maximum = mime.toLowerCase().startsWith("image/") ? MAX_IMAGE_BYTES : MAX_STOCK_REEL_BYTES;
    const contentLength = upstream.headers.get("content-length");
    let expected = contentLength === null ? undefined : safeInteger(contentLength);
    if (expected !== undefined && expected > maximum) {
      throw new ProxyError("The approved stock asset exceeds the download size limit.", 413);
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Range, If-Range",
    });
    const contentRange = upstream.headers.get("content-range");
    if (upstream.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange || "");
      if (!range || !match) throw new ProxyError("The stock source returned an invalid byte range.");
      const start = safeInteger(match[1]);
      const end = safeInteger(match[2]);
      const total = match[3] === "*" ? undefined : safeInteger(match[3]);
      const length = end - start + 1;
      if (length > maximum || (total !== undefined && total > maximum)) {
        throw new ProxyError("The approved stock asset exceeds the download size limit.", 413);
      }
      if (end < start || !Number.isSafeInteger(length) ||
          (total !== undefined && end >= total) ||
          (expected !== undefined && expected !== length) ||
          (range.start !== undefined && start !== range.start) ||
          (range.start !== undefined && range.end !== undefined && end > range.end) ||
          (range.start === undefined && (total === undefined ||
            start !== Math.max(0, total - range.end!) || end !== total - 1))) {
        throw new ProxyError("The stock source returned an invalid byte range.");
      }
      expected = length;
      headers.set("Content-Range", contentRange!);
    } else if (contentRange) {
      throw new ProxyError("The stock source returned an invalid byte range.");
    }
    if (expected !== undefined) headers.set("Content-Length", String(expected));
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges === "bytes" || acceptRanges === "none") headers.set("Accept-Ranges", acceptRanges);
    for (const name of ["ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    reader = upstream.body.getReader();
    let received = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { downstream = controller; },
      async pull(controller) {
        if (finished) return;
        try {
          const { value, done } = await reader!.read();
          if (finished) return;
          if (done) {
            if (expected !== undefined && received !== expected) {
              throw new ProxyError("The approved stock transfer was truncated.");
            }
            finished = true;
            cleanup();
            reader!.releaseLock();
            controller.close();
            return;
          }
          received += value.byteLength;
          if (received > maximum || (expected !== undefined && received > expected)) {
            throw new ProxyError("The approved stock transfer exceeds its size limit.", 413);
          }
          controller.enqueue(value);
        } catch (error) {
          void stop(error);
        }
      },
      cancel(reason) { return stop(reason); },
    }, { highWaterMark: 0 }); // Do not read ahead of the downstream consumer.
    return new Response(body, { status: upstream.status, headers });
  } catch (error) {
    void stop(error);
    return Response.json(
      { error: error instanceof ProxyError ? error.message : "Failed to proxy approved stock media" },
      { status: timedOut ? 504 : error instanceof ProxyError ? error.status : 502 },
    );
  }
}

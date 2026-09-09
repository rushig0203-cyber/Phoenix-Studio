export function assertLocalRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Open Phoenix Studio on localhost on this PC.");
  const host = request.headers.get("host"), origin = request.headers.get("origin");
  if ((host && host !== url.host) || (origin && origin !== url.origin) || (mutation && origin !== url.origin) || (mutation && request.headers.get("sec-fetch-site") === "cross-site")) throw new Error("Open this action directly in Phoenix Studio; cross-site changes are blocked.");
}

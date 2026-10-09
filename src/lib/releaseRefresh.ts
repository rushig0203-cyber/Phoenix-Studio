const releaseName = (value: unknown): value is string => typeof value === "string" && /^\.next-[a-z0-9-]+$/.test(value) && value !== ".next-dev";
const refreshKey = "phoenix-release-refresh";

/** Reuse the health poll; refresh once per release pair, never while editing. */
export function refreshInstalledRelease(options: {
  loaded: unknown; serving: unknown; defer: boolean;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
}) {
  if (!releaseName(options.loaded) || !releaseName(options.serving)) return "ignored";
  if (options.loaded === options.serving) {
    try { options.storage.removeItem(refreshKey); } catch { /* Storage can be disabled. */ }
    return "current";
  }
  if (options.defer) return "deferred";
  const pair = `${options.loaded}:${options.serving}`;
  try {
    if (options.storage.getItem(refreshKey) === pair) return "blocked";
    // Without a persisted guard a stale cache could reload indefinitely.
    options.storage.setItem(refreshKey, pair);
  } catch { return "blocked"; }
  options.reload();
  return "reloaded";
}

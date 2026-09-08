import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type LockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * A small cross-process lock for short local JSON read/modify/write sections.
 * The lock is never held while rendering or downloading media.
 */
export async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 30_000;
  const retryMs = options.retryMs ?? 35;
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(token, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const observedToken = await fs.readFile(lockPath, "utf8");
        const first = await fs.stat(lockPath);
        if (Date.now() - first.mtimeMs > staleMs) {
          // Recheck both identity and age before trying an atomic quarantine.
          // This avoids unlinking a newer lock that replaced the stale one
          // between the initial stat and cleanup.
          await wait(Math.min(retryMs, 50));
          const secondToken = await fs.readFile(lockPath, "utf8");
          const second = await fs.stat(lockPath);
          if (secondToken === observedToken && second.mtimeMs === first.mtimeMs && Date.now() - second.mtimeMs > staleMs) {
            const quarantine = `${lockPath}.stale-${crypto.randomUUID()}`;
            try {
              await fs.rename(lockPath, quarantine);
              const quarantinedToken = await fs.readFile(quarantine, "utf8");
              if (quarantinedToken === observedToken) {
                await fs.rm(quarantine, { force: true });
                continue;
              }
              // A different owner was moved. Restore it if no successor has
              // appeared; otherwise leave the quarantined lock untouched.
              try {
                await fs.rename(quarantine, lockPath);
              } catch {
                // Another owner already holds lockPath.
              }
            } catch (renameError) {
              if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
                // A live Windows handle can reject rename; treat that as held.
              }
            }
          }
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for local store lock: ${path.basename(lockPath)}`);
      await wait(retryMs);
    }
  }

  const heartbeatMs = Math.max(250, Math.floor(staleMs / 3));
  const heartbeat = setInterval(() => {
    const now = new Date();
    void handle?.utimes(now, now).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref();

  try {
    return await action();
  } finally {
    clearInterval(heartbeat);
    await handle.close().catch(() => undefined);
    try {
      if ((await fs.readFile(lockPath, "utf8")) === token) await fs.rm(lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

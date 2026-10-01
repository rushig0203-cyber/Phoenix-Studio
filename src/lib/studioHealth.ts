import fs from "node:fs/promises";
import path from "node:path";
import { writeAtomicJson } from "./atomicJson";
import { heavyWorkStatus } from "./renderResources";
import { localServiceHealth } from "./localServiceHealth";

const heartbeatPath = () => path.join(process.cwd(), "storage", "worker-heartbeat.json");
export async function writeWorkerHeartbeat() {
  await writeAtomicJson(heartbeatPath(), { pid: process.pid, at: new Date().toISOString() });
}
export async function studioHealth(includeServices = false) {
  let heartbeat: { pid: number; at: string } | undefined;
  try { heartbeat = JSON.parse(await fs.readFile(heartbeatPath(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let alive = false;
  try { if (heartbeat && Number.isInteger(heartbeat.pid)) { process.kill(heartbeat.pid, 0); alive = true; } } catch { /* Worker exited. */ }
  const state = !alive ? "offline" : Date.now() - Date.parse(heartbeat!.at) < 20_000 ? "healthy" : "unresponsive";
  const resources = await heavyWorkStatus();
  return { worker: { state, heartbeatAt: heartbeat?.at }, manager: { name: "Lumina", mode: "local-production", state, automaticPosting: false }, services: includeServices ? await localServiceHealth() : undefined,
    resources: { busy: !!resources.lease, kind: resources.lease?.kind, reason: resources.reason, waitingForMemory: resources.waitingForMemory, freeMiB: Math.floor(resources.freeBytes / 1048576), reserveMiB: Math.floor(resources.reserveBytes / 1048576), externalJobId: resources.lease?.external?.jobId, lastBackendCheck: resources.lease?.external?.checkedAt },
    build: process.env.PHOENIX_BUILD_DIR || ".next-lumina", resourcePolicy: "shared-heavy-work-v1" };
}

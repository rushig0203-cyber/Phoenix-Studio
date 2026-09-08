import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Flush before replacing; Windows scanners/readers can briefly hold the old file. */
export async function writeAtomicJson(filename: string, value: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx");
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        if (attempt >= 9 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
}

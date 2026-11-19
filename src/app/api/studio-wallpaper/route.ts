import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { assertLocalRequest } from "@/lib/localRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};
const empty = () => new Response(null, { status: 204, headers });

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const site = request.headers.get("sec-fetch-site");
    if (process.env.VERCEL === "1" || site === "cross-site" || site === "same-site") return empty();
    const filename = join(process.cwd(), "storage", "ui", "studio-wallpaper.jpg");
    if (!(await lstat(filename)).isFile()) return empty();

    const file = await open(filename, "r");
    try {
      const { size } = await file.stat();
      if (size < 4 || size > 512 * 1024) return empty();
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size;) {
        const { bytesRead } = await file.read(bytes, offset, size - offset, offset);
        if (!bytesRead) return empty();
        offset += bytesRead;
      }
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[size - 2] !== 0xff || bytes[size - 1] !== 0xd9) return empty();
      return new Response(bytes, { headers: { ...headers, "Content-Type": "image/jpeg" } });
    } finally {
      await file.close();
    }
  } catch {
    return empty();
  }
}

import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { assertLocalRequest } from "@/lib/localRequest";

const headers = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};
const empty = () => new Response(null, { status: 204, headers });
const coverFiles = new Map([
  ["alps", "studio-cover-alps.jpg"],
  ["owl", "studio-cover-owl.jpg"],
  ["panda", "studio-cover-panda.jpg"],
  ["rabbit", "studio-cover-rabbit.jpg"],
  ["park", "studio-cover-park.jpg"],
]);

export async function studioArtwork(request: Request, asset: "studio-wallpaper.jpg" | "studio-logo.jpg") {
  try {
    assertLocalRequest(request);
    const site = request.headers.get("sec-fetch-site");
    if (process.env.VERCEL === "1" || site === "cross-site" || site === "same-site") return empty();
    const cover = asset === "studio-wallpaper.jpg" ? new URL(request.url).searchParams.get("cover") : null;
    const selected = cover === null ? asset : coverFiles.get(cover);
    if (!selected) return empty();
    const filename = join(process.cwd(), "storage", "ui", selected);
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

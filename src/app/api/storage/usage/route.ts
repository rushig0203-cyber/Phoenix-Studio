import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { reviewRoot } from "@/lib/reviewFiles";

export const runtime = "nodejs";

async function measure(directory: string): Promise<{ bytes: number; objects: number }> {
  let bytes = 0;
  let objects = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await measure(location);
      bytes += nested.bytes;
      objects += nested.objects;
    } else if (entry.isFile()) {
      const stat = await fs.stat(location);
      bytes += stat.size;
      objects += 1;
    }
  }
  return { bytes, objects };
}

export async function GET() {
  const usage = await measure(reviewRoot());
  return NextResponse.json({ ...usage, kind: "local", percent: 0, limitBytes: null });
}

import { NextResponse } from "next/server";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { getCloudUsage, STORAGE_LIMIT_BYTES } from "@/lib/s3";

export async function GET() {
  try {
    const userId = await requireUserId();
    const usage = await getCloudUsage(`users/${userId}/`);
    return NextResponse.json({ ...usage, limitBytes: STORAGE_LIMIT_BYTES, percent: Math.min(100, usage.bytes / STORAGE_LIMIT_BYTES * 100) });
  } catch (error) {
    return NextResponse.json({ error: isUnauthorized(error) ? "Sign in required" : "Storage unavailable" }, { status: isUnauthorized(error) ? 401 : 500 });
  }
}

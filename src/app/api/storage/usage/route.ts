import { NextResponse } from "next/server";
import { reviewRoot } from "@/lib/reviewFiles";
import { assertLocalRequest } from "@/lib/localRequest";
import { reviewStorageUsage } from "@/lib/reviewStorage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    return NextResponse.json(await reviewStorageUsage(reviewRoot()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Local storage usage could not be read. Saved videos have not been changed." }, { status: 400 });
  }
}

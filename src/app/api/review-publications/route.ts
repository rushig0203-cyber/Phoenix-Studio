import { NextResponse } from "next/server";
import { assertReviewPublishRequest, listReviewPublicationProgress, reviewPublishError } from "@/lib/reviewPublishing";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  try {
    assertReviewPublishRequest(request);
    return NextResponse.json(await listReviewPublicationProgress(), { headers });
  } catch (error) {
    const result = reviewPublishError(error);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
}

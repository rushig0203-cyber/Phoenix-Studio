import { NextResponse } from "next/server";
import { readReviewFiles } from "@/lib/reviewFiles";
import { withReviewPublicationSummaries } from "@/lib/reviewPublicationSummary";

export async function GET(request: Request) {
  const trash = new URL(request.url).searchParams.get("trash") === "1";
  const files = await readReviewFiles(trash);
  const visible = trash ? files.filter(file => file.trashedAt) : files;
  return NextResponse.json(await withReviewPublicationSummaries(visible), { headers: { "Cache-Control": "no-store" } });
}

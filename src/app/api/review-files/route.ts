import { NextResponse } from "next/server";
import { readReviewFiles } from "@/lib/reviewFiles";
import { withReviewPublicationSummaries } from "@/lib/reviewPublicationSummary";
import { reviewEpisode } from "@/lib/reviewEpisode";

export async function GET(request: Request) {
  const trash = new URL(request.url).searchParams.get("trash") === "1";
  const files = await readReviewFiles(true);
  const byId = new Map(files.map(file => [file.id, file]));
  const visible = files.filter(file => trash ? file.trashedAt : !file.trashedAt)
    .map(file => {
      const episode = reviewEpisode(file, byId);
      return episode && !file.episode ? { ...file, episode } : file;
    });
  return NextResponse.json(await withReviewPublicationSummaries(visible), { headers: { "Cache-Control": "no-store" } });
}

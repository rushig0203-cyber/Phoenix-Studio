import { studioArtwork } from "@/lib/studioArtwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return studioArtwork(request, "studio-wallpaper.jpg");
}

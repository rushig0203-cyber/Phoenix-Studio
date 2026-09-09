import { z } from "zod";
import { listCreationDrafts } from "@/lib/creationDrafts";
import { getSongAudio, songAudioPath } from "@/lib/songAudio";
import { streamReviewMedia } from "@/lib/reviewMedia";
import { assertLocalRequest } from "@/lib/localRequest";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const id = z.string().uuid().parse((await context.params).id);
    const draft = (await listCreationDrafts()).find(d => d.id === id && d.status !== "ARCHIVED");
    if (!draft?.input.songAudioId) return new Response("Song not found", { status: 404 });
    const audio = await getSongAudio(draft.input.songAudioId);
    const ext = audio.filename.split(".").pop()?.toLowerCase();
    const type = ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg" } as Record<string, string>)[ext || ""] || "application/octet-stream";
    return streamReviewMedia(request, songAudioPath(audio.id), type);
  } catch { return new Response("Saved song is unavailable", { status: 404 }); }
}
export const HEAD = GET;

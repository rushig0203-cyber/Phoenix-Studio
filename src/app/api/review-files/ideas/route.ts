import { NextResponse } from "next/server";
import { readReviewFiles } from "@/lib/reviewFiles";

const templates = ["Nature discovery", "Music-and-motion", "Learning cards"];
const safeIdeas = ["gentle beach waves", "mountain clouds", "forest animals", "rainbow colours in nature", "sunset sky", "waterfall sounds"];

export async function GET() {
  const files = await readReviewFiles();
  const latest = files.filter((item) => item.audience === "kids-1-3").map((item) => new Date(item.createdAt).getTime()).sort((a, b) => b - a)[0] || 0;
  const elapsed = latest ? Math.floor((Date.now() - latest) / 86_400_000) : 20;
  const rotation = Math.floor((latest || Date.now()) / (20 * 86_400_000)) % templates.length;
  return NextResponse.json({ template: templates[rotation], due: elapsed >= 20, daysRemaining: Math.max(0, 20 - elapsed), ideas: safeIdeas, source: "Approved source ideas — Pexels/Pixabay queries, seasonal prompts, and local review history. Not live platform trends." });
}

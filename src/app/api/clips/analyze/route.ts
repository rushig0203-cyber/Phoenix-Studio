import { NextResponse } from "next/server";

const stopWords = new Set([
  "about", "after", "again", "also", "because", "from", "have", "into",
  "just", "more", "that", "their", "there", "these", "they", "this",
  "what", "when", "where", "which", "with", "would", "your",
]);

function cleanWords(value: string) {
  return value.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [];
}

function detectCategory(value: string) {
  if (/\b(code|developer|javascript|typescript|python|react|software|tech)\b/i.test(value)) return "tech";
  if (/\b(business|finance|marketing|sales|startup|founder|revenue|invest)\b/i.test(value)) return "business";
  if (/\b(health|fitness|workout|diet|exercise|nutrition)\b/i.test(value)) return "health";
  if (/\b(learn|lesson|science|history|education|explain)\b/i.test(value)) return "education";
  if (/\b(motivation|mindset|habit|discipline|focus|growth)\b/i.test(value)) return "motivation";
  return "general";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const title = String(body.title || "").replace(/^clip\s+\d+:\s*/i, "").trim();
    const transcript = String(body.transcript || "").trim();
    const supplied = Array.isArray(body.keywords) ? body.keywords.map(String) : [];
    if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });

    const material = `${title} ${transcript} ${supplied.join(" ")}`;
    const category = detectCategory(material);
    const relevant = [...supplied, ...cleanWords(material)]
      .map((word) => word.replace(/^#/, ""))
      .filter((word) => word.length > 2 && !stopWords.has(word));
    const hashtags = [...new Set(["Shorts", category, ...relevant])]
      .slice(0, 10)
      .map((word) => `#${word.replace(/[^a-z0-9]/gi, "")}`)
      .filter((word) => word.length > 1);
    const summary = transcript
      ? transcript.split(/(?<=[.!?])\s+/)[0].slice(0, 180)
      : `A focused clip about ${title}.`;
    const hasHook = /\b(how|why|first|best|mistake|discover|important|never)\b/i.test(material);
    const viralityScore = Math.min(92, 68 + (hasHook ? 9 : 2) + Math.min(8, relevant.length));
    const youtubeTitle = `${title.slice(0, 58)} #Shorts`;

    return NextResponse.json({
      instagramCaption: `${title}\n\n${summary}\n\nWhat stood out to you? Save this clip for later.`,
      instagramHashtags: hashtags.join(" "),
      youtubeTitle,
      youtubeDescription: `${summary} Watch the full idea, then share your view in the comments.`,
      youtubeHashtags: hashtags.slice(0, 7).join(" "),
      viralityScore,
      hookAnalysis: hasHook
        ? "The opening contains a direct curiosity hook and stays tied to the clip topic."
        : "The topic is clear, but a more specific first sentence could improve early attention.",
      ctrHooks: [
        `The key idea behind ${title}`.slice(0, 69),
        `What most people miss about ${title}`.slice(0, 69),
        `${title}: the useful part in one clip`.slice(0, 69),
      ],
      source: "free-local-copy",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Local copy generation failed" },
      { status: 500 }
    );
  }
}

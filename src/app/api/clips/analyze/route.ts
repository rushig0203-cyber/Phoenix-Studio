import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { title, transcript, keywords } = await req.json();

    if (!title) {
      return NextResponse.json({ error: "Missing title" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      // Call Gemini API to generate professional viral copies
      const prompt = `You are a viral social media manager and content marketer.
Analyze this video clip segment:
CLIP TITLE: "${title}"
CLIP TRANSCRIPT: "${transcript || "No transcript available."}"
KEYWORDS: ${JSON.stringify(keywords || [])}

Generate:
1. Instagram Caption: Engaging, uses emojis, hooks the user, includes a Call To Action (CTA).
2. Instagram Hashtags: A list of 15-20 trending, relevant hashtags separated by spaces.
3. YouTube Shorts Title: Punchy, under 70 characters, clickbaity but accurate, incorporating 1-2 emojis and #shorts.
4. YouTube Shorts Description: A brief description (1-2 sentences) of what the video is about, urging users to subscribe.
5. YouTube Hashtags: A list of 5-8 relevant hashtags separated by spaces.

Respond ONLY with valid JSON in this exact structure:
{
  "instagramCaption": "string",
  "instagramHashtags": "string",
  "youtubeTitle": "string",
  "youtubeDescription": "string",
  "youtubeHashtags": "string"
}`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      try {
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.8,
              topP: 0.9,
              maxOutputTokens: 2048,
              responseMimeType: "application/json",
            },
          }),
        });

        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (responseText) {
            const cleanJson = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            const parsed = JSON.parse(cleanJson);
            return NextResponse.json(parsed);
          }
        }
      } catch (err) {
        console.warn("AuraClip: Gemini social copy generation failed, using fallback:", err);
      }
    }

    // High-fidelity fallback rule-based copy generator
    const kws = keywords && keywords.length > 0 ? keywords : ["viral", "trending", "clips"];
    const hashtagStr = kws.map((k: string) => `#${k.toLowerCase()}`).join(" ");
    
    // Generate premium templates
    const cleanTitle = title.replace(/^clip\s+\d+:\s*/i, "");
    
    const instagramCaption = `🔥 ${cleanTitle} 🔥\n\nThis is absolutely crazy! 😱 You don't want to miss this lesson. Let me know your thoughts in the comments! 👇\n\n🎯 Save this post for later and follow for daily value bombs!`;
    const instagramHashtags = `${hashtagStr} #auraclip #viral #shorts #reels #trending #contentcreator #foryou`;
    
    const youtubeTitle = `${cleanTitle.slice(0, 50)} 😱 #shorts`;
    const youtubeDescription = `Get the full story here! We deep dive into how ${kws.slice(0, 3).join(" and ")} works. Make sure to subscribe for more amazing video hacks and daily value!`;
    const youtubeHashtags = `#shorts #viral #trending ${kws.slice(0, 3).map((k: string) => `#${k.toLowerCase()}`).join(" ")}`;

    return NextResponse.json({
      instagramCaption,
      instagramHashtags,
      youtubeTitle,
      youtubeDescription,
      youtubeHashtags,
    });
  } catch (error: any) {
    console.error("Clip social copy generation API error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

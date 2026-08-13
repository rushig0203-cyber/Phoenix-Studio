import { NextResponse } from "next/server";

/**
 * AuraClip — Server-side Gemini AI Analysis API Route
 *
 * Receives a transcript from the client and uses the Gemini API
 * to identify viral clip segments, generate scores, titles, hooks, and reasons.
 * The API key stays server-side (never exposed to the browser).
 */

export async function POST(req: Request) {
  try {
    const { transcript, duration } = await req.json();

    if (!transcript || !duration) {
      return NextResponse.json(
        { error: "Missing transcript or duration" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured", useLocal: true },
        { status: 200 }
      );
    }

    // Build the analysis prompt
    const constraints = getClipDurationConstraints(duration);
    const clipCount = constraints.targetCount;
    const minDuration = constraints.minDuration;
    const maxDuration = constraints.maxDuration;

    const prompt = `You are an expert viral video editor and social media strategist. Analyze the following video transcript and identify the ${clipCount} most viral-worthy clip segments.

VIDEO DURATION: ${duration} seconds
EXPECTED CLIP COUNT: Identify exactly ${clipCount} non-overlapping clips.
TARGET CLIP DURATION RANGE: Each clip must be between ${minDuration} and ${maxDuration} seconds long.

TRANSCRIPT:
"""
${transcript}
"""

For each clip segment, provide:
1. title: A catchy, specific title (not generic)
2. startTime: Start time in seconds (must be within 0-${duration})
3. endTime: End time in seconds (must be within 0-${duration}, and > startTime)
4. viralScore: A score from 50-99 reflecting viral potential. Consider: hook strength, emotional impact, shareability, controversy, actionable advice, relatability
5. reason: A specific 1-2 sentence explanation of WHY this segment would go viral. Reference the actual content.
6. hookText: A compelling social media hook/caption for this clip (with 1 emoji)
7. transcript: The exact transcript text for this clip segment
8. keywords: Array of 3-5 relevant trending keywords

RULES:
- Each clip must be between ${minDuration} and ${maxDuration} seconds long
- Clips must NOT overlap
- Viral scores must be DIFFERENT for each clip (vary based on actual content quality)
- Titles must be UNIQUE and specific to the content
- Reasons must reference SPECIFIC content from the transcript
- Order clips by their position in the video (startTime ascending)

Respond ONLY with valid JSON in this exact format:
{
  "clips": [
    {
      "title": "string",
      "startTime": number,
      "endTime": number,
      "viralScore": number,
      "reason": "string",
      "hookText": "string",
      "transcript": "string",
      "keywords": ["string"]
    }
  ]
}`;

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

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
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errorText);
      return NextResponse.json(
        { error: `Gemini API error: ${geminiResponse.status}`, useLocal: true },
        { status: 200 }
      );
    }

    const geminiData = await geminiResponse.json();

    // Extract the text response
    const responseText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      console.error("Gemini returned empty response:", geminiData);
      return NextResponse.json(
        { error: "Empty Gemini response", useLocal: true },
        { status: 200 }
      );
    }

    // Parse the JSON response
    try {
      // Clean potential markdown code fences
      const cleanJson = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const parsed = JSON.parse(cleanJson);

      // Validate and sanitize clip data
      if (!parsed.clips || !Array.isArray(parsed.clips)) {
        throw new Error("Invalid response structure");
      }

      const validatedClips = parsed.clips
        .filter(
          (clip: any) =>
            clip.startTime !== undefined &&
            clip.endTime !== undefined &&
            clip.startTime >= 0 &&
            clip.endTime > clip.startTime &&
            clip.endTime <= duration + 1
        )
        .map((clip: any, idx: number) => ({
          id: `clip-${idx + 1}`,
          title: clip.title || `Clip ${idx + 1}`,
          startTime: Math.max(0, clip.startTime),
          endTime: Math.min(duration, clip.endTime),
          duration: Math.min(duration, clip.endTime) - Math.max(0, clip.startTime),
          viralScore: Math.min(99, Math.max(45, clip.viralScore || 60)),
          reason: clip.reason || "AI-identified viral moment based on content analysis.",
          hookText: clip.hookText || `Check out this moment 👀`,
          transcript: clip.transcript || "",
          keywords: Array.isArray(clip.keywords) ? clip.keywords : [],
        }));

      return NextResponse.json({
        clips: validatedClips,
        source: "gemini",
      });
    } catch (parseErr) {
      console.error("Failed to parse Gemini response:", parseErr, responseText);
      return NextResponse.json(
        {
          error: "Failed to parse Gemini response",
          useLocal: true,
        },
        { status: 200 }
      );
    }
  } catch (error: any) {
    console.error("Analyze API error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error", useLocal: true },
      { status: 200 }
    );
  }
}

function getClipDurationConstraints(durationSec: number) {
  if (durationSec < 15) {
    return { targetCount: 1, minDuration: Math.max(2, durationSec * 0.2), maxDuration: durationSec };
  }
  if (durationSec < 45) {
    return { targetCount: 2, minDuration: Math.max(5, durationSec * 0.2), maxDuration: Math.min(25, durationSec * 0.6) };
  }
  if (durationSec < 120) {
    return { targetCount: 3, minDuration: 15, maxDuration: 35 };
  }
  if (durationSec < 450) {
    return { targetCount: 4, minDuration: 20, maxDuration: 40 };
  }
  if (durationSec < 1800) {
    return { targetCount: 5, minDuration: 90, maxDuration: 150 };
  }
  return { targetCount: 10, minDuration: 200, maxDuration: 280 };
}

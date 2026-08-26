import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    console.log(`AuraClip Proxy: Fetching stock asset from ${targetUrl}`);
    const res = await fetch(targetUrl);
    if (!res.ok) throw new Error(`Failed to fetch target URL: ${res.status}`);

    const blob = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "video/mp4";

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err: any) {
    console.error("AuraClip Proxy: Failed to proxy target video:", err);
    return NextResponse.json(
      { error: err.message || "Failed to proxy target video" },
      { status: 500 }
    );
  }
}

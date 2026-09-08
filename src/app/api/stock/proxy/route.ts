import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "cdn.pixabay.com",
  "images.pexels.com",
  "videos.pexels.com",
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid stock URL" }, { status: 400 });
  }

  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: "Unsupported stock source" }, { status: 400 });
  }

  try {
    console.log("AuraClip Proxy: fetching an approved free stock asset.");
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
  } catch {
    console.warn("AuraClip Proxy: approved stock asset could not be fetched.");
    return NextResponse.json(
      { error: "Failed to proxy approved stock video" },
      { status: 500 }
    );
  }
}

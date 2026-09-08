import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") || "";
  const category = searchParams.get("category") || "all";
  const page = searchParams.get("page") || "1";
  const apiKey = process.env.PIXABAY_API_KEY || "";

  if (!apiKey.trim()) {
    return NextResponse.json({
      videos: [],
      source: "pixabay-unavailable",
      error: "Pixabay is not configured.",
    });
  }

  try {
    let pageNum = page;
    let isRandomized = false;
    if (pageNum === "1") {
      if (query || (category && category !== "all")) {
        // Random page between 1 and 5 for searches
        pageNum = String(Math.floor(Math.random() * 5) + 1);
        isRandomized = true;
      } else {
        // Popular: random page between 1 and 20
        pageNum = String(Math.floor(Math.random() * 20) + 1);
        isRandomized = true;
      }
    }

    const searchQuery = query || (category !== "all" ? category : "");
    let pixabayUrl = `https://pixabay.com/api/videos/?key=${apiKey.trim()}&q=${encodeURIComponent(searchQuery)}&page=${pageNum}&per_page=15`;

    console.log(`AuraClip Pixabay: Querying live endpoint (query: "${searchQuery}", page: ${pageNum})`);
    let res = await fetch(pixabayUrl, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Pixabay API responded with status ${res.status}`);
    }

    let data = await res.json();

    // Fallback if randomized page returned 0 videos
    if (isRandomized && (!data.hits || data.hits.length === 0) && pageNum !== "1") {
      console.log(`AuraClip Pixabay: Randomized page ${pageNum} returned no videos. Falling back to page 1.`);
      pixabayUrl = `https://pixabay.com/api/videos/?key=${apiKey.trim()}&q=${encodeURIComponent(searchQuery)}&page=1&per_page=15`;
      res = await fetch(pixabayUrl, { cache: "no-store" });
      if (res.ok) {
        data = await res.json();
      }
    }
    
    // Map Pixabay response items to standard app structures
    const videos = (data.hits || []).map((v: any) => {
      // Find suitable HD/SD video link file (Pixabay provides large, medium, small, tiny)
      const fileLink = v.videos?.large?.url || v.videos?.medium?.url || v.videos?.small?.url || v.videos?.tiny?.url || "";
      
      // Get thumbnail directly from video resolution objects
      const rawThumbnail = v.videos?.medium?.thumbnail || v.videos?.small?.thumbnail || v.videos?.tiny?.thumbnail || v.videos?.large?.thumbnail || "";

      // Parse tags into beautiful descriptive titles
      let parsedTitle = "";
      if (v.tags) {
        parsedTitle = v.tags
          .split(",")
          .slice(0, 3)
          .map((t: string) => t.trim().charAt(0).toUpperCase() + t.trim().slice(1))
          .join(" ");
      }
      if (!parsedTitle) {
        parsedTitle = `Pixabay Video Shared by ${v.user || "Community"}`;
      }

      return {
        id: `live-pix-${v.id}`,
        title: parsedTitle,
        category: category !== "all" ? category : "shared",
        thumbnail: rawThumbnail ? `/api/stock/proxy?url=${encodeURIComponent(rawThumbnail)}` : "",
        url: fileLink,
        duration: v.duration || 15
      };
    }).filter((v: any) => v.url !== ""); // filter out items missing links

    return NextResponse.json({ videos, source: "live-pixabay" });
  } catch {
    console.warn("AuraClip Pixabay request failed; returning no stock results.");
    return NextResponse.json({
      videos: [],
      source: "pixabay-unavailable",
      error: "Pixabay is temporarily unavailable.",
    });
  }
}

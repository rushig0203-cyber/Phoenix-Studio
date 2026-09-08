import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") || "";
  const category = searchParams.get("category") || "all";
  const page = searchParams.get("page") || "1";
  const apiKey = process.env.PEXELS_API_KEY || "";

  if (!apiKey.trim()) {
    return NextResponse.json({
      videos: [],
      source: "pexels-unavailable",
      error: "Pexels is not configured.",
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

    let pexelsUrl = `https://api.pexels.com/videos/popular?per_page=15&page=${pageNum}`;
    if (query || (category && category !== "all")) {
      const searchQuery = query || category;
      pexelsUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=15&page=${pageNum}`;
    }

    console.log(`AuraClip Pexels: Querying live endpoint ${pexelsUrl}`);
    let res = await fetch(pexelsUrl, {
      headers: {
        Authorization: apiKey.trim(),
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Pexels API responded with status ${res.status}`);
    }

    let data = await res.json();

    // Fallback if randomized page returned 0 videos
    if (isRandomized && (!data.videos || data.videos.length === 0) && pageNum !== "1") {
      console.log(`AuraClip Pexels: Randomized page ${pageNum} returned no videos. Falling back to page 1.`);
      pexelsUrl = `https://api.pexels.com/videos/popular?per_page=15&page=1`;
      if (query || (category && category !== "all")) {
        const searchQuery = query || category;
        pexelsUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(searchQuery)}&per_page=15&page=1`;
      }
      res = await fetch(pexelsUrl, {
        headers: {
          Authorization: apiKey.trim(),
        },
        cache: "no-store",
      });
      if (res.ok) {
        data = await res.json();
      }
    }
    
    // Map Pexels response items to standard app structures
    const videos = (data.videos || []).map((v: any) => {
      // Find suitable HD/SD video link file
      const fileLink = v.video_files?.find((f: any) => f.quality === "hd" || f.width >= 1280) || v.video_files?.[0];
      const rawThumbnail = v.image || "";
      
      // Parse descriptive title from Pexels video URL slug
      let parsedTitle = "";
      if (v.url) {
        try {
          const urlObj = new URL(v.url);
          const pathParts = urlObj.pathname.split("/").filter(Boolean);
          // Pexels path format: /video/slug-id/
          const videoIdx = pathParts.indexOf("video");
          if (videoIdx !== -1 && pathParts[videoIdx + 1]) {
            const slugPart = pathParts[videoIdx + 1];
            const slugWords = slugPart.split("-").filter(Boolean);
            if (slugWords.length > 1 && /^\d+$/.test(slugWords[slugWords.length - 1])) {
              slugWords.pop(); // remove ID
            }
            parsedTitle = slugWords
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ");
          }
        } catch {
          console.warn("AuraClip Pexels: could not parse a stock title.");
        }
      }
      
      if (!parsedTitle) {
        parsedTitle = `Shared Video by ${v.user?.name || "Community"}`;
      }

      return {
        id: `live-pv-${v.id}`,
        title: parsedTitle,
        category: category !== "all" ? category : "shared",
        thumbnail: rawThumbnail ? `/api/stock/proxy?url=${encodeURIComponent(rawThumbnail)}` : "",
        url: fileLink?.link || "",
        duration: v.duration || 15
      };
    }).filter((v: any) => v.url !== ""); // filter out items missing links

    return NextResponse.json({ videos, source: "live-pexels" });
  } catch {
    console.warn("AuraClip Pexels request failed; returning no stock results.");
    return NextResponse.json({
      videos: [],
      source: "pexels-unavailable",
      error: "Pexels is temporarily unavailable.",
    });
  }
}

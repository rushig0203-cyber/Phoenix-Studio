import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") || "";
  const category = searchParams.get("category") || "all";
  const page = searchParams.get("page") || "1";
  const clientApiKey = (searchParams.get("apiKey") || "").trim();
  
  let apiKey = clientApiKey;
  if (!apiKey || apiKey === "" || apiKey.toLowerCase().includes("mock")) {
    apiKey = process.env.PEXELS_API_KEY || "";
  }

  // Curator default fallback list when no API key is specified
  const DEFAULT_STOCK = [
    {
      id: "pv-1",
      title: "Programmer Coding at Desk",
      category: "coding",
      thumbnail: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-hands-of-a-programmer-typing-on-a-keyboard-4916-large.mp4",
      duration: 18
    },
    {
      id: "pv-2",
      title: "Sunset over Mountains",
      category: "sunset",
      thumbnail: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-sunset-clearing-in-the-mountains-4886-large.mp4",
      duration: 12
    },
    {
      id: "pv-3",
      title: "Hustling in Modern Office",
      category: "office",
      thumbnail: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-man-working-on-his-laptop-in-an-office-4894-large.mp4",
      duration: 15
    },
    {
      id: "pv-4",
      title: "Heavy Gym Fitness Workout",
      category: "fitness",
      thumbnail: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-woman-doing-exercises-on-a-fitness-mat-4927-large.mp4",
      duration: 24
    },
    {
      id: "pv-5",
      title: "Busy City Traffic at Night",
      category: "city",
      thumbnail: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-intersection-of-a-big-city-at-night-4903-large.mp4",
      duration: 20
    }
  ];

  if (!apiKey || apiKey.trim() === "") {
    // Return curated lists filtered local-side
    const filtered = DEFAULT_STOCK.filter(video => {
      const matchesSearch = video.title.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === "all" || video.category === category;
      return matchesSearch && matchesCategory;
    });
    const mappedCurated = filtered.map(v => ({
      ...v,
      thumbnail: `/api/stock/proxy?url=${encodeURIComponent(v.thumbnail)}`
    }));
    return NextResponse.json({ videos: mappedCurated, source: "curated" });
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
      const rawThumbnail = v.image || "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&auto=format&fit=crop&q=80";
      
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
        } catch (e) {
          console.warn("Failed to parse slug title:", e);
        }
      }
      
      if (!parsedTitle) {
        parsedTitle = `Shared Video by ${v.user?.name || "Community"}`;
      }

      return {
        id: `live-pv-${v.id}`,
        title: parsedTitle,
        category: category !== "all" ? category : "shared",
        thumbnail: `/api/stock/proxy?url=${encodeURIComponent(rawThumbnail)}`,
        url: fileLink?.link || "",
        duration: v.duration || 15
      };
    }).filter((v: any) => v.url !== ""); // filter out items missing links

    return NextResponse.json({ videos, source: "live-pexels" });
  } catch (err: any) {
    console.error("AuraClip Pexels API failed:", err);
    // Graceful fallback to static stock if API fails due to rate limits or invalid key
    const filtered = DEFAULT_STOCK.filter(video => {
      const matchesSearch = video.title.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === "all" || video.category === category;
      return matchesSearch && matchesCategory;
    });
    const mappedFallback = filtered.map(v => ({
      ...v,
      thumbnail: `/api/stock/proxy?url=${encodeURIComponent(v.thumbnail)}`
    }));
    return NextResponse.json({ videos: mappedFallback, source: "curated-fallback", error: err.message });
  }
}

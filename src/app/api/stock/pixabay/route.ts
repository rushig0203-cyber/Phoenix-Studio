import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") || "";
  const category = searchParams.get("category") || "all";
  const page = searchParams.get("page") || "1";
  const apiKey = process.env.PIXABAY_API_KEY || "";

  // Curator default fallback list when no API key is specified
  const DEFAULT_STOCK = [
    {
      id: "pix-pv-1",
      title: "Abstract Coding Grid",
      category: "coding",
      thumbnail: "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-software-developer-working-on-code-screen-4581-large.mp4",
      duration: 14
    },
    {
      id: "pix-pv-2",
      title: "Beautiful Orange Sunset",
      category: "sunset",
      thumbnail: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-waves-crashing-on-a-beach-at-sunset-4882-large.mp4",
      duration: 10
    },
    {
      id: "pix-pv-3",
      title: "Modern Collaboration Workspace",
      category: "office",
      thumbnail: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-colleagues-discussing-work-in-a-lobby-4892-large.mp4",
      duration: 12
    },
    {
      id: "pix-pv-4",
      title: "Intense Running Athletics Workout",
      category: "fitness",
      thumbnail: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-holding-hands-and-running-4888-large.mp4",
      duration: 15
    },
    {
      id: "pix-pv-5",
      title: "High Angle City Traffic",
      category: "city",
      thumbnail: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&auto=format&fit=crop&q=80",
      url: "https://assets.mixkit.co/videos/preview/mixkit-man-looking-at-city-from-a-high-balcony-4895-large.mp4",
      duration: 21
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
      const rawThumbnail = v.videos?.medium?.thumbnail || v.videos?.small?.thumbnail || v.videos?.tiny?.thumbnail || v.videos?.large?.thumbnail || "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=400&auto=format&fit=crop&q=80";

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
        thumbnail: `/api/stock/proxy?url=${encodeURIComponent(rawThumbnail)}`,
        url: fileLink,
        duration: v.duration || 15
      };
    }).filter((v: any) => v.url !== ""); // filter out items missing links

    return NextResponse.json({ videos, source: "live-pixabay" });
  } catch (err: any) {
    console.error("AuraClip Pixabay API failed:", err);
    // Graceful fallback to static stock if API fails
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

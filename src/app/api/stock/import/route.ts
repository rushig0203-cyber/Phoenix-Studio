import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const stockImport = z.object({
  title: z.string().trim().min(1).max(160),
  duration: z.number().finite().positive().max(60 * 60),
  provider: z.enum(["pexels", "pixabay"]),
  mediaId: z.string().trim().min(1).max(120),
  url: z.string().url(),
});

const providerHosts = {
  pexels: new Set(["videos.pexels.com"]),
  pixabay: new Set(["cdn.pixabay.com"]),
};

export async function POST(req: Request) {
  const parsed = stockImport.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stock video" }, { status: 400 });
  }

  const source = new URL(parsed.data.url);
  if (!providerHosts[parsed.data.provider].has(source.hostname)) {
    return NextResponse.json({ error: "Unsupported stock source" }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const existing = await db.project.findFirst({
      where: { userId, sourceProvider: parsed.data.provider, sourceMediaId: parsed.data.mediaId },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ id: existing.id, existing: true });

    const project = await db.project.create({
      data: {
        userId,
        title: parsed.data.title,
        duration: parsed.data.duration,
        originalVideoUrl: parsed.data.url,
        originalFilename: `${parsed.data.mediaId}.mp4`,
        mimeType: "video/mp4",
        sourceProvider: parsed.data.provider,
        sourceMediaId: parsed.data.mediaId,
        cloudAvailable: true,
        workflowState: "UPLOADED",
        videos: {
          create: {
            title: parsed.data.title,
            url: parsed.data.url,
            duration: parsed.data.duration,
            size: "Provider source",
          },
        },
      },
    });
    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not add stock video" }, { status: 500 });
  }
}

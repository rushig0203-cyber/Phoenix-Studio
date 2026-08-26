import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  let userId = (session?.user as any)?.id;

  const { id: projectId } = await params;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clipId = formData.get("clipId") as string | null;

    if (!file || !clipId) {
      return NextResponse.json({ error: "Missing file or clipId" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save clip file under saved_video_clips/temp_publishes/
    const dirPath = path.join(process.cwd(), "saved_video_clips", "temp_publishes");
    await fs.promises.mkdir(dirPath, { recursive: true });

    const fileName = `${projectId}_${clipId.replace(/[^a-zA-Z0-9_-]/g, "")}.mp4`;
    const filePath = path.join(dirPath, fileName);
    await fs.promises.writeFile(filePath, buffer);

    // Save clip file under public/temp_publishes/ for static localhost downloads
    try {
      const publicDirPath = path.join(process.cwd(), "public", "temp_publishes");
      await fs.promises.mkdir(publicDirPath, { recursive: true });
      const publicFilePath = path.join(publicDirPath, fileName);
      await fs.promises.writeFile(publicFilePath, buffer);
      console.log(`AuraClip: Saved static clip copy to ${publicFilePath}`);
    } catch (publicErr) {
      console.warn("AuraClip: Failed to save copy in public directory:", publicErr);
    }

    // Return the relative or absolute path for database storage
    const relativePath = path.join("saved_video_clips", "temp_publishes", fileName);

    return NextResponse.json({ success: true, path: relativePath });
  } catch (error: any) {
    console.error("Media upload API error:", error);
    return NextResponse.json({ error: error.message || "Failed to upload video media" }, { status: 500 });
  }
}

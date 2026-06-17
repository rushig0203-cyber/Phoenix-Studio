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
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const fileEntry = formData.get("file");
    const fileNameEntry = formData.get("fileName");

    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const fileName = (fileNameEntry as string) || `clip_${Date.now()}.mp4`;
    const buffer = Buffer.from(await fileEntry.arrayBuffer());

    // Output directory in workspace root
    const outDir = path.join(process.cwd(), "saved_video_clips");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, buffer);

    console.log(`AuraClip: Saved compiled clip locally to ${outPath}`);
    return NextResponse.json({ success: true, path: outPath });
  } catch (error: any) {
    console.error("Local save error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save file locally" }, { status: 500 });
  }
}

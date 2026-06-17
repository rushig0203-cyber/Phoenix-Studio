import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  try {
    const versions = await db.projectVersion.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    return NextResponse.json(versions);
  } catch (error) {
    console.error("Fetch versions error:", error);
    return NextResponse.json({ error: "Failed to fetch project versions" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;

  try {
    const { videoClips, audioClips } = await req.json();
    if (!videoClips || !audioClips) {
      return NextResponse.json({ error: "Missing timeline configuration" }, { status: 400 });
    }

    // Determine the next version sequence number
    const latestVersion = await db.projectVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });

    const newVersionNum = latestVersion ? latestVersion.version + 1 : 1;

    const version = await db.projectVersion.create({
      data: {
        projectId,
        version: newVersionNum,
        videoClipsJson: JSON.stringify(videoClips),
        audioClipsJson: JSON.stringify(audioClips),
      },
    });

    return NextResponse.json(version);
  } catch (error) {
    console.error("Create version error:", error);
    return NextResponse.json({ error: "Failed to save project version" }, { status: 500 });
  }
}

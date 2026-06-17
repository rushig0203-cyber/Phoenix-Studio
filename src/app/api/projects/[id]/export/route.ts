import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

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
    const exports = await db.export.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(exports);
  } catch (error) {
    console.error("Fetch exports error:", error);
    return NextResponse.json({ error: "Failed to fetch exports" }, { status: 500 });
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

  const userId = (session.user as any).id;
  const { id: projectId } = await params;
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

  // Rate limit compilation submissions to 3 requests per minute per IP/User
  if (!rateLimit(`export:${userId || ip}`, 3)) {
    return NextResponse.json(
      { error: "Too many export rendering requests. Please slow down." },
      { status: 429 }
    );
  }

  try {
    const { resolution, format, duration } = await req.json();

    if (!resolution || !format || duration === undefined) {
      return NextResponse.json({ error: "Missing required compilation configurations" }, { status: 400 });
    }

    // Create export record with QUEUED status to alert polling worker daemon
    const exportJob = await db.export.create({
      data: {
        projectId,
        resolution: resolution as any,
        format: format as any,
        status: "QUEUED",
        progress: 0,
        duration: parseFloat(duration),
      },
    });

    await db.activityLog.create({
      data: {
        userId,
        action: "PROJECT_EXPORT",
        details: `Queued export compilation task ${exportJob.id} (${resolution}, ${format}) for project ${projectId}.`,
        ipAddress: ip,
      },
    });

    return NextResponse.json(exportJob);
  } catch (error) {
    console.error("Create export error:", error);
    return NextResponse.json({ error: "Failed to queue export render job" }, { status: 500 });
  }
}

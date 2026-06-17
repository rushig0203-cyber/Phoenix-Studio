import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const exports = await db.export.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        project: {
          select: {
            title: true,
            user: { select: { email: true } },
          },
        },
      },
    });
    return NextResponse.json(exports);
  } catch (error) {
    console.error("Admin fetch exports error:", error);
    return NextResponse.json({ error: "Failed to fetch exports" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { exportId } = await req.json();
    if (!exportId) {
      return NextResponse.json({ error: "Missing exportId" }, { status: 400 });
    }

    const updatedExport = await db.export.update({
      where: { id: exportId },
      data: {
        status: "QUEUED",
        progress: 0,
        retryCount: 0,
        error: null,
      },
    });

    // Log admin intervention for audit logs
    const adminId = (session.user as any).id;
    await db.activityLog.create({
      data: {
        userId: adminId,
        action: "ADMIN_EXPORT_RETRY",
        details: `Manually re-queued failed video render task ${exportId}.`,
      },
    });

    return NextResponse.json(updatedExport);
  } catch (error) {
    console.error("Admin retry export error:", error);
    return NextResponse.json({ error: "Failed to retry export job" }, { status: 500 });
  }
}

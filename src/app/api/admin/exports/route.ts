import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireUserId();
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
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch historical export records" },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Background cloud render retries are disabled in free local mode.",
      action: "Open the editor and compile the video locally.",
    },
    { status: 410 },
  );
}

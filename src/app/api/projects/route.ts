import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  try {
    const projects = await db.project.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) {
    console.error("Fetch projects error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

  // Rate limit project creation requests to 5 per minute
  if (!rateLimit(`create-project:${userId || ip}`, 5)) {
    return NextResponse.json(
      { error: "Too many project creation requests. Please wait a moment." },
      { status: 429 }
    );
  }

  try {
    const { title, duration, originalVideoUrl, s3Key, size } = await req.json();
    if (!title || duration === undefined) {
      return NextResponse.json({ error: "Missing required fields (title, duration)" }, { status: 400 });
    }

    const durationMin = duration / 60;

    // Check user profile exists
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 }
      );
    }

    // Insert project records in a single database transaction
    const result = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          title,
          duration,
          originalVideoUrl,
          status: "COMPLETED", // Completed upload & parsed successfully, ready to edit
          progress: 100,
          thumbnailUrl: "/thumbnails/default-video.jpg",
        },
      });

      if (originalVideoUrl) {
        await tx.video.create({
          data: {
            projectId: project.id,
            title,
            url: originalVideoUrl,
            s3Key,
            duration,
            size,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          userId,
          action: "PROJECT_CREATE",
          details: `Created project "${title}" on Free Plan.`,
          ipAddress: ip,
        },
      });

      return project;
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}

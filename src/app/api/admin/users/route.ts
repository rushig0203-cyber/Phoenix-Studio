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
    const users = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        remainingMins: true,
        createdAt: true,
      },
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("Admin fetch users error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId, role, remainingMins } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const data: any = {};
    if (role !== undefined) data.role = role;
    if (remainingMins !== undefined) data.remainingMins = parseFloat(remainingMins);

    const updatedUser = await db.user.update({
      where: { id: userId },
      data,
    });

    // Log administrative modifications for audits
    const adminId = (session.user as any).id;
    await db.activityLog.create({
      data: {
        userId: adminId,
        action: "ADMIN_USER_UPDATE",
        details: `Modified user "${updatedUser.email}" properties: role=${role || "unchanged"}, credits=${
          remainingMins !== undefined ? remainingMins + " mins" : "unchanged"
        }.`,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Admin update user error:", error);
    return NextResponse.json({ error: "Failed to update user profile overrides" }, { status: 500 });
  }
}

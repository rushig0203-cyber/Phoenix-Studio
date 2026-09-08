import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireUserId();

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
  const adminId = await requireUserId();

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

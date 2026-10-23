import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

function stockKey(provider: string, mediaId: string) {
  return `${provider.toLowerCase()}:${mediaId}`;
}

export async function GET() {
  const userId = await requireUserId();
  try {
    const records = await db.stockMediaUse.findMany({
      where: { userId },
      select: { provider: true, mediaId: true },
      orderBy: { createdAt: "desc" },
    });
    const keys = records.map(value => stockKey(value.provider, value.mediaId));
    return NextResponse.json({ keys: [...new Set(keys)] });
  } catch {
    return NextResponse.json({ keys: [] });
  }
}

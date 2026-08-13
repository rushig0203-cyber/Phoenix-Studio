import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function stockKey(provider: string, mediaId: string) {
  return `${provider.toLowerCase()}:${mediaId}`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const records = await db.stockMediaUse.findMany({
    where: { userId },
    select: { provider: true, mediaId: true },
    orderBy: { createdAt: "desc" },
  });

  const keys = records.map(value => stockKey(value.provider, value.mediaId));

  return NextResponse.json({ keys: [...new Set(keys)] });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const provider = String(body?.provider || "").toLowerCase();
  const mediaId = String(body?.mediaId || "");
  if (!["pexels", "pixabay"].includes(provider) || !mediaId) {
    return NextResponse.json({ error: "Invalid stock media" }, { status: 400 });
  }

  const key = stockKey(provider, mediaId);
  const existing = await db.stockMediaUse.findUnique({ where: { userId_provider_mediaId: { userId, provider, mediaId } } });
  if (!existing) await db.stockMediaUse.create({ data: { userId, provider, mediaId, title: String(body?.title || "") } });
  return NextResponse.json({ key, recorded: !existing });
}

import { db } from "@/lib/db";

const OWNER_ID = process.env.AURACLIP_OWNER_ID || "auraclip-owner";

/** AuraClip is a single-owner studio: it does not require a sign-in screen. */
export async function requireUserId(): Promise<string> {
  await db.user.upsert({
    where: { id: OWNER_ID },
    update: {},
    create: { id: OWNER_ID, name: "Studio owner", role: "ADMIN" },
  });
  return OWNER_ID;
}

export function isUnauthorized(_error: unknown) {
  return false;
}

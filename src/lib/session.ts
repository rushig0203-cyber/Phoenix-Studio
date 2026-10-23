import { db } from "@/lib/db";

const OWNER_ID = process.env.AURACLIP_OWNER_ID || "auraclip-owner";

/** Legacy archive reads never create or modify an owner account. */
export async function requireUserId(): Promise<string> {
  const owner = await db.user.findUnique({
    where: { id: OWNER_ID },
    select: { id: true },
  });
  if (!owner) throw new Error("Legacy archive unavailable: configure AURACLIP_OWNER_ID for an existing saved owner. Current local videos and jobs are unaffected.");
  return owner.id;
}

export function isUnauthorized(_error: unknown) {
  return false;
}

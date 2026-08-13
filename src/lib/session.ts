import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error("UNAUTHORIZED");
  return userId;
}

export function isUnauthorized(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHORIZED";
}

import crypto from "node:crypto";

export function createOAuthState(userId: string, platform: "instagram" | "youtube") {
  const payload = Buffer.from(JSON.stringify({ userId, platform, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60_000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readOAuthState(state: string, platform: "instagram" | "youtube") {
  const [payload, signature] = state.split(".");
  const expected = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(payload).digest("base64url");
  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; platform: string; exp: number };
  if (parsed.platform !== platform || parsed.exp < Date.now()) throw new Error("Expired OAuth state");
  return parsed;
}

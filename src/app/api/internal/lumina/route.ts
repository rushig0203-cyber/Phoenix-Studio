import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLuminaManagerStatus, retryGenerationJob, runLuminaManagerCycle } from "@/lib/luminaManager";

function authorized(request: Request) {
  const expected = process.env.PHOENIX_LUMINA_SERVICE_TOKEN;
  const actual = request.headers.get("x-phoenix-service-token");
  if (!expected || !actual) return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const actionSchema = z.object({ action: z.enum(["cycle", "retry"]), jobId: z.string().min(1).optional() });

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getLuminaManagerStatus());
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = actionSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid manager action" }, { status: 400 });
  try {
    if (body.data.action === "retry") {
      if (!body.data.jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
      await retryGenerationJob(body.data.jobId);
    } else await runLuminaManagerCycle();
    return NextResponse.json(await getLuminaManagerStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manager action failed" }, { status: 409 });
  }
}

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Scheduled cloud publishing is disabled in free local mode. Export files and post them manually.",
    },
    { status: 410 }
  );
}

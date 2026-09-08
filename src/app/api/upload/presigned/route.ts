import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Cloud upload tickets are disabled in free local mode.",
      action: "Import or export through Phoenix Studio Review Files on this computer.",
    },
    { status: 410 },
  );
}

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Cloud upload finalization is disabled in free local mode.",
      action: "Import or export through Phoenix Studio Review Files on this computer.",
    },
    { status: 410 },
  );
}

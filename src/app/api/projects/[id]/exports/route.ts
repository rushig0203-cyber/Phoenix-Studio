import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Cloud export records are disabled in free local mode.",
      action: "Download the compiled MP4 directly from the editor.",
    },
    { status: 410 },
  );
}

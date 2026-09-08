import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    kind: "local",
    cloudStorageEnabled: false,
    message: "Cloud storage administration is disabled in free local mode.",
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Cloud storage cleanup is disabled in free local mode.",
      action: "Manage Phoenix Studio Review Files on this computer.",
    },
    { status: 410 },
  );
}

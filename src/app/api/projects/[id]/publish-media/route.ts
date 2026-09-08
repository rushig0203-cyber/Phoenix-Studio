import { NextResponse } from "next/server";

const response = {
  error: "Cloud publish uploads are disabled in free local mode.",
  action: "Export the video to this computer and post it manually.",
};

export async function POST() {
  return NextResponse.json(response, { status: 410 });
}

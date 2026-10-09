import { after, NextResponse } from "next/server";
import {
  assertReviewPublishRequest, listReviewPublishJobs, prepareReviewPublication,
  readReviewPublishBody, reviewPublishError, runReviewPublication,
  checkInstagramStoryCapability, confirmInstagramStoryBusiness, searchInstagramLocations, searchInstagramAudio, recommendInstagramAudio,
  getInstagramPostingDefaults, saveInstagramPostingDefaults,
} from "@/lib/reviewPublishing";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertReviewPublishRequest(request);
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    if (query.get("check") === "story") return NextResponse.json({ story: await checkInstagramStoryCapability(id, query.get("connectionRevision") || "") }, { headers });
    if (query.get("check") === "location") return NextResponse.json(await searchInstagramLocations(id, query.get("q") || "", query.get("connectionRevision") || ""), { headers });
    if (query.get("check") === "audio") return NextResponse.json(await searchInstagramAudio(id, query.get("q") || "", query.get("connectionRevision") || ""), { headers });
    if (query.get("check") === "audio-recommendations") return NextResponse.json(await recommendInstagramAudio(id, query.get("connectionRevision") || ""), { headers });
    if (query.get("check") === "posting-defaults") return NextResponse.json({ defaults: await getInstagramPostingDefaults(id, query.get("connectionRevision") || "") }, { headers });
    return NextResponse.json({ jobs: await listReviewPublishJobs(id) }, { headers });
  } catch (error) {
    const result = reviewPublishError(error);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertReviewPublishRequest(request, true);
    const { id } = await params;
    const body = await readReviewPublishBody(request);
    if (body.action === "confirm-story-business") return NextResponse.json({ story: await confirmInstagramStoryBusiness(id, body) }, { headers });
    if (body.action === "save-posting-defaults") return NextResponse.json({ defaults: await saveInstagramPostingDefaults(id, body) }, { headers });
    const result = await prepareReviewPublication(id, body);
    if (result.dispatch) after(() => runReviewPublication(id, result.job.id));
    return NextResponse.json({ job: result.job }, { status: result.dispatch ? 202 : 200, headers });
  } catch (error) {
    const result = reviewPublishError(error);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }
}

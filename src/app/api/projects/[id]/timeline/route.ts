import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId, isUnauthorized } from "@/lib/session";
import { getLocalProject } from "@/lib/localProjects";

export const dynamic = "force-dynamic";

export async function GET(_: Request,{params}:{params:Promise<{id:string}>}){
  try{const{id}=await params;if(getLocalProject(id))return NextResponse.json({});const userId=await requireUserId();const project=await db.project.findFirst({where:{id,userId},include:{versions:{orderBy:{version:"desc"},take:1}}});if(!project)return NextResponse.json({error:"Not found"},{status:404});const latest=project.versions[0];return NextResponse.json(latest?{videoClips:JSON.parse(latest.videoClipsJson),audioClips:JSON.parse(latest.audioClipsJson),elementOverlays:JSON.parse(latest.elementsJson)}:{})}catch(error){return NextResponse.json({error:isUnauthorized(error)?"Sign in required":"Timeline unavailable"},{status:isUnauthorized(error)?401:500})}
}

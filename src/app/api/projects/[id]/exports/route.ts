import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { objectExists } from "@/lib/s3";
import { requireUserId,isUnauthorized } from "@/lib/session";

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 try{const userId=await requireUserId();const{id}=await params;const project=await db.project.findFirst({where:{id,userId}});if(!project)return NextResponse.json({error:"Not found"},{status:404});const data=await req.json();const key=String(data.s3Key||"");if(!key.startsWith(`users/${userId}/exports/`))return NextResponse.json({error:"Invalid export"},{status:400});const object=await objectExists(key);if(!object.exists)return NextResponse.json({error:"Export upload incomplete"},{status:409});const result=await db.$transaction(async tx=>{const record=await tx.export.create({data:{projectId:id,status:"COMPLETED",progress:100,s3Key:key,bytes:object.bytes,duration:Number(data.duration||0)}});await tx.project.update({where:{id},data:{workflowState:"EDITED",exportedAt:new Date()}});return record});return NextResponse.json({...result,bytes:Number(result.bytes)},{status:201})}catch(error){return NextResponse.json({error:isUnauthorized(error)?"Sign in required":"Export could not be saved"},{status:isUnauthorized(error)?401:500})}
}

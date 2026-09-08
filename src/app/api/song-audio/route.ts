import { NextResponse } from "next/server";
import { stageSongAudio } from "@/lib/songAudio";
export const runtime="nodejs";
export async function GET(){return NextResponse.json({ singingAvailable:false,mode:"recording",message:"Add a real sung recording and its lyrics. Local Windows narration is for stories and does not sing." });}
export async function POST(request:Request){
  try{
    if(Number(request.headers.get("content-length"))>100*1024*1024)return NextResponse.json({error:"Maximum song size is 100 MB."},{status:413});
    const filename=decodeURIComponent(request.headers.get("x-phoenix-filename")||"");
    if(!request.body||!filename||!(/\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(filename)))return NextResponse.json({error:"Choose an MP3, WAV, M4A, FLAC, OGG or AAC song file."},{status:400});
    return NextResponse.json(await stageSongAudio(request.body,filename),{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not save song recording."},{status:400});}
}

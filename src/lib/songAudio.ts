import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { reviewRoot, safeReviewId } from "./reviewFiles";
import { lowerChildProcessPriority } from "./renderResources";

const maximumBytes=100*1024*1024;
export type SongAudio = { id:string; filename:string; duration:number; bytes:number };
const directory=()=>path.join(reviewRoot(),"song-audio");
export function songAudioPath(id:string){if(!safeReviewId(id))throw new Error("Invalid song recording.");return path.join(directory(),`${id}.audio`);}
export async function getSongAudio(id:string):Promise<SongAudio>{const audioPath=songAudioPath(id);const value=JSON.parse(await fs.readFile(path.join(directory(),`${id}.json`),"utf8")) as SongAudio;await fs.access(audioPath);return value;}
export async function requireSongAudio(id:string|undefined,duration:number){
  if(!id)throw new Error("A song needs a real sung recording. Add a song audio file and its lyrics; Windows narration cannot sing.");
  const audio=await getSongAudio(id).catch(()=>{throw new Error("The selected song recording is missing. Upload it again.");});
  if(audio.duration+.15<duration)throw new Error(`The song is ${Math.floor(audio.duration)} seconds long. Choose a video length no longer than that recording.`);
  return audio;
}
export async function stageSongAudio(body:ReadableStream<Uint8Array>,filename:string){
  await fs.mkdir(directory(),{recursive:true});const id=crypto.randomUUID(),destination=songAudioPath(id);let bytes=0;
  try{
    const bound=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;callback(bytes>maximumBytes?new Error("Song recordings must be smaller than 100 MB."):null,chunk);}});
    await pipeline(Readable.fromWeb(body as never),bound,createWriteStream(destination,{flags:"wx"}));
    const probe=process.env.PHOENIX_FFPROBE_PATH?.trim()||path.join(process.cwd(),"node_modules","@ffprobe-installer",`${process.platform}-${process.arch}`,process.platform==="win32"?"ffprobe.exe":"ffprobe");
    const result=await new Promise<string>((resolve,reject)=>{
      const child=spawn(probe,["-v","error","-show_streams","-show_format","-of","json",destination],{windowsHide:true});lowerChildProcessPriority(child.pid);let out="";
      const timer=setTimeout(()=>{child.kill();reject(new Error("Could not inspect this song recording."));},15000);
      child.stdout.on("data",c=>{out=(out+c).slice(-100000);});child.stderr.resume();child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("close",code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new Error("Choose a playable MP3, WAV, M4A or FLAC song recording."));});
    });
    const info=JSON.parse(result);const duration=Number(info.format?.duration);
    if(!info.streams?.some((s:{codec_type:string})=>s.codec_type==="audio")||!Number.isFinite(duration)||duration<20||duration>1800)throw new Error("The song must contain playable audio between 20 seconds and 30 minutes.");
    const audio:SongAudio={id,filename:path.basename(filename).slice(0,180),duration,bytes};
    await fs.writeFile(path.join(directory(),`${id}.json`),JSON.stringify(audio),"utf8");return audio;
  }catch(error){await fs.rm(destination,{force:true});throw error;}
}

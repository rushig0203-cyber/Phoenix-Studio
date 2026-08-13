import fs from "node:fs/promises";
import { db } from "./db";
import { encryptSecret } from "./secrets";

type Payload = { projectId:string;clipId:string;clipTitle:string;platform:string;caption?:string;hashtags?:string;youtubeTitle?:string;youtubeDesc?:string;youtubeTags?:string;thumbnailUrl?:string };
type Credentials = { userId?:string;instagramAccessToken?:string|null;instagramAccountId?:string|null;youtubeAccessToken?:string|null;youtubeRefreshToken?:string|null;youtubeClientId?:string|null;youtubeClientSecret?:string|null };

export async function publishToPlatform(payload:Payload,mediaPath:string,credentials:Credentials,publicMediaUrl?:string|null):Promise<{success:boolean;postUrl?:string;error?:string}>{
  try {
    if(payload.platform==="Instagram") return await publishInstagram(payload,credentials,publicMediaUrl);
    if(payload.platform==="YouTube") return await publishYouTube(payload,mediaPath,credentials);
    return {success:false,error:"Unsupported publishing platform"};
  } catch(error){return {success:false,error:error instanceof Error?error.message:"Platform publishing failed"};}
}

async function publishInstagram(payload:Payload,credentials:Credentials,publicMediaUrl?:string|null){
  const token=credentials.instagramAccessToken; const accountId=credentials.instagramAccountId;
  if(!token||!accountId)throw new Error("Instagram is not connected"); if(!publicMediaUrl)throw new Error("Instagram requires a temporary media URL");
  const create=new URL(`https://graph.facebook.com/v21.0/${accountId}/media`); create.search=new URLSearchParams({media_type:"REELS",video_url:publicMediaUrl,caption:[payload.caption,payload.hashtags].filter(Boolean).join("\n\n"),share_to_feed:"true",access_token:token}).toString();
  const createRes=await fetch(create,{method:"POST"});const created=await createRes.json();if(!createRes.ok||!created.id)throw new Error(created.error?.message||"Instagram could not create the Reel");
  let ready=false;for(let attempt=0;attempt<30;attempt++){await new Promise(resolve=>setTimeout(resolve,2000));const statusRes=await fetch(`https://graph.facebook.com/v21.0/${created.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);const status=await statusRes.json();if(status.status_code==="FINISHED"){ready=true;break;}if(status.status_code==="ERROR"||status.status_code==="EXPIRED")throw new Error(status.status||"Instagram failed to process the Reel");}
  if(!ready)throw new Error("Instagram is still processing the Reel. Retry shortly.");
  const publishRes=await fetch(`https://graph.facebook.com/v21.0/${accountId}/media_publish?creation_id=${encodeURIComponent(created.id)}&access_token=${encodeURIComponent(token)}`,{method:"POST"});const published=await publishRes.json();if(!publishRes.ok||!published.id)throw new Error(published.error?.message||"Instagram rejected the publish request");
  const permalinkRes=await fetch(`https://graph.facebook.com/v21.0/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`);const permalink=await permalinkRes.json();return {success:true,postUrl:permalink.permalink||`https://www.instagram.com/`};
}

async function publishYouTube(payload:Payload,mediaPath:string,credentials:Credentials){
  let token=credentials.youtubeAccessToken;if(!token)throw new Error("YouTube is not connected");const bytes=await fs.readFile(mediaPath);
  const metadata={snippet:{title:(payload.youtubeTitle||payload.clipTitle).slice(0,100),description:payload.youtubeDesc||"",tags:(payload.youtubeTags||payload.hashtags||"").split(/[\s,]+/).map(v=>v.replace(/^#/,"")).filter(Boolean),categoryId:"22"},status:{privacyStatus:"public",selfDeclaredMadeForKids:false}};
  async function start(accessToken:string){return fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Length":String(bytes.length),"X-Upload-Content-Type":"video/mp4"},body:JSON.stringify(metadata)});}
  let session=await start(token);if(session.status===401&&credentials.youtubeRefreshToken){const refreshed=await refreshYouTubeAccessToken(credentials);if(!refreshed)throw new Error("YouTube authorization expired. Reconnect your channel.");token=refreshed;session=await start(token);}if(!session.ok)throw new Error((await session.json()).error?.message||"YouTube could not start the upload");const uploadUrl=session.headers.get("location");if(!uploadUrl)throw new Error("YouTube did not return an upload session");
  let upload:Response|undefined;for(let attempt=0;attempt<5;attempt++){upload=await fetch(uploadUrl,{method:"PUT",headers:{Authorization:`Bearer ${token}`,"Content-Type":"video/mp4","Content-Length":String(bytes.length)},body:bytes});if(upload.ok)break;if(![500,502,503,504].includes(upload.status))break;await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}
  const result=await upload!.json();if(!upload!.ok||!result.id)throw new Error(result.error?.message||"YouTube upload failed");return {success:true,postUrl:`https://www.youtube.com/watch?v=${result.id}`};
}

export async function refreshYouTubeAccessToken(credentials:{userId?:string;youtubeClientId?:string|null;youtubeClientSecret?:string|null;youtubeRefreshToken?:string|null}){
  if(!credentials.youtubeRefreshToken)return null;const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:credentials.youtubeClientId||process.env.GOOGLE_CLIENT_ID||"",client_secret:credentials.youtubeClientSecret||process.env.GOOGLE_CLIENT_SECRET||"",refresh_token:credentials.youtubeRefreshToken,grant_type:"refresh_token"})});const data=await response.json();if(!response.ok||!data.access_token)return null;if(credentials.userId)await db.publishSettings.update({where:{userId:credentials.userId},data:{youtubeAccessToken:encryptSecret(data.access_token)}});return data.access_token as string;
}

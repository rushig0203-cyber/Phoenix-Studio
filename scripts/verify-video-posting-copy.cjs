// Opt-in one-request check using an isolated reel proof. Never touches saved jobs.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
process.chdir(project);
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:project,paths:{'@/*':['src/*']}});
const analysis=require('../src/lib/videoPostingAnalysis');
const resources=require('../src/lib/renderResources');
const policy=require('../src/lib/postingCopyPolicy');
const reviews=require('../src/lib/reviewFiles');
async function main(){
  const directory=path.resolve(process.argv[2]||'');
  const work=path.join(project,'storage','Phoenix Studio Review Files','work');
  assert.ok(directory.startsWith(work+path.sep)&&/^cinematic-stock-proof-/.test(path.basename(directory)),'Select a retained isolated cinematic proof folder.');
  assert.ok(os.freemem()>=800*1048576,'Not enough free memory for three small frame samples; no request sent.');
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'proof.json'),'utf8'));
  assert.equal(proof.output,path.join(directory,'waterfall-reel.mp4'));
  const times=analysis.sampleTimes(proof.duration);
  const admission=await resources.tryWithLocalRenderSlot(async()=>{
    const images=[];for(const seconds of times) images.push(await analysis.extractPostingFrame(proof.output,seconds));return images;
  },'Three small frames for a one-request posting-copy proof');
  assert.ok(admission.acquired,'Another operation is active; no images sent.');
  // requestVisualPosting rechecks consent, free-plan confirmation and quota.
  const response=await analysis.requestVisualPosting(admission.value,'',{sourceCount:proof.credits.length});
  const history=(await reviews.readReviewFiles()).slice(0,30).map(file=>file.quality.postCopy||'');
  const selected=policy.choosePostingCaption(response.caption,response.captionVariants,history);
  const file={source:{providerUrl:proof.credits[0].providerUrl},quality:{visualSources:proof.credits}};
  const result={checkedAt:new Date().toISOString(),model:analysis.VISION_MODEL,sampledAt:times,
    caption:analysis.visualPostCopy(selected.caption,file),hashtags:policy.videoHashtags(response.hashtags),
    observations:response.observations,confidence:response.confidence,alignment:response.alignment,
    note:'Three sampled frames, not a full-video review; no trend or views claim. No live queue or saved review copy changed.'};
  fs.writeFileSync(path.join(directory,'posting-copy-proof.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Posting proof did not complete.');process.exitCode=1;});

// Opt-in representative original story. No provider request, old-job retry,
// publication or settings changes. Retain the real MP4 for listening review.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:path.resolve(__dirname,'..'),paths:{'@/*':['src/*']}});
const {tryWithLocalRenderSlot} = require('../src/lib/renderResources');
const {renderKidsVideo} = require('../src/lib/kidsRenderer');
const {narrationBeats} = require('../src/lib/stockStoryboard');

const fixtureScript = [
  "Benny's bright kite snagged in a low tree.",
  'Benny reached for the tangled ribbon, but pulled the knot tight.',
  'Benny said, “I want to fly it now!”',
  'Tika held the ribbon steady while Benny rested his paws.',
  'Tika asked, “What if we loosen one loop first?”',
  'Benny stopped pulling and reached for the smallest loop.',
  'Together they untangled the ribbon, one gentle loop at a time.',
  'Benny said, “You hold the ribbon, and I will walk slowly.”',
  'Tika held the kite string, and Benny walked beside her.',
  'The kite lifted above the flowers without another tug.',
  'Tika said, “Look! It can dance with the breeze.”',
  'Benny waved with a happy smile, and the two friends watched their kite fly.',
].join(' ');

(async()=>{
  if(process.platform!=='win32') throw new Error('The local voice proof requires Windows.');
  if(os.freemem()<1200*1048576) throw new Error('Story proof deferred: 1200 MiB free required. No apps were closed.');
  const manager=process.argv.includes('--manager');
  let script=fixtureScript,creativeBrief;
  if(manager){
    const saved=JSON.parse(await fs.readFile(path.join(process.cwd(),'storage','Phoenix Studio Review Files','work','manager-story-quality-proof','checked-proof.json'),'utf8'));
    const {checkKidsStory}=require('../src/lib/kidsStoryQuality');
    if(saved.provider!=='groq'||saved.topic!=='Benny Bunny and Tika Bird untangle their garden kite'||!checkKidsStory(saved.script,['Benny','Tika']).ok) throw new Error('A current checked manager story is required before this render.');
    script=saved.script;creativeBrief=saved.creativeBrief;
  }
  let minimumFree = os.freemem(), maximumNodeRss = 0;
  const result=await tryWithLocalRenderSlot(async()=>{
    const monitor=setInterval(()=>{minimumFree=Math.min(minimumFree,os.freemem());maximumNodeRss=Math.max(maximumNodeRss,process.memoryUsage().rss);},500);
    try {
      const rendered=await renderKidsVideo(`story-quality-proof-${Date.now()}`,{
        topic:'Benny Bunny and Tika Bird untangle their garden kite',duration:75,creationType:'children-story',
        script,creativeBrief,scriptLocked:true,aspect:'9:16',publishingFormat:'instagram-reel',sceneNarration:narrationBeats(script,18),
      },async(percent,stage)=>console.log(`${percent}% ${stage}`));
      const directory=path.dirname(rendered.file);
      const timings=JSON.parse(await fs.readFile(path.join(directory,'audio-timing.json'),'utf8'));
      const animation=JSON.parse(await fs.readFile(path.join(directory,'animation-plan.json'),'utf8'));
      if(timings.captionTiming!=='speech-engine-word-onsets'||timings.mouthTiming!=='speech-engine-visemes') throw new Error('The representative story did not use measured dialogue/caption timing.');
      if(animation.uniqueFrames>768) throw new Error('The bounded drawing budget was exceeded.');
      const proof={...rendered,minimumFreeMiB:Math.floor(minimumFree/1048576),maximumNodeRssMiB:Math.ceil(maximumNodeRss/1048576),timings,uniqueFrames:animation.uniqueFrames,note:manager?'Actual configured Free-plan manager narration with current production checks, not a singing proof. Listening and full visual review still required.':'Owner-authored original fixture, not a manager-generated script or singing-quality proof. Listening and full visual review still required.'};
      await fs.writeFile(path.join(directory,'quality-proof.json'),JSON.stringify(proof,null,2),'utf8');
      console.log(JSON.stringify({file:rendered.file,duration:rendered.duration,uniqueFrames:animation.uniqueFrames,minimumFreeMiB:proof.minimumFreeMiB,maximumNodeRssMiB:proof.maximumNodeRssMiB,voices:timings.voices}));
    } finally {clearInterval(monitor);}
  },'Representative original story quality proof');
  if(!result.acquired) throw new Error('Existing heavy work owns the slot; no competing render started.');
})().catch(error=>{console.error(error.message);process.exitCode=1});

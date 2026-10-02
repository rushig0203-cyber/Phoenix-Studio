// An opt-in native speech proof, not a queued video or a provider request.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module:'commonjs', moduleResolution:'node' } });
const path = require('node:path');
require('tsconfig-paths').register({ baseUrl:path.resolve(__dirname,'..'), paths:{'@/*':['src/*']} });
const fs = require('node:fs/promises');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {tryWithLocalRenderSlot} = require('../src/lib/renderResources');
const {kidsVoicePlan,parseSpeechTiming,measuredKidsCaptionCues,kidsSpeechPerformance} = require('../src/lib/kidsSpeechTiming');

(async()=>{
  if(process.platform !== 'win32') throw new Error('This proof uses the installed Windows speech engine.');
  if(os.freemem()<896*1024*1024) throw new Error('Speech proof deferred: at least896 MiBfree required; no apps were closed.');
  const admitted=await tryWithLocalRenderSlot(async()=>{
    const directory=path.join(process.cwd(),'storage','Phoenix Studio Review Files','work',`speech-proof-${Date.now()}`);
    await fs.mkdir(directory,{recursive:true});
    const captions=['Pip held a tangled kite.','Pip said, “I can reach the ribbon!”','Coco asked, “Can I hold it steady?”','They untangled the ribbon together.','Pip said, “Now we can fly it!”'];
    const script=captions.join(' ');
    const text=path.join(directory,'narration.txt'),plan=path.join(directory,'voice-plan.json'),wave=path.join(directory,'narration.wav'),sidecar=path.join(directory,'speech-timing.json');
    await fs.writeFile(text,script,'utf8');
    await fs.writeFile(plan,JSON.stringify(kidsVoicePlan(script,['Pip','Coco'])),'utf8');
    await new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(process.cwd(),'scripts','synthesize-local-voice.ps1'),'-TextFile',text,'-OutputFile',wave,'-VoicePlanFile',plan,'-TimingFile',sidecar,'-Rate','0'],{windowsHide:true});
      let errors='';const timer=setTimeout(()=>{child.kill();reject(new Error('Bounded speech proof timed out.'));},45000);
      child.stderr.on('data',data=>{errors=(errors+data).slice(-5000)});
      child.on('error',error=>{clearTimeout(timer);reject(error)});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(errors||`Voice exit${code}`))});
    });
    const timing=parseSpeechTiming(JSON.parse(await fs.readFile(sidecar,'utf8')));
    if(!timing?.words.length || !timing.visemes.length) throw new Error('The installed voice did not emit measured words and visemes.');
    const end=timing.bookmarks.find(mark=>mark.name==='phoenix-end')?.seconds;
    if(!end) throw new Error('No measured completion bookmark was captured.');
    const wav = await fs.readFile(wave);
    const sampleSeconds = wav.readUInt32LE(40) / wav.readUInt32LE(28);
    if(Math.abs(sampleSeconds-end)>.001) throw new Error('Speech timeline differs from the actual PCM sample duration.');
    if(timing.words.some((word,index)=>word.seconds>=end || (index>0 && word.seconds<timing.words[index-1].seconds))) throw new Error('Speech word clocks overlapped or extended beyond the recording.');
    const cues=measuredKidsCaptionCues(captions,timing,end,end);
    if(!cues) throw new Error('Measured word text does not match the original caption script.');
    const frames=kidsSpeechPerformance(timing,end,end);
    if(!frames.some(frame=>frame.speaker===0&&frame.mouthOpen>0)||!frames.some(frame=>frame.speaker===1&&frame.mouthOpen>0)) throw new Error('Both named dialogue roles were not measured.');
    await fs.writeFile(path.join(directory,'measured-captions.json'),JSON.stringify(cues,null,2),'utf8');
    console.log(JSON.stringify({directory,seconds:end,words:timing.words.length,visemes:timing.visemes.length,voices:timing.voices,captions:cues.length,measuredRoles:[0,1]}));
  },'Small native speech timing proof');
  if(!admitted.acquired) throw new Error('Existing heavy work owns the slot; no competing speech process was started.');
})().catch(error=>{console.error(error.message);process.exitCode=1});

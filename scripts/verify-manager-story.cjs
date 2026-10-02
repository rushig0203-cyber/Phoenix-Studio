// Opt-in real selected Free-plan writer proof. No queued-job retry, video render,
// local model load, automatic publication or alternative provider.
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('tsconfig-paths').register({baseUrl:path.resolve(__dirname,'..'),paths:{'@/*':['src/*']}});
const {readWritingSettings}=require('../src/lib/writingSettings');
const {createContent}=require('../src/lib/kidsRenderer');
const {getCreativeGuidance}=require('../src/lib/qualityManager');
const {withWritingSession,isWritingWaitError}=require('../src/lib/writingModel');
const writer=require('../src/lib/writingModel');
const {checkKidsStory}=require('../src/lib/kidsStoryQuality');

(async()=>{
  const settings=readWritingSettings();
  if(settings.provider!=='groq'||!settings.apiKey||!settings.freePlanConfirmed) throw new Error('This proof needs the already-configured Groq Free writer. No local model will be loaded.');
  if(os.freemem()<700*1048576) throw new Error('Text proof deferred for memory; no provider request was made.');
  const directory=path.join(process.cwd(),'storage','Phoenix Studio Review Files','work','manager-story-quality-proof');
  await fs.mkdir(directory,{recursive:true});
  const diagnosticFetch=global.fetch;
  global.fetch=async(...args)=>{
    const response=await diagnosticFetch(...args);
    if(response.status===400&&String(args[0]).endsWith('/chat/completions')) {
      const data=await response.clone().json().catch(()=>({}));
      const message=String(data.error?.message||'');
      const code=String(data.error?.code||'');
      const keywords=['minLength','maxLength','minItems','maxItems','additionalProperties','required','strict','reasoning','include_reasoning','schema','enum'];
      const failed=typeof data.error?.failed_generation==='string'?data.error.failed_generation:'';
      let shape={json:false};
      try {const parsed=JSON.parse(failed); shape={json:true,hasLines:Array.isArray(parsed.lines),lineCount:parsed.lines?.length,wrongSpeakers:parsed.lines?.filter(line=>!['narrator','Benny','Tika'].includes(line.speaker)).length,nestedQuotes:parsed.lines?.filter(line=>/[“”"]/.test(line.text||'')).length};} catch{}
      console.log(JSON.stringify({diagnostic:'sanitized-format-error',code:/^[a-z_]{1,60}$/.test(code)?code:'unclassified',mentions:keywords.filter(keyword=>message.includes(keyword)),failedCharacters:failed.length,shape}));
    }
    return response;
  };
  const filename=path.join(directory,'input.json');
  const originalGenerate=writer.generateWritingModel;
  let candidateNumber=0;
  writer.generateWritingModel=async(...args)=>{
    const response=await originalGenerate(...args);
    const envelope=await response.clone().json();
    await fs.writeFile(path.join(directory,`candidate-${Date.now()}-${++candidateNumber}.json`),JSON.stringify({format:args[0].format?'outline':'narration',candidate:envelope.response},null,2),'utf8');
    return response;
  };
  const input={topic:'Benny Bunny and Tika Bird untangle their garden kite',duration:75,creationType:'children-story'};
  const guidance=await getCreativeGuidance('children-story');
  try {const saved=JSON.parse(await fs.readFile(filename,'utf8')); if(saved.topic===input.topic&&saved.duration===input.duration) {input.creativeBrief=saved.creativeBrief; input.creativeBriefAttempt=saved.creativeBriefAttempt; input.kidsStoryAttempt=saved.kidsStoryAttempt;}} catch(error){if(error.code!=='ENOENT') throw error;}
  if(process.argv.includes('--retry-correction')) {
    if(input.creativeBriefAttempt) input.creativeBriefAttempt.repairAttempted=false;
    if(input.kidsStoryAttempt) input.kidsStoryAttempt.repairAttempted=false;
  }
  try {
    const script=await withWritingSession(()=>createContent(input,guidance,async planned=>{
      await fs.writeFile(filename,JSON.stringify(planned,null,2),'utf8');
      console.log('Automatic original story direction saved before narration.');
    }));
    const check=checkKidsStory(script,['Benny','Tika']);
    if(!check.ok) throw new Error('Actual manager narration did not pass the production contract.');
    const narrationFile=`narration-${Date.now()}.txt`;
    await fs.writeFile(path.join(directory,narrationFile),script,'utf8');
    await fs.writeFile(path.join(directory,'checked-proof.json'),JSON.stringify({provider:'groq',duration:input.duration,topic:input.topic,script,narrationFile,creativeBrief:input.creativeBrief,check,limitation:'Actual manager narration; not rendered, independently verified or approved for posting.'},null,2),'utf8');
    console.log(JSON.stringify({directory,words:script.split(/\s+/).length,script,check}));
  } catch(error){
    if(isWritingWaitError(error)){console.log(JSON.stringify({directory,state:'quota-wait',detail:error.message,retryAfterMs:error.retryAfterMs}));return;}
    throw error;
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});

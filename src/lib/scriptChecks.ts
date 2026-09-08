// Text-only diagnostics. This does not measure acting, singing, beauty or views.
export function checkKidsScript(captions:string[],duration:number,song=false) {
  const words=captions.flatMap(caption=>caption.toLowerCase().match(/[a-z]+/g)||[]);
  const vocabularyVariety=words.length?new Set(words).size/words.length:0;
  const hook=/[!?”]|look|wait|sudden|ready|come|help|listen|clap|sing|dance/i.test(captions[0]||"");
  const resolution=/learn|together|friend|kind|happy|goodnight|smile|celebrat/i.test(captions.slice(-3).join(" "));
  const wps=words.length/Math.max(1,duration);
  const pacing=wps>=1 && wps<=2.5 ? 20 : wps>=.5 && wps<=3 ? 10 : 0;
  const readable=captions.length?Math.round(20*captions.filter(caption=>(caption.match(/\S+/g)||[]).length<=(song?10:12)).length/captions.length):0;
  const uniqueLines=new Set(captions.map(caption=>caption.toLowerCase().trim())).size;
  const variety=captions.length?Math.round(20*uniqueLines/captions.length):0;
  const score=(hook?20:0)+(resolution?20:0)+pacing+readable+variety;
  return {score,hook,resolution,vocabularyVariety,wordsPerSecond:wps,reason:`Text-only checks ${score}/100: opening ${hook?20:0}/20, ending ${resolution?20:0}/20, word pacing ${pacing}/20, caption length ${readable}/20, distinct caption lines ${variety}/20. These heuristics do not evaluate animation, singing, audio quality, originality or likely views.`};
}

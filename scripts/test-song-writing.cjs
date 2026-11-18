const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const ts=require('typescript');
const zod=require('zod');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/songWriting.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(reply){
  const calls=[];const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,process:{env:{}},require(name){
    if(name==='zod')return zod;
    if(name==='./writingModel')return{withWritingSession:async f=>f(),generateWritingModel:async request=>{calls.push(request);return typeof reply==='function'?reply(request):reply}};
    throw Error('Unexpected dependency: '+name);
  }});
  return{...module.exports,calls};
}
const lines=['A silver raindrop taps the tree','A little river hums with me','The puddle ripples soft and slow','We hear the rainy rhythm grow','A quiet chorus comes around','Then rests beside the final sound'];
const response=value=>({ok:true,json:async()=>({response:JSON.stringify(value)})});
test('new lyrics use the requested idea, language, mood and selected writer rather than a fixed lyric bank',async()=>{
  const h=harness(response({lines}));
  assert.equal(await h.writeOriginalSong({topic:'A raindrop rhythm',duration:75,language:'English',style:'Soft marimba'}),lines.join('\n'));
  assert.equal(h.calls.length,1);assert.match(h.calls[0].prompt,/A raindrop rhythm/);assert.match(h.calls[0].prompt,/Soft marimba/);
  assert.match(h.calls[0].prompt,/English song/);assert.match(h.calls[0].prompt,/same animal friendship/);
  assert.equal(h.calls[0].format.type,'object');
});
test('Hindi lyrics can be written automatically, while wrong-language output is refused before singing',async()=>{
  const hindi=['नन्हा तारा चमक रहा','नीला अम्बर दमक रहा','मीठी धुन में आओ गाओ','धीरे धीरे कदम बढ़ाओ','रात सुहानी घर को आई','अब सो जाओ नींद है छाई'];
  const h=harness(response({lines:hindi}));
  assert.equal(await h.writeOriginalSong({topic:'तारों की लोरी',duration:75,language:'Hindi'}),hindi.join('\n'));
  assert.match(h.calls[0].prompt,/Hindi song in Devanagari/);
  await assert.rejects(harness(response({lines})).writeOriginalSong({topic:'Stars',duration:75,language:'Hindi'}),/language/);
});
test('malformed lyrics and quota failures never substitute a generic song or submit singing',async()=>{
  const invalid=harness(response({lines:['Only one line']}));
  await assert.rejects(invalid.writeOriginalSong({topic:'Rain',duration:75}),/complete song lyrics/);assert.equal(invalid.calls.length,1);
  const quota=Error('Fixture quota wait');const waiting=harness(async()=>{throw quota});
  await assert.rejects(waiting.writeOriginalSong({topic:'Rain',duration:75}),error=>error===quota);assert.equal(waiting.calls.length,1);
});
test('musical direction follows the idea and preserves exact owner direction',()=>{
  const h=harness(null);
  assert.match(h.originalSongStyle('Krishna and a flower'),/flute/);
  assert.match(h.originalSongStyle('A peaceful bedtime lullaby'),/no heavy drums/);
  assert.notEqual(h.originalSongStyle('Counting dance'),h.originalSongStyle('Rain by the sea'));
  assert.equal(h.originalSongStyle('Bedtime','  Bright jazz waltz  '),'Bright jazz waltz');
});

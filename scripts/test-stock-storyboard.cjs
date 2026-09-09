const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const project = path.resolve(__dirname,'..');
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const { narrationBeats, createStockStoryboard, readStockShots } = require('../src/lib/stockStoryboard.ts');
const script = 'Open the curtains. Pour water into a glass. Write down one task. Put your phone away.';
test('all narration is kept exactly once and complete sentences form ordered sections',()=>{
  for(let count=1;count<20;count++){
    const beats=narrationBeats(script,count);
    assert.equal(beats.join(' '),script);
    assert.equal(beats.length,Math.min(count,4));
    assert.ok(beats.every(beat=>beat.endsWith('.')));
  }
});
test('owner visual terms stay with consecutive narration, not round-robin',async()=>{
  const beats=await createStockStoryboard({topic:'Calm morning',script,duration:75,visualTerms:[' opening curtains ','writing in notebook']});
  assert.deepEqual(beats,[{narration:'Open the curtains. Pour water into a glass.',query:'opening curtains'},{narration:'Write down one task. Put your phone away.',query:'writing in notebook'}]);
});
test('structured local plan preserves narration and uses only loopback Ollama with two threads',async()=>{
  const realFetch=global.fetch;
  global.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:11434/api/generate');const body=JSON.parse(init.body);assert.equal(body.options.num_thread,2);assert.equal(body.format,'json');return Response.json({response:JSON.stringify({queries:['opening curtains','pouring water','writing notebook','putting phone down']})});};
  try{const beats=await createStockStoryboard({topic:'Morning',script,duration:75});assert.equal(beats.map(beat=>beat.narration).join(' '),script);assert.equal(beats[2].query,'writing notebook');}
  finally{global.fetch=realFetch;}
});
test('bad model output fails explicitly instead of returning random filler',async()=>{
  const realFetch=global.fetch;global.fetch=async()=>Response.json({response:'{"queries":["office"]}'});
  try{await assert.rejects(createStockStoryboard({topic:'Morning',script,duration:75}),/No random footage plan was substituted/);}
  finally{global.fetch=realFetch;}
});
test('retry reuses a saved complete plan without another provider call',async()=>{
  const storyboard=[{narration:script,query:'morning routine'}];
  assert.equal(await createStockStoryboard({topic:'Morning',script,duration:75,storyboard}),storyboard);
});
test('returned shot records must cover the actual export and expose only public stock pages',()=>{
  const shot={narration:'Open curtains.',query:'opening curtains',start:0,end:2,timing:'subtitle-boundary',sourcePage:'https://www.pexels.com/video/123/?token=private'};
  assert.equal(readStockShots([shot],2)[0].sourcePage,'https://www.pexels.com/video/123/');
  assert.equal(readStockShots([{...shot,sourcePage:'javascript:alert(1)'}],2)[0].sourcePage,undefined);
  assert.throws(()=>readStockShots([shot],3),/does not cover/);
  assert.throws(()=>readStockShots([{...shot,start:1}],2),/invalid or missing/);
});

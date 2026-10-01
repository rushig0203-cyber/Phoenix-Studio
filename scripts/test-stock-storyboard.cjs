const assert = require('node:assert/strict');
const path = require('node:path');
const { test, mock } = require('node:test');
const project = path.resolve(__dirname,'..');
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
require('./mock-model-admission.cjs');
const writingSettings = require('../src/lib/writingSettings.ts');
mock.method(writingSettings, 'readWritingSettings', () => ({ provider: 'ollama', model: 'fixture:local', freePlanConfirmed: false }));
const { narrationBeats, createStockStoryboard, readStockShots } = require('../src/lib/stockStoryboard.ts');
const script = 'Open the curtains. Pour water into a glass. Write down one task. Put your phone away.';

test('explicit mismatches from the saved business plan are rejected', () => {
  const { stockQueryMismatch } = require('../src/lib/stockStoryboard.ts');
  assert.equal(stockQueryMismatch('Train representatives to listen and ask good questions.', 'chatbot answering questions'), 'chatbot');
  assert.equal(stockQueryMismatch('Use chatbots to answer simple questions quickly.', 'customer receiving follow-up call'), 'follow-up');
  assert.equal(stockQueryMismatch('Open the curtains to let in the morning light.', 'drinking coffee'), 'coffee');
  assert.equal(stockQueryMismatch('Write the next step in your notebook.', 'person writing notebook'), undefined);
});

test('repair documentation cannot match timber logs or explicit unrelated trades', () => {
  const { footageMetadataMismatch } = require('../src/lib/footageSemantics.ts');
  const { rankFootage } = require('../src/lib/automaticFootage.ts');
  assert.equal(footageMetadataMismatch('a worker cutting logs with a chainsaw', 'Owner logs repair steps'), 'timber cutting is not documenting work');
  assert.equal(footageMetadataMismatch('cutting wood logs in a forest', 'technician records service progress'), 'timber cutting is not documenting work');
  assert.equal(footageMetadataMismatch('barber cutting hair in a shop', 'repair shop technician fixes machine'), 'different trade from the requested repair');
  assert.equal(footageMetadataMismatch('chef cooking food in a kitchen', 'technician repairs laptop'), 'different trade from the requested repair');
  assert.equal(footageMetadataMismatch('young woman placing shipping label on cardboard box', 'Owner shows missing part box'), 'shipping labels do not show missing repair parts');
  assert.equal(footageMetadataMismatch('technician checking missing replacement part and shipping label', 'Owner shows missing part box'), undefined);
  assert.equal(footageMetadataMismatch('young woman placing shipping label on cardboard box', 'woman labels cardboard box for shipping'), undefined);
  assert.equal(footageMetadataMismatch('technician repairing a cooking appliance', 'technician repairs cooking appliance'), undefined);
  assert.equal(footageMetadataMismatch('owner writing repair notes', 'Owner logs repair steps'), undefined);
  assert.equal(footageMetadataMismatch('woodworker cutting timber logs', 'woodworker cuts timber logs'), undefined);
  assert.equal(footageMetadataMismatch('owner logs repair steps', 'Owner logs repair steps'), undefined);
  const choice = { id: 1, duration: 20, width: 720, height: 1280, sourcePage: 'https://www.pexels.com/video/a-worker-cutting-logs-with-a-chainsaw-123/', creator: 'Fixture' };
  assert.deepEqual(rankFootage([choice], 'Owner logs repair steps', 10, '9:16', new Set()), []);
});

test('a shifted model query gets one local repair without altering narration', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    if (++calls === 1) return Response.json({ response: JSON.stringify({ queries: ['chatbot answering questions', 'office team discussing training'] }) });
    assert.match(JSON.parse(init.body).prompt, /Do not anticipate later narration/);
    return Response.json({ response: JSON.stringify({ queries: ['office team discussing training'] }) });
  };
  try {
    const narration = 'Train the team to listen carefully. Practice asking useful questions.';
    const beats = await createStockStoryboard({ topic: 'Staff training', script: narration, duration: 60 });
    assert.equal(beats.map(beat => beat.narration).join(' '), narration);
    assert.equal(beats[0].query, 'office team discussing training');
    assert.equal(calls, 2);
  } finally { global.fetch = realFetch; }
});

test('a failed query repair cannot silently render the mismatched scene', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ response: JSON.stringify({ queries: ['drinking coffee'] }) }); };
  try { await assert.rejects(createStockStoryboard({ topic: 'Open curtains', script: 'Open the bedroom curtains.', duration: 60 }), /Repair failed/); assert.equal(calls, 2); }
  finally { global.fetch = realFetch; }
});
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

test('incomplete local shot list gets one schema-constrained repair without dropping narration', async () => {
  const realFetch = global.fetch; let calls = 0;
  global.fetch = async (_, init) => {
    calls++;
    if (calls === 1) return Response.json({ response: '{"queries":["opening curtains"]}' });
    const body = JSON.parse(init.body);
    assert.equal(body.format.properties.queries.minItems, 4);
    assert.equal(body.format.properties.queries.maxItems, 4);
    assert.equal(body.options.num_thread, 2);
    return Response.json({ response: JSON.stringify({ queries: ['opening curtains', 'pouring water', 'writing notebook', 'putting phone down'] }) });
  };
  try { const plan = await createStockStoryboard({ topic: 'Morning', script, duration: 75 }); assert.equal(plan.map(beat => beat.narration).join(' '), script); assert.equal(calls, 2); }
  finally { global.fetch = realFetch; }
});
test('retry reuses a saved complete plan without another provider call',async()=>{
  const storyboard=[{narration:script,query:'morning routine'}];
  assert.equal(await createStockStoryboard({topic:'Morning',script,duration:75,storyboard}),storyboard);
});

test('comparison structure survives both initial visual planning and malformed-list repair',async()=>{
  const realFetch=global.fetch;let calls=0;
  global.fetch=async(_,init)=>{
    const body=JSON.parse(init.body);calls++;
    assert.match(body.prompt,/Selected structure: comparison/);
    assert.match(body.prompt,/Explanations and comparisons may use different relevant subjects/);
    assert.doesNotMatch(body.prompt,/Establish one relevant real-world setting and recurring subject/);
    return Response.json({response:JSON.stringify({queries:calls===1?[]:['hand whisking batter','electric mixer mixing batter']})});
  };
  const narration='Whisk the batter by hand. An electric mixer turns the beaters for you.';
  try{const plan=await createStockStoryboard({topic:'Hand whisk or mixer',script:narration,duration:60,creativeBrief:{structure:'comparison'}});assert.equal(calls,2);assert.equal(plan.map(beat=>beat.narration).join(' '),narration);}
  finally{global.fetch=realFetch;}
});
test('returned shot records must cover the actual export and expose only public stock pages',()=>{
  const shot={narration:'Open curtains.',query:'opening curtains',start:0,end:2,timing:'subtitle-boundary',sourcePage:'https://www.pexels.com/video/123/?token=private'};
  assert.equal(readStockShots([shot],2)[0].sourcePage,'https://www.pexels.com/video/123/');
  assert.equal(readStockShots([{...shot,sourcePage:'javascript:alert(1)'}],2)[0].sourcePage,undefined);
  assert.throws(()=>readStockShots([shot],3),/does not cover/);
  assert.throws(()=>readStockShots([{...shot,start:1}],2),/invalid or missing/);
});

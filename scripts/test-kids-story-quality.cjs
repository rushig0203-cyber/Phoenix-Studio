const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {checkKidsStory,checkKidsOutline,structuredKidsStory}=require('../src/lib/kidsStoryQuality');
const {planKidsAnimationScene}=require('../src/lib/kidsAnimation');
const names=['Benny','Tika'];
const good='Benny held the kite with its string tangled around a branch. Benny said, “I want it to fly!” Tika asked, “Can we loosen one loop?” Together they untangled the string. Tika held the straight string as their kite rose above the garden. Benny waved and Tika watched the flying kite.';
test('a supported original story keeps dialogue and object continuity',()=>{
  assert.equal(checkKidsStory(good,names).ok,true);
});
test('unsupported tools, broken-string flight and ambiguous attribution cannot pass',()=>{
  const bad='Benny pulled the kite until its string snapped. Benny sighs, “Oh no!” Tika spots scissors and chirps, “We can cut it.” Tika snipped the twine. The kite rose above the garden with a rainbow trail. Tika nods, “We did it.”';
  const check=checkKidsStory(bad,names);
  assert.equal(check.ok,false);
  for(const code of ['unsupported-action','object-continuity','dialogue-identity','dialogue-balance']) assert.ok(check.issues.some(issue=>issue.code===code),code);
});
test('a wish or attempted untangle is not an actual object-state resolution',()=>{
  assert.ok(checkKidsStory(good.replace('Together they untangled the string.','They tried to untangle the string.'),names).issues.some(issue=>issue.code==='object-continuity'));
  assert.equal(checkKidsStory(good.replace('Tika held the straight string as their kite rose above the garden. Benny waved and Tika watched the flying kite.','They watched the knot. Benny said, “We will fly it later.”'),names).ok,true);
});
test('repeated quote text cannot let an unnamed voice borrow an earlier speaker',()=>{
  assert.ok(checkKidsStory('Benny said, “Hello!” Tika said, “Hello!” “Hello!”',names).issues.some(issue=>issue.code==='dialogue-identity'));
});
test('outline production contract covers age and supported causality before narration',()=>{
  const plan={audience:'Children ages 3–6',structure:'story',opening:'A kite is tangled.',beats:[{point:'They untangled the string.',visual:'A held kite becomes untangled.'}],payoff:'The kite rose over the garden.'};
  assert.equal(checkKidsOutline(plan).ok,true);
  assert.ok(checkKidsOutline({...plan,audience:'Children ages 4–7'}).issues.some(issue=>issue.code==='story-audience'));
  assert.ok(checkKidsOutline({...plan,beats:[{point:'Tika cuts the string with scissors.',visual:'A broken kite flies.'}]}).issues.some(issue=>issue.code==='unsupported-action'));
  assert.ok(checkKidsOutline({...plan,structure:'demonstration'}).issues.some(issue=>issue.code==='story-structure'));
});
test('speaker-labeled output builds exact voices without inventing an actor or stage attribution',()=>{
  const lines=[
    {speaker:'narrator',text:'Benny held a tangled kite.'},
    {speaker:'Benny',text:'I want to fly it!'},
    {speaker:'Tika',text:'Let us loosen a loop.'},
    {speaker:'narrator',text:'Every loop came free.'},
    {speaker:'narrator',text:'They watched their kite fly.'},
  ];
  const story=structuredKidsStory({lines},names);
  assert.ok(story.includes('Benny said, “I want to fly it!”'));
  assert.equal(checkKidsStory(story,names).ok,true);
  assert.throws(()=>structuredKidsStory({lines:lines.map((line,index)=>index===1?{...line,speaker:'Invented actor'}:line)},names));
  assert.throws(()=>structuredKidsStory({lines:lines.map((line,index)=>index===1?{...line,text:'“Already quoted”'}:line)},names));
});
test('checker and actual drawings share present-tense and all-loops resolution vocabulary',()=>{
  const initial=planKidsAnimationScene('garden kite','The kite is tangled in a tree.',0);
  for(const action of ['They untangle the string.','Every loop came free.','They repeated careful tugging, each loop coming free without breaking the string.','The kite straightened.']){
    const resolved=planKidsAnimationScene('garden kite',action,1,initial);
    assert.equal(resolved.kiteState,'held',action);
    const flying=planKidsAnimationScene('garden kite','They watched their kite glide.',2,resolved);
    assert.equal(flying.kiteState,'flying');
    assert.equal(checkKidsStory(good.replace('Together they untangled the string.',action),names).ok,true);
  }
  for(const attempt of ['They tried to untangle it.','We will untangle it.','Can we untangle it?']) assert.equal(planKidsAnimationScene('garden kite',attempt,1,initial).kiteState,'tangled');
  for(const proposal of ['Tika said, “Let’s untangle it.”','Tika said, “Look! The kite is free.”']) assert.equal(planKidsAnimationScene('garden kite',proposal,1,initial).kiteState,'tangled','Spoken proposals do not perform an action');
  assert.ok(checkKidsStory(good.replace('Together they untangled the string.','Tika said, “Look! We untangled the string.”'),names).issues.some(issue=>issue.code==='object-continuity'));
});

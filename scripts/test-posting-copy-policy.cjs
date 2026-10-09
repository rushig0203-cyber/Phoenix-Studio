const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {choosePostingCaption,videoHashtags,captionHashtags,postingCaptionOnly,postingAnalysisMayApply,stockPostingCaptionIssue,usesConciseStockPostingCaption,VIDEO_HASHTAG_BANK_LIMIT,INSTAGRAM_HASHTAG_LIMIT}=require('../src/lib/postingCopyPolicy');
test('stock posting copy keeps one short natural subject rather than camera or scene inventories',()=>{
  for(const copy of ['A curious dog explores the leafy path.','Rain gathers in small ripples.','A dog looks through the window frame.','Two window frames catch the afternoon light.','Three butterflies rest on bright petals.','Rain softens a quiet street scene.']) assert.equal(stockPostingCaptionIssue(copy),undefined);
  for(const copy of [
    'The camera follows a dog through the park.',
    'A first‑person view of a dog exploring the park.',
    'A turtle swims over the reef, followed by shots of waves and birds.',
    'From snow-covered peaks to a solitary trail through the sagebrush.',
    'A dog explores the park. A horse appears next.',
    'A dog runs; a horse waits; birds fly.',
    'A dog explores the park. #Dogs',
    'Butterflies of different colors and sizes are shown in three distinct scenes.',
    'Butterflies flutter across 3 separate shots.',
    'Flowers appear in several clips.',
    'A butterfly is shown resting on purple flowers.',
    'Brown horses are shown grazing beside a wire fence.',
    'A butterfly is being shown on a flower.',
    'Video shifts to a wooded clearing.',
    'Scene shifts toward the mountain trail.',
    'The mountains change in these frames.',
    'Horses graze in the sampled frames.',
    Array(25).fill('rain').join(' ')+'.',
    'a'.repeat(161),
  ]) assert.ok(stockPostingCaptionIssue(copy),copy);
});
test('concise stock posting policy excludes narrated creations and uploaded episodes',()=>{
  const file={source:{kind:'pexels'},quality:{audio:'local-music-replaced'}};
  assert.equal(usesConciseStockPostingCaption(file),true);
  assert.equal(usesConciseStockPostingCaption({...file,quality:{audio:'natural-audio-preserved'}}),true);
  for(const audio of ['local-narration-music','local-narration','supplied-song']) assert.equal(usesConciseStockPostingCaption({...file,quality:{audio}}),false);
  assert.equal(usesConciseStockPostingCaption({...file,source:{kind:'upload'}}),false);
});
test('explicit refresh chooses a grounded alternate, ignoring appended provider credits',()=>{
  const result=choosePostingCaption('Water runs over the rocky ledge.',['A waterfall fills the narrow gap between rocks.'],['Water runs over the rocky ledge.\nFootage sources: https://example.com/']);
  assert.equal(result.caption,'A waterfall fills the narrow gap between rocks.');assert.equal(result.variation,'distinct');
});
test('locally compares recent videos without inventing a fallback when all wording repeats',()=>{
  const result=choosePostingCaption('Water spills over rocks.',[],['WATER spills over rocks!\nReport source: BBC']);
  assert.equal(result.caption,'Water spills over rocks.');assert.equal(result.variation,'similar');
  assert.equal(postingCaptionOnly('Actual action.\nFootage source: URL\nReport source: X'),'Actual action.');
});
test('a strong preferred caption survives ordinary overlap with recent captions',()=>{
  const preferred='Brown horses graze in tall grass beside a wire fence.';
  const result=choosePostingCaption(preferred,['A quiet moment outdoors.'],['Brown horses graze in a green field.'],true);
  assert.equal(result.caption,preferred);assert.equal(result.variation,'distinct');
});
test('near-exact repetition selects the first valid nonrepeating alternative rather than arbitrary novelty',()=>{
  const preferred='Brown horses graze in tall grass beside a wire fence.';
  const grounded='Horses graze beside a fence in the tall grass.';
  const result=choosePostingCaption(preferred,[grounded,'A quiet moment outdoors.'],['Brown horses graze in tall grass beside a wooden fence.'],true);
  assert.equal(result.caption,grounded);assert.equal(result.variation,'distinct');
});
test('all repeated alternatives retain the preferred caption',()=>{
  const preferred='Water runs over the rocky ledge.';
  const alternate='A waterfall fills the narrow gap between rocks.';
  const result=choosePostingCaption(preferred,[alternate],[preferred,alternate],true);
  assert.equal(result.caption,preferred);assert.equal(result.variation,'similar');
});
test('stock selection skips invalid supplied alternatives and never invents a fallback',()=>{
  const preferred='Water runs over the rocky ledge.';
  const grounded='A waterfall fills the narrow gap between rocks.';
  const result=choosePostingCaption(preferred,['Water is shown beside the rocky ledge.',grounded],[preferred],true);
  assert.equal(result.caption,grounded);assert.equal(result.variation,'distinct');
  assert.throws(()=>choosePostingCaption('Birds are shown above the field.',['Scene shifts to the field.'],[],true),/No grounded posting caption/);
});
test('stock-only style restrictions do not change narrated caption selection',()=>{
  const narrated='The video shows how three gears transfer motion.';
  assert.equal(choosePostingCaption(narrated,[],[]).caption,narrated);
});
test('case-insensitive tags are bounded and engagement bait is removed',()=>{
  assert.deepEqual(videoHashtags(['#Nature','#nature','#NATURE','#Waterfall','#Viral','#fyp','#Trending','#River','#Rocks','#Outdoors','#Landscape','bad']),['#Nature','#Waterfall','#River','#Rocks','#Outdoors','#Landscape']);
});

test('candidate bank preserves up to twenty relevant choices in ranked order without padding',()=>{
  const bank=Array.from({length:25},(_,index)=>`#Subject${index}`);
  assert.equal(VIDEO_HASHTAG_BANK_LIMIT,20);assert.equal(INSTAGRAM_HASHTAG_LIMIT,5);
  assert.deepEqual(videoHashtags(bank),bank.slice(0,20));
  assert.deepEqual(videoHashtags(['#Waterfall','#viral','#ExplorePage','not-a-tag']),['#Waterfall']);
});

test('caption hashtag counting includes embedded, repeated and normalized Unicode tags',()=>{
  assert.deepEqual(captionHashtags('Visible #Waterfall, #自然\n#Waterfall ＃Forest'),['#Waterfall','#自然','#Waterfall','#Forest']);
  assert.deepEqual(captionHashtags('A caption with no tags.'),[]);
});
test('same subject tags legitimately repeat across videos rather than arbitrary novelty',()=>{
  assert.deepEqual(videoHashtags(['#Waterfall','#Nature']),videoHashtags(['#Waterfall','#Nature']));
  assert.deepEqual(videoHashtags(['#自然','#自然']),['#自然']);
});
test('late analysis cannot overwrite manual text, hashtags, replacement output or a new analysis',()=>{
  const snapshot={status:'READY',outputs:{instagram:{filename:'video.mp4'}},quality:{postCopy:'Old copy',hashtags:['#Waterfall'],postingAnalysis:{status:'ANALYZING',updatedAt:'start'}}};
  assert.equal(postingAnalysisMayApply(snapshot,snapshot,'start'),true);
  for(const current of [
    {...snapshot,quality:{...snapshot.quality,postCopy:'Owner edit'}},
    {...snapshot,quality:{...snapshot.quality,hashtags:['#OwnerTag']}},
    {...snapshot,outputs:{instagram:{filename:'replacement.mp4'}}},
    {...snapshot,quality:{...snapshot.quality,postingAnalysis:{status:'QUEUED',updatedAt:'new'}}},
    {...snapshot,editedFrom:'new-edit'},
    {...snapshot,quality:{...snapshot.quality,postingTextOrigin:'owner'}},
  ]) assert.equal(postingAnalysisMayApply(current,snapshot,'start'),false);
});

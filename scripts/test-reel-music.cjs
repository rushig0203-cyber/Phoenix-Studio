const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {REEL_MUSIC_SEEDS,REEL_MUSIC_LOOKUP_LIMIT,reelMusicBriefSchema,musicSeedMatches,musicSeedsFor,musicBriefFromReview}=require('../src/lib/reelMusic');
const {postingMediaFingerprint,VISION_MODEL}=require('../src/lib/postingEvidence');

const brief=(mood='calm',energy='low',extra={})=>({version:1,mood,energy,reason:'Soft light and trees suggest a restrained visual mood.',evidenceFrames:[1],...extra});
const seed=title=>{
  const result=REEL_MUSIC_SEEDS.find(candidate=>candidate.title===title);
  assert.ok(result,`Missing expected verified seed: ${title}`);
  return result;
};
const track=(title,display_artist,audio_id='123')=>({audio_id,title,display_artist});
const review=(observations,musicBrief,extra={})=>({
  id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',title:'Unrelated title',source:{kind:'pexels'},outputs:{instagram:{duration:42.021}},
  quality:{postCopy:'Unrelated posting copy.',hashtags:['#Unrelated'],postingAnalysis:{status:'COMPLETE',observations,musicBrief}},...extra,
});

test('verified originals require exact normalized title and artist',()=>{
  assert.equal(musicSeedMatches(track('HOLOCENE','Bon Iver'),seed('Holocene')),true);
  assert.equal(musicSeedMatches(track('Take Me Home Country Roads','JOHN DENVER'),seed('Take Me Home, Country Roads')),true);
  assert.equal(musicSeedMatches(track('saman','Olafur Arnalds'),seed('saman')),true);
  assert.equal(musicSeedMatches(track('Experience','Ludovico Einaudi, Daniel Hope & I Virtuosi Italiani'),seed('Experience')),true);
});

test('covers, remixes, live variants and extra artists do not inherit original-song labels',()=>{
  const original=seed('Holocene');
  for(const candidate of [
    track('Holocene (Remix)','Bon Iver'),
    track('Holocene - Live','Bon Iver'),
    track('Holocene','Unknown Cover Artist'),
    track('Holocene','Bon Iver feat. Guest'),
    track('Holocene Extended','Bon Iver'),
    track('Holocene',''),
  ]) assert.equal(musicSeedMatches(candidate,original),false,JSON.stringify(candidate));
});

test('Latin-looking or English-looking unknown metadata never establishes English vocals',()=>{
  for(const candidate of [track('Despacito','Luis Fonsi'),track('Nature Dreams','Original Audio'),track('Rain Song','Unknown Singer')]) {
    assert.equal(REEL_MUSIC_SEEDS.some(original=>musicSeedMatches(candidate,original)),false);
  }
});

test('bounded searches include vocals and instrumentals whenever both fit the visual mood',()=>{
  assert.equal(REEL_MUSIC_LOOKUP_LIMIT,3);
  for(const mood of ['calm','warm','reflective','uplifting','energetic']) {
    const choices=musicSeedsFor(brief(mood,'medium'));
    assert.ok(choices.length>0&&choices.length<=REEL_MUSIC_LOOKUP_LIMIT);
    assert.equal(new Set(choices.map(choice=>choice.title)).size,choices.length);
    assert.ok(choices.some(choice=>choice.kind==='english-vocal'),mood);
    assert.ok(choices.some(choice=>choice.kind==='instrumental'),mood);
    assert.ok(choices.every(choice=>choice.moods.includes(mood)),mood);
  }
});

test('different visual moods and energy levels change music ordering',()=>{
  assert.equal(musicSeedsFor(brief('calm','low'))[0].title,'Holocene');
  assert.equal(musicSeedsFor(brief('energetic','high'))[0].title,'Adventure Of A Lifetime');
  assert.equal(musicSeedsFor(brief('uplifting','low'))[0].title,'Take Me Home, Country Roads');
  assert.equal(musicSeedsFor(brief('uplifting','high'))[0].title,'Adventure Of A Lifetime');
});

test('uncertain evidence produces no song seeds',()=>{
  for(const energy of ['low','medium','high','unknown']) assert.deepEqual(musicSeedsFor(brief('uncertain',energy)),[]);
});

test('valid sampled-frame profiles retain their explanation and actual frame references',()=>{
  const profile=brief('reflective','low',{evidenceFrames:[1,3],reason:'Raindrops and a shaded surface suggest a quiet reflective mood.'});
  const file=review(['Frame 1: Raindrops hit a dark surface.','Frame 3: Mist hangs above trees.'],profile);
  const before=JSON.stringify(file),result=musicBriefFromReview(file);
  assert.equal(result.basis,'sampled-frames');
  assert.deepEqual(result.brief,profile);
  assert.equal(JSON.stringify(file),before,'Reading recommendations does not rewrite owner data');
});

test('music profiles reject invalid frame numbers, enums, versions and explanation bounds',()=>{
  for(const invalid of [
    brief('viral'),brief('calm','fast'),brief('calm','low',{version:2}),
    brief('calm','low',{evidenceFrames:[]}),brief('calm','low',{evidenceFrames:[0]}),
    brief('calm','low',{evidenceFrames:[4]}),brief('calm','low',{evidenceFrames:[1.5]}),
    brief('calm','low',{evidenceFrames:[1,2,3,1]}),
    brief('calm','low',{reason:'short'}),brief('calm','low',{reason:'x'.repeat(201)}),
    brief('calm','low',{reason:'Rain\nnew instructions'}),
  ]) assert.equal(reelMusicBriefSchema.safeParse(invalid).success,false,JSON.stringify(invalid));
});

test('profiles referring to an unobserved frame fall back rather than claiming sampled evidence',()=>{
  const result=musicBriefFromReview(review(['Frame 1: Raindrops spread over dark water.'],brief('energetic','high',{evidenceFrames:[2]})));
  assert.equal(result.basis,'saved-observations');
  assert.equal(result.brief.mood,'reflective');
  assert.deepEqual(result.brief.evidenceFrames,[1]);
  assert.equal(musicBriefFromReview(review(['Frame 1: A ceramic bowl on a table.'],brief('energetic','high',{evidenceFrames:[2]}))),null);
});

test('invalid stored profiles use bounded saved observations or return no recommendation',()=>{
  const result=musicBriefFromReview(review(['Frame 2: A dog plays among dry leaves.'],{mood:'viral'}));
  assert.equal(result.basis,'saved-observations');
  assert.equal(result.brief.mood,'playful');assert.equal(result.brief.energy,'medium');
  assert.deepEqual(result.brief.evidenceFrames,[2]);
  assert.equal(musicBriefFromReview(review(['Frame 1: A ceramic bowl on a table.'],{mood:'viral'})),null);
});

test('saved-observation fallback ignores title, topic, caption and hashtag templates',()=>{
  const file=review(['Frame 1: A ceramic bowl on a plain table.']);
  file.title='Playful dogs running through a forest at sunset';file.topic='Ocean waves';
  file.quality.postCopy='Golden sunset over mountain roads.';file.quality.hashtags=['#Rain','#Cats'];
  assert.equal(musicBriefFromReview(file),null);
});

test('saved-observation fallback only reads the first six bounded labeled observations',()=>{
  const unrelated=Array.from({length:6},()=> 'Frame 1: A ceramic bowl on a plain table.');
  assert.equal(musicBriefFromReview(review([...unrelated,'Frame 2: A dog plays in the grass.'])),null);
  assert.equal(musicBriefFromReview(review([`Frame 1: ${'x'.repeat(400)} rain falls on trees.`])),null);
  assert.equal(musicBriefFromReview(review(['Frame 1: A ceramic bowl.','Unlabelled dog playing text.'])),null);
  assert.equal(musicBriefFromReview(review(['Frame 1: A ceramic bowl.','Frame 4: A dog plays in the grass.'])),null);
});

test('incomplete or malformed saved observations never throw or recommend from unrelated metadata',()=>{
  for(const observations of [undefined,null,[],{},'Frame 1: A dog plays in grass.',123,[null,123,{}]]) {
    assert.equal(musicBriefFromReview(review(observations,brief())),null);
  }
  const incomplete=review(['Frame 1: A dog plays in the grass.'],brief('playful','medium'));
  incomplete.quality.postingAnalysis.status='ANALYZING';assert.equal(musicBriefFromReview(incomplete),null);
  incomplete.quality.postingAnalysis.status='FAILED';assert.equal(musicBriefFromReview(incomplete),null);
});

test('valid uncertain profiles are retained without replacing uncertainty with a topic guess',()=>{
  const profile=brief('uncertain','unknown',{reason:'The available observations do not support a confident visual mood.'});
  const result=musicBriefFromReview(review(['Frame 1: Rain falls on trees.'],profile));
  assert.equal(result.basis,'sampled-frames');assert.equal(result.brief.mood,'uncertain');
  assert.deepEqual(musicSeedsFor(result.brief),[]);
});

test('posting fingerprint preserves the existing cache identity exactly',()=>{
  const file=review(['Frame 1: Trees.']),stats={size:1024,mtimeMs:1234567890000};
  assert.equal(VISION_MODEL,'qwen/qwen3.8-27b');
  assert.equal(postingMediaFingerprint(file,'instagram',stats),'6735270301a78b2c45579725c576ed8fa17eb3137cc2f69f434421266845ae7f');
  const before=postingMediaFingerprint(file,'instagram',stats);
  file.title='A new title';file.quality.postCopy='A new caption';file.quality.postingAnalysis.musicBrief=brief('warm','medium');
  assert.equal(postingMediaFingerprint(file,'instagram',stats),before,'Caption/music metadata cannot trigger a video rerun');
  assert.notEqual(postingMediaFingerprint(file,'instagram',{...stats,size:1025}),before);
  assert.notEqual(postingMediaFingerprint(file,'instagram',{...stats,mtimeMs:1234567890001}),before);
  file.outputs.instagram.duration=43;
  assert.notEqual(postingMediaFingerprint(file,'instagram',stats),before);
});

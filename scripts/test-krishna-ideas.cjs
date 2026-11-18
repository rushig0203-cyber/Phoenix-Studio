const test=require('node:test');
const assert=require('node:assert/strict');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {krishnaStoryPreset,isKrishnaStoryTopic,KRISHNA_STORY_TITLE}=require('../src/lib/krishnaStory');
const {creationIntent}=require('../src/lib/creationIntent');
const {castFor}=require('../src/lib/kidsRenderer');
const {planKidsAnimationScene,kidsAnimationSvg}=require('../src/lib/kidsAnimation');
test('generic Krishna and detailed ideas retain their own topic instead of selecting the Butter Pot script',()=>{
  for(const topic of ['Krishna','Krishna 2D','Krishna and Meera watch stars at night','कृष्ण और फूलों का गीत']){
    assert.equal(isKrishnaStoryTopic(topic),true);assert.equal(krishnaStoryPreset(topic),null);
    assert.equal(castFor(topic)[0].kind,'krishna');
  }
  assert.equal(creationIntent('Krishna and Meera watch stars at night'),"Children's short story");
  assert.equal(creationIntent('कृष्ण और फूलों का गीत'),"Children's song");
  assert.equal(creationIntent('Krishna river news'),'General video');
  assert.ok(krishnaStoryPreset(KRISHNA_STORY_TITLE));
});
test('new Krishna scenes keep human artwork while following their own prop and setting',()=>{
  const topic='Krishna and Meera watch stars at night';
  const scene=planKidsAnimationScene(topic,'Krishna points to the star.');
  assert.equal(scene.theme,'night');assert.equal(scene.prop,'star');assert.equal(scene.potAction,undefined);
  const svg=kidsAnimationSvg({topic,caption:'Krishna waves beside Meera.',index:0,frame:0,scene,aspect:'9:16',cast:['krishna','meera'],castNames:['Krishna','Meera']});
  assert.match(svg,/data-character="krishna"/);assert.match(svg,/data-character="meera"/);
  assert.doesNotMatch(svg,/data-setting="courtyard"|data-prop="butter-pot"/);
  assert.equal(planKidsAnimationScene('A new Krishna pot story','Krishna holds a clay pot.').prop,'butter-pot');
  assert.equal(planKidsAnimationScene('Krishna rain song','बारिश की बूँदें गाती हैं।').prop,'rain');
  assert.equal(planKidsAnimationScene('Krishna flower song','फूलों का उपहार').prop,'flower');
  assert.equal(planKidsAnimationScene('कृष्ण और चाँद','तारे चमक रहे हैं।').theme,'night');
});

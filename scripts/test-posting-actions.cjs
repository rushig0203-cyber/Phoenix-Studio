const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node',jsx:'react-jsx'}});
require('tsconfig-paths').register({baseUrl:path.resolve(__dirname,'..'),paths:{'@/*':['src/*']}});
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Posting = require('../src/components/PostingActions').default;
const { postingDownload, postingText } = require('../src/lib/posting');
const base = { id:'fixture',title:'A waterfall',status:'READY',audience:'general',quality:{postCopy:'Water flowing over rocks. Credit: source creator.',hashtags:['#Waterfall','#Nature'],captions:['Water flowing.']},outputs:{youtube:{filename:'test.mp4'}} };
function captionDisclosure(html) {
  const summary = html.indexOf('>Caption &amp; hashtags</summary>'), start = html.lastIndexOf('<details', summary);
  assert.ok(summary >= 0 && start >= 0);
  const tags = /<\/?details\b[^>]*>/g; tags.lastIndex = start;
  let depth = 0, tag;
  while ((tag = tags.exec(html))) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { start, end: tags.lastIndex, html: html.slice(start, tags.lastIndex) };
  }
  assert.fail('Caption disclosure must close');
}

test('posting copy starts collapsed while copy and post actions stay reachable for every source',()=>{
  for(const kind of ['pexels','pixabay','upload']){
    const html=renderToStaticMarkup(React.createElement(Posting,{file:{...base,source:{kind}}}));
    assert.match(html,/Water flowing over rocks/);assert.match(html,/#Waterfall #Nature/);
    assert.match(html,/Copy caption \+ hashtags/);
    assert.match(html,/Post \/ export/);
    assert.match(html,/<details[^>]*>[\s\S]*?<summary[^>]*>More options<\/summary>[\s\S]*?Analyze video for posting copy/);
    assert.doesNotMatch(html,/Download for|Copy Instagram text|Copy YouTube text|Open YouTube upload|Open Instagram Create/);
    assert.equal((html.match(/>Copy caption \+ hashtags<\/button>/g)||[]).length,1);
    assert.equal((html.match(/>Post \/ export<\/button>/g)||[]).length,1);
    const disclosure = captionDisclosure(html);
    assert.doesNotMatch(disclosure.html, /^<details[^>]*\bopen(?:\s|=|>)/);
    assert.match(disclosure.html, /Water flowing over rocks|#Waterfall #Nature/);
    assert.ok(html.indexOf('>Copy caption + hashtags</button>') > disclosure.end, 'Copy stays outside the collapsed caption details');
    assert.ok(html.indexOf('>Post / export</button>') > disclosure.end, 'Post stays outside the collapsed caption details');
    assert.doesNotMatch(html,/<video/);
  }
});
test('platform downloads select an existing output and preserve credits in copy',()=>{
  assert.equal(postingDownload(base,'instagram').target,'youtube');
  assert.equal(postingDownload({...base,outputs:{...base.outputs,instagram:{filename:'ig.mp4'}}},'instagram').target,'instagram');
  assert.match(postingText(base),/Credit: source creator/);
  assert.equal(postingDownload({...base,outputs:{}}),null);
  assert.equal(postingDownload({...base,trashedAt:'today'}),null);
  assert.equal(postingDownload({...base,status:'FAILED'}),null);
});

test('a twenty-tag candidate bank stays available inside the collapsed caption details',()=>{
  const tags=Array.from({length:20},(_,index)=>`#Waterfall${index}`);
  const file={...base,quality:{...base.quality,hashtags:tags,postCopy:'Water cascades over rocks. #Waterfall0\nFootage source: https://pixabay.com/videos/fixture/'}};
  const html=renderToStaticMarkup(React.createElement(Posting,{file}));
  assert.match(html,/Hashtag candidate bank/);assert.match(html,/20 saved/);assert.match(html,/#Waterfall19/);
  assert.match(html,/Instagram allows up to 5 hashtags/);assert.match(html,/Post \/ export/);
  assert.match(captionDisclosure(html).html, /20 saved[\s\S]*#Waterfall19/);
  assert.doesNotMatch(html,/Copy Instagram text|Copy YouTube text|Footage source:/);
  assert.doesNotMatch(postingText(file,'instagram'),/Footage source:/);
  assert.equal((postingText(file,'instagram').match(/#Waterfall\d+/g)||[]).length,5);
  assert.equal((postingText(file,'youtube').match(/#Waterfall\d+/g)||[]).length,20);
  assert.equal((postingText(file).match(/#Waterfall\d+/g)||[]).length,20);
  assert.equal((postingText(file,'instagram').match(/#Waterfall0\b/g)||[]).length,1);
});

test('unsafe or duplicate saved tags do not reach generated posting text and owner-written excess is not silently removed',()=>{
  const file={...base,quality:{...base.quality,hashtags:['#Viral','#Nature','#nature','bad','#Waterfall']}};
  assert.equal(postingText(file,'instagram'),'Water flowing over rocks. Credit: source creator.\n\n#Nature #Waterfall');
  const owner='Owner caption #one #two #three #four #five #six';
  assert.equal(postingText({...file,quality:{...file.quality,postCopy:owner}},'instagram'),owner);
});
test('missing metadata is explicit rather than invented and children audience is flagged',()=>{
  const html=renderToStaticMarkup(React.createElement(Posting,{file:{...base,audience:'kids-3-6',quality:{hashtags:[],captions:[]}}}));
  assert.match(html,/A waterfall/);assert.match(html,/No hashtags saved/);assert.match(html,/made-for-kids/);
});
test('hashtag activity is visible as a timestamped bounded sample, never a global trending promise',()=>{
  const html=renderToStaticMarkup(React.createElement(Posting,{file:{...base,quality:{...base.quality,postingAnalysis:{status:'COMPLETE',attempts:1,updatedAt:new Date().toISOString(),detail:'Sampled actual frames.',hashtagActivity:{status:'CHECKED',checkedAt:'2026-10-04T06:00:00.000Z',detail:'Last 24 hours, limited sample, not total popularity.',samples:[{tag:'#Waterfall',recentSample:20,videos:7}]}}}}}));
  assert.match(html,/limited recent sample/);assert.match(html,/Checked:/);assert.match(html,/20 recent sampled posts, 7 video posts/);
  assert.match(html,/not total popularity/);assert.doesNotMatch(html,/7 reels/);
  const unavailable=renderToStaticMarkup(React.createElement(Posting,{file:base}));
  assert.match(unavailable,/not verified current trends/);assert.match(unavailable,/Water flowing over rocks/);
});

test('finished video status does not misrepresent missing failed or quota-waiting copy as finished captions',()=>{
  for(const status of ['FAILED','WAITING']){
    const file={...base,quality:{...base.quality,postCopy:'',postingAnalysis:{status,attempts:status==='FAILED'?3:0,updatedAt:'2026-10-10T07:00:00.000Z',nextAttemptAt:status==='WAITING'?'2026-10-10T12:00:00.000Z':undefined,detail:status==='WAITING'?"Groq's free quota is exhausted.":'Invalid evidence; retry explicitly.'}}};
    const html=renderToStaticMarkup(React.createElement(Posting,{file}));
    assert.match(html,/Video finished · caption/);assert.match(html,/No analyzed caption yet/);assert.match(html,/title is not a finished posting caption/);
    if(status==='WAITING')assert.match(html,/Next automatic check:/);
    else assert.match(html,/caption analysis failed/);
    assert.match(html,/Post \/ export/);
  }
});

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
test('posting copy and hashtags are visible for every source, with honest manual platform actions',()=>{
  for(const kind of ['pexels','pixabay','upload']){
    const html=renderToStaticMarkup(React.createElement(Posting,{file:{...base,source:{kind}}}));
    assert.match(html,/Water flowing over rocks/);assert.match(html,/#Waterfall #Nature/);
    assert.match(html,/Open YouTube upload/);assert.match(html,/Open Instagram Create/);
    assert.match(html,/do not upload or publish automatically/);
    assert.match(html,/Copy caption \+ hashtags/);
    assert.ok(html.indexOf('#Waterfall')<html.indexOf('<details'));
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
test('missing metadata is explicit rather than invented and children audience is flagged',()=>{
  const html=renderToStaticMarkup(React.createElement(Posting,{file:{...base,audience:'kids-3-6',quality:{hashtags:[],captions:[]}}}));
  assert.match(html,/A waterfall/);assert.match(html,/No hashtags saved/);assert.match(html,/made-for-kids/);
});

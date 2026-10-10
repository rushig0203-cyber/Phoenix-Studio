const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node',jsx:'react-jsx'}});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const Settings=require('../src/components/WritingProviderSettings.tsx').default;
test('caption backup has its own explicit cloud destination consent and no paid or local model promise',()=>{
  const html=renderToStaticMarkup(React.createElement(Settings));
  assert.match(html,/Caption backup · Cloudflare Free/);assert.match(html,/when Groq is quota-limited/);
  assert.match(html,/three small video frames/);assert.match(html,/Full videos and audio stay local/);
  assert.match(html,/Save caption backup/);assert.match(html,/Test caption backup/);assert.match(html,/Workers Free, not a paid plan/);
  assert.match(html,/daily 10,000 Neurons allowance/);assert.match(html,/cannot verify billing tier/);assert.match(html,/not encrypted by Phoenix/);
  assert.doesNotMatch(html,/type="checkbox"[^>]*checked/);assert.match(html,/Save writer/);
});
test('backup save dispatch is separate from selected writer credentials and preloads no secret',()=>{
  const fs=require('node:fs'),source=fs.readFileSync(path.join(__dirname,'../src/components/WritingProviderSettings.tsx'),'utf8');
  assert.match(source,/action === "save-caption-fallback"[\s\S]*apiKey: fallbackKey[\s\S]*accountId: fallbackAccount/);
  assert.match(source,/setFallbackKey\(""\)/);assert.match(source,/setFallbackAccount\(""\)/);
  assert.match(source,/setNotice\(fallbackAllowed[\s\S]*text writer is unchanged/);
});

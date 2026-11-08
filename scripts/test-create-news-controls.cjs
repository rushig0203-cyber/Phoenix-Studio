const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const krishna = require('../src/lib/krishnaStory.ts');
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : node == null ? '' : String(node);
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : [];
function pure(relative,dependencies={}){
  const filename=path.join(root,relative),mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new vm.Script(code,{filename}).runInNewContext({module:mod,exports:mod.exports,require(key){assert.ok(Object.hasOwn(dependencies,key));return dependencies[key];}});
  return mod.exports;
}
const recommendations=pure('src/lib/creationRecommendations.ts',{'./contentIdeas':pure('src/lib/contentIdeas.ts'),'./publishingFormats':{publishingProfile:()=>({defaultDuration:75})}});
function harness(name, fetch) {
  const slots = [], effects = [], pending = [], requests = [], started = [];
  let at, tree;
  const hooks = {
    useState(initial) { const i = at++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = at++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(work, deps) { const i = at++, old = effects[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: work() }; }); },
  };
  const dependencies = { react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': {}, '@/components/ui/button': { Button: 'button' }, '@/components/RecommendedIdeas': { default: 'Recommendations' },
    '@/components/NewsIdeas': { default: 'NewsIdeas' }, '@/components/InstagramTopicSuggestions': { default: 'InstagramTopics' },
    '@/lib/creationRecommendations': recommendations, '@/lib/krishnaStory': krishna,
    '@/lib/creationIntent': { creationIntent: topic => krishna.isKrishnaStoryTopic(topic) ? "Children's short story" : 'General video' },
    '@/lib/publishingFormats': { publishingProfile: () => ({ defaultDuration: 75 }) } };
  const mod = { exports: {} }, filename = path.join(root, `src/components/${name}.tsx`);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new vm.Script(code, { filename }).runInNewContext({ module: mod, exports: mod.exports, crypto: require('node:crypto').webcrypto,
    AbortController, AbortSignal, Error, fetch: async (url, init) => { requests.push({ url, ...init }); return fetch(url, init); },
    require(key) { assert.ok(Object.hasOwn(dependencies, key), key); return dependencies[key]; },
  });
  const h = { requests, started, get tree() { return tree; }, get text() { return text(tree); },
    render() { at = 0; tree = mod.exports.default({ onClose() {}, onStarted: value => started.push(value), onChoose() {} }); for (const fn of pending.splice(0)) fn(); },
    async flush() { for (let i = 0; i < 30; i++) { await Promise.resolve(); h.render(); } },
    submit() { nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  }; h.render(); return h;
}
test('empty Create gives an actionable inline message instead of silently failing native form validation', async () => {
  const h = harness('AICreation', () => assert.fail('Invalid input must not reach the server'));
  h.submit(); await h.flush();
  assert.match(h.text, /Describe your video or choose an idea\/report first/); assert.equal(h.requests.length, 0);
  assert.equal(nodes(h.tree).find(n => n.type === 'form').props.noValidate, true);
});
test('selected news submits the displayed report once and only accepts a real durable draft confirmation', async () => {
  const h = harness('AICreation', async () => Response.json({ draftIds: ['12345678-1234-4234-8234-123456789abc'], count: 1 }));
  nodes(h.tree).find(n => n.type === 'details' && text(n).includes('Explore suggestions')).props.onToggle({ currentTarget: { open: true } }); h.render();
  nodes(h.tree).find(n => n.type === 'NewsIdeas').props.onChoose({ id: 'a'.repeat(32), title: 'A selected report', url: 'https://www.bbc.co.uk/news/articles/example', publishedAt: '2026-10-30', source: 'BBC News' }); h.render();
  h.submit(); h.submit(); await h.flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].url, '/api/generations');
  assert.equal(JSON.parse(h.requests[0].body).newsId, 'a'.repeat(32)); assert.ok(h.requests[0].signal);
  assert.equal(h.started.length, 1);
});
test('choosing the Hindi Krishna starter submits the displayed title and requests natural timing', async () => {
  const h = harness('AICreation', async () => Response.json({ draftIds: ['12345678-1234-4234-8234-123456789abc'], count: 1 }));
  nodes(h.tree).find(n => n.type === 'details' && text(n).includes('Explore suggestions')).props.onToggle({ currentTarget: { open: true } }); h.render();
  nodes(h.tree).find(n => n.type === 'button' && text(n) === krishna.HINDI_KRISHNA_STORY_TITLE).props.onClick(); h.render();
  assert.match(h.text, new RegExp(krishna.HINDI_KRISHNA_STORY_TITLE));
  h.submit(); await h.flush();
  const request = JSON.parse(h.requests[0].body);
  assert.equal(request.topic, krishna.HINDI_KRISHNA_STORY_TITLE);
  assert.equal(request.creationType, 'children-story');
  assert.equal(request.autoDuration, true);
  assert.equal(h.started.length, 1);
});
test('creation failures keep the idea visible and never invent a queued job', async () => {
  for (const response of [Response.json({}), Response.json({ error: 'Renderer unavailable' }, { status: 503 })]) {
    const h = harness('AICreation', async () => response);
    nodes(h.tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Dogs playing in the garden' } }); h.render();
    h.submit(); await h.flush();
    assert.equal(h.started.length, 0); assert.match(h.text, /confirmation was unreadable|Renderer unavailable/);
    assert.ok(nodes(h.tree).some(n => n.type === 'textarea' && n.props.value === 'Dogs playing in the garden'));
  }
});

test('an exact uncertain creation retry keeps its key but a newly selected topic gets a new request',async()=>{
  const h=harness('AICreation',async()=>Response.json({error:'Fixture unavailable'},{status:503}));
  const choose=topic=>{nodes(h.tree).find(n=>n.type==='textarea').props.onChange({target:{value:topic}});h.render();};
  choose('Otters swimming in a river');h.submit();await h.flush();
  h.submit();await h.flush();
  const first=JSON.parse(h.requests[0].body),retry=JSON.parse(h.requests[1].body);
  assert.equal(retry.topic,first.topic);assert.equal(retry.requestId,first.requestId);
  choose('Why stone bridges have arches');h.submit();await h.flush();
  const changed=JSON.parse(h.requests[2].body);
  assert.equal(changed.topic,'Why stone bridges have arches');assert.notEqual(changed.requestId,first.requestId);
  assert.equal(h.started.length,0);
});

test('a newly selected topic retains custom writing visibly but only an edited field can override it',async()=>{
  const h=harness('AICreation',async()=>Response.json({error:'Fixture unavailable'},{status:503}));
  const field=label=>nodes(nodes(h.tree).find(node=>node.type==='label'&&text(node).startsWith(label))).find(node=>node.type==='textarea');
  const edit=(label,value)=>{field(label).props.onChange({target:{value}});h.render();};
  const choose=idea=>{nodes(h.tree).find(node=>node.type==='details'&&text(node).includes('Explore suggestions')).props.onToggle({currentTarget:{open:true}});h.render();nodes(h.tree).find(node=>node.type==='Recommendations').props.onChoose(idea);h.render();};
  edit('Your idea','Otters swimming in a river');
  edit('Your narration','Earlier river narration.');edit('Visual search brief','river otter swimming');
  const idea=recommendations.recommendationPool().find(idea=>idea.id==='arched-bridge:structure');choose(idea);
  assert.equal(field('Your narration').props.value,'Earlier river narration.');assert.equal(field('Visual search brief').props.value,'river otter swimming');
  assert.match(h.text,/Previous custom writing is saved but not used for this idea/);
  h.submit();await h.flush();let request=JSON.parse(h.requests.at(-1).body);
  assert.equal(request.topic,idea.title);assert.equal(request.script,undefined);assert.equal(request.visualTerms,undefined);
  edit('Your narration','A newly reviewed explanation about the bridge.');h.submit();await h.flush();request=JSON.parse(h.requests.at(-1).body);
  assert.equal(request.script,'A newly reviewed explanation about the bridge.');assert.equal(request.visualTerms,undefined);
  edit('Visual search brief','stone bridge arch');choose(idea);h.submit();await h.flush();request=JSON.parse(h.requests.at(-1).body);
  assert.equal(request.script,'A newly reviewed explanation about the bridge.');assert.deepEqual(request.visualTerms,['stone bridge arch'],'Selecting the exact same topic keeps explicitly edited writing');
  edit('Your idea','Why windmills turn');h.submit();await h.flush();request=JSON.parse(h.requests.at(-1).body);
  assert.equal(request.topic,'Why windmills turn');assert.equal(request.script,undefined);assert.equal(request.visualTerms,undefined);
  assert.equal(field('Your narration').props.value,'A newly reviewed explanation about the bridge.');
});

test('Hindi song readiness requires active lyrics after a new idea while retaining the earlier text',async()=>{
  const h=harness('AICreation',async url=>url==='/api/singing/status'?Response.json({available:true,reason:'Fixture'}):Response.json({error:'Fixture unavailable'},{status:503}));
  const choose=idea=>{nodes(h.tree).find(node=>node.type==='details'&&text(node).includes('Explore suggestions')).props.onToggle({currentTarget:{open:true}});h.render();nodes(h.tree).find(node=>node.type==='Recommendations').props.onChoose(idea);h.render();};
  const songIdeas=recommendations.recommendationPool().filter(idea=>idea.kind==="Children's song");choose(songIdeas[0]);await h.flush();
  const label=prefix=>nodes(h.tree).find(node=>node.type==='label'&&text(node).startsWith(prefix));
  nodes(label('Song language')).find(node=>node.type==='select').props.onChange({target:{value:'Hindi'}});h.render();
  nodes(h.tree).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
  const lyrics=()=>nodes(label('Lyrics, one line')).find(node=>node.type==='textarea');
  lyrics().props.onChange({target:{value:'मेरे नए गीत के बोल'}});h.render();choose(songIdeas[1]);
  assert.equal(lyrics().props.value,'मेरे नए गीत के बोल');
  assert.equal(nodes(h.tree).find(node=>node.type==='button'&&node.props.type==='submit').props.disabled,true);
  lyrics().props.onChange({target:{value:'बारिश वाले गीत के नए बोल'}});h.render();
  assert.equal(nodes(h.tree).find(node=>node.type==='button'&&node.props.type==='submit').props.disabled,false);
  h.submit();await h.flush();const request=JSON.parse(h.requests.filter(request=>request.url==='/api/generations').at(-1).body);
  assert.equal(request.topic,songIdeas[1].title);assert.equal(request.script,'बारिश वाले गीत के नए बोल');assert.equal(request.language,'Hindi');
});
test('news failures are visible and retryable, without losing earlier valid reports', async () => {
  let calls = 0;
  const item = { id: 'a', title: 'Verified fixture report', summary: 'Fixture', url: 'https://www.bbc.co.uk/news/articles/example', publishedAt: '2026-10-30' };
  const h = harness('NewsIdeas', async () => ++calls === 1 ? Response.json({ items: [item] }) : Response.json({ items: [] }));
  const click = () => nodes(h.tree).find(n => n.type === 'button').props.onClick();
  click(); click(); await h.flush(); assert.equal(calls, 1); assert.match(h.text, /Verified fixture report/);
  click(); await h.flush(); assert.equal(calls, 2); assert.match(h.text, /No recent usable reports/); assert.match(h.text, /Verified fixture report/);
  assert.equal(nodes(h.tree).find(n => n.type === 'button').props.disabled, false); h.unmount();
});

test('Refresh reports requests fresh source data and changes the visible batch without changing a selection',async()=>{
  const items=Array.from({length:16},(_,at)=>({id:String(at),title:`Report ${at}`,summary:'Fixture',url:'https://www.bbc.co.uk/news/articles/example',publishedAt:'2026-11-08'}));
  const h=harness('NewsIdeas',async()=>Response.json({items}));
  const click=()=>nodes(h.tree).find(n=>n.type==='button').props.onClick();
  click();await h.flush();
  assert.equal(nodes(h.tree).filter(n=>n.type==='article').length,8);assert.ok(h.text.includes('Report 0'));
  click();await h.flush();
  assert.equal(h.requests[1].url,'/api/news-ideas?refresh=1');
  assert.equal(nodes(h.tree).filter(n=>n.type==='article').length,8);assert.ok(h.text.includes('Report 8'));
  assert.ok(!nodes(h.tree).filter(n=>n.type==='h5').some(n=>text(n)==='Report 0'));
  h.unmount();
});

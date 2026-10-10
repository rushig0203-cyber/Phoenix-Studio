const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/instagramAudio.ts');
const moduleObject = { exports: {} };
new vm.Script(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { filename }).runInNewContext({ URL, module: moduleObject, exports: moduleObject.exports,
  require() { throw new Error('Instagram audio metadata helpers must remain dependency-free'); } });
const audio = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));
test('preview links only open the Instagram audio page, never media downloads or lookalike hosts', () => {
  assert.equal(audio.instagramAudioPreviewUrl('https://www.instagram.com/reels/audio/12345/?tracking=discard#fragment'), 'https://www.instagram.com/reels/audio/12345/');
  for (const url of ['http://www.instagram.com/reels/audio/12345/', 'https://instagram.com.evil.test/reels/audio/12345/', 'https://user:secret@www.instagram.com/reels/audio/12345/',
    'https://www.instagram.com:8443/reels/audio/12345/', 'https://scontent.cdninstagram.com/song.mp3', 'https://www.instagram.com/reel/unrelated/', 'javascript:alert(1)']) {
    assert.equal(audio.instagramAudioPreviewUrl(url), undefined);
  }
});
test('public music metadata strips provider downloads and private fields', () => {
  const result = audio.publicInstagramAudioTrack({ audio_id: '12345', title: ' Song ', display_artist: ' Artist ', audio_type: 'music', download_url: 'https://private.test/token',
    on_platform_audio_preview_link: 'https://www.instagram.com/reels/audio/12345/?tracking=x', private_token: 'secret' });
  assert.deepEqual(plain(result), { audio_id: '12345', title: 'Song', display_artist: 'Artist', preview_url: 'https://www.instagram.com/reels/audio/12345/' });
  assert.ok(!JSON.stringify(result).includes('secret'));
  for (const value of [null, [], { audio_id: 'bad', title: 'Song' }, { audio_id: '123', title: 'Song\nInjected' }, { audio_id: '123', title: 'Song', audio_type: 'original_sound' }]) assert.equal(audio.publicInstagramAudioTrack(value), null);
});
test('configuration requires the exact documented immutable fields with integer volumes 1 through 100', () => {
  const config = { audio_id: '12345', audio_volume: 100, video_volume: 1 };
  assert.deepEqual(plain(audio.instagramAudioConfiguration(config)), config);
  for (const changes of [{ audio_volume: 0 }, { audio_volume: 101 }, { video_volume: 1.5 }, { video_volume: '1' }, { audio_id: '123\n' }, { extra: true }]) assert.equal(audio.instagramAudioConfiguration({ ...config, ...changes }), null);
  assert.equal(audio.instagramAudioConfiguration({ audio_id: '12345' }), null);
  const saved = { ...config, title: 'Song', display_artist: 'Artist' };
  assert.deepEqual(plain(audio.publicInstagramAudioSelection(saved)), saved);
  assert.equal(audio.publicInstagramAudioSelection({ ...saved, preview_url: 'https://private.test' }), null);
  assert.equal(audio.INSTAGRAM_AUDIO_GRAPH_VERSION, 'v22.0');
  assert.equal(audio.INSTAGRAM_AUDIO_SEARCH_LIMIT, 6);
});

test('catalog inspection distinguishes malformed shape, empty catalog and rejected metadata', () => {
  const empty=audio.instagramAudioCatalog({audio:[]});
  assert.equal(empty.received,0);assert.equal(empty.malformed,0);assert.equal(empty.tracks.length,0);
  for(const value of [null,[],{}, {audio:{}}, {data:[]}]) {
    const result=audio.instagramAudioCatalog(value);
    assert.equal(result.received,0);assert.equal(result.malformed,1);
  }
  const rejected=audio.instagramAudioCatalog({audio:[{audio_id:'bad',title:'Broken'},null]});
  assert.equal(rejected.received,2);assert.equal(rejected.inspected,2);assert.equal(rejected.malformed,2);assert.equal(rejected.tracks.length,0);
});

test('catalog inspects thirty bounded records before selection and strips private provider fields', () => {
  const records=Array.from({length:35},(_,index)=>({audio_id:`${1000+index}`,title:`Song ${index}`,display_artist:'Fixture artist',download_url:'https://private.test/token'}));
  const result=audio.instagramAudioCatalog({audio:records});
  assert.equal(audio.INSTAGRAM_AUDIO_CATALOG_LIMIT,30);
  assert.equal(result.received,35);assert.equal(result.inspected,30);assert.equal(result.tracks.length,30);assert.equal(result.truncated,true);
  assert.ok(!JSON.stringify(result).includes('download_url'));assert.ok(!JSON.stringify(result).includes('private.test'));
});

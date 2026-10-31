// Real bundled public-domain assets and isolated files only; no accounts, model or network.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {test,after}=require('node:test');
const project=path.resolve(__dirname,'..'),previous=process.cwd();
require('ts-node').register({project:path.join(project,'tsconfig.json'),transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const library=require('../src/lib/stockMusicLibrary.ts'),manifest=require('../assets/music/lofi-cc0-v1/manifest.json');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'phoenix-music-library-test-'));
fs.cpSync(path.join(project,'assets/music/lofi-cc0-v1'),path.join(fixture,'assets/music/lofi-cc0-v1'),{recursive:true});process.chdir(fixture);
after(()=>{process.chdir(previous);assert.equal(fs.realpathSync(path.dirname(fixture)),fs.realpathSync(os.tmpdir()));assert.match(path.basename(fixture),/^phoenix-music-library-test-/);fs.rmSync(fixture,{recursive:true,force:true});});

test('six actual licensed recordings remain compact, pinned and independently readable offline',async()=>{
  assert.equal(manifest.recordings.length,6);assert.equal(manifest.licence,'CC0-1.0');
  assert.ok(manifest.recordings.reduce((sum,track)=>sum+track.bytes,0)<6*1048576);
  for(const track of manifest.recordings){
    const selection={library:'cc0-lofi-v1',trackId:track.id,offsetSeconds:12};
    const filename=await library.stockRecordingFile(selection);assert.equal(path.basename(filename),track.filename);
    const {credit}=library.stockRecordingMetadata(selection);assert.equal(credit.licence,'CC0-1.0');assert.equal(credit.originalOffsetSeconds,42);assert.equal(credit.assetSha256,track.sha256);
  }
});

test('selection avoids the last three recordings, preserves saved choices and rotates a bounded library',()=>{
  let recent=[];const used=new Set();
  for(let index=0;index<30;index++){
    const seed=`reel-${index}`,mood=['warm','reflective','journey'][index%3],selection=library.selectStockRecording(mood,seed,recent);
    assert.ok(!recent.slice(0,3).includes(selection.trackId));
    assert.deepEqual(library.selectStockRecording(mood,seed,recent),selection);
    assert.ok(selection.offsetSeconds>=0&&selection.offsetSeconds<=12);used.add(selection.trackId);recent=[selection.trackId,...recent].slice(0,20);
  }
  assert.equal(used.size,6);assert.throws(()=>library.selectStockRecording('unknown','reel',[]));
});

test('an available matching mood wins over an unused but mismatched soundtrack',()=>{
  const recent=['sweet-you','beach','work','old-saga','love-her'];
  for(let index=0;index<10;index++){
    const selection=library.selectStockRecording('reflective',`mood-regression-${index}`,recent);
    assert.equal(manifest.recordings.find(track=>track.id===selection.trackId).moods.includes('reflective'),true);
    assert.ok(!recent.slice(0,3).includes(selection.trackId));
    assert.notEqual(selection.trackId,'standing','Unused journey music must not beat a permitted reflective match');
  }
});

test('saved IDs and excerpt bounds never select arbitrary paths or silently change a damaged recording',async()=>{
  const selection={library:'cc0-lofi-v1',trackId:manifest.recordings[0].id,offsetSeconds:0};
  for(const change of [{trackId:'../../private'},{library:'other'},{offsetSeconds:-1},{offsetSeconds:13},{offsetSeconds:NaN}]) assert.throws(()=>library.stockRecordingMetadata({...selection,...change}));
  const file=await library.stockRecordingFile(selection),bytes=fs.readFileSync(file);
  const damaged=Buffer.from(bytes);damaged[0]^=255;fs.writeFileSync(file,damaged);
  await assert.rejects(library.stockRecordingFile(selection),/missing or changed/);
  fs.writeFileSync(file,bytes);await library.stockRecordingFile(selection);
});

test('preparation trims a real recording at native tempo with fades, bounded threads and no looping',()=>{
  const selection=library.selectStockRecording('warm','fixture',[]),args=library.stockRecordingPreparationArgs('asset.m4a','instrumental.flac',selection,24);
  assert.equal(args[args.indexOf('-ss')+1],String(selection.offsetSeconds));assert.equal(args[args.indexOf('-t')+1],'24.000000');
  assert.ok(!args.some(arg=>/atempo|stream_loop|aloop|loudnorm/.test(arg)));
  assert.match(args[args.indexOf('-af')+1],/afade=t=in.*afade=t=out/);
  assert.equal(args[args.indexOf('-c:a')+1],'flac');assert.equal(args[args.indexOf('-ar')+1],'48000');
  assert.throws(()=>library.stockRecordingPreparationArgs('a','b',selection,41));
});

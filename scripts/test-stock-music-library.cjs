// Real bundled public-domain assets and isolated files only; no accounts, model or network.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {test,after}=require('node:test');
const project=path.resolve(__dirname,'..'),previous=process.cwd();
const {spawnSync}=require('node:child_process');
const {recordingOnsets,measureRecording,SAMPLE_RATE}=require('./measure-stock-music-onsets.cjs');
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

test('selection prefers fresh matching recordings, preserves saved choices and rotates a bounded library',()=>{
  let recent=[];const used=new Set();
  for(let index=0;index<30;index++){
    const seed=`reel-${index}`,mood=['warm','reflective','journey'][index%3],selection=library.selectStockRecording(mood,seed,recent);
    const matching=manifest.recordings.filter(track=>track.moods.includes(mood));
    assert.ok(matching.some(track=>track.id===selection.trackId));
    if(matching.some(track=>!recent.slice(0,3).includes(track.id)))assert.ok(!recent.slice(0,3).includes(selection.trackId));
    assert.deepEqual(library.selectStockRecording(mood,seed,recent),selection);
    assert.ok(selection.offsetSeconds>=0&&selection.offsetSeconds<=12);used.add(selection.trackId);recent=[selection.trackId,...recent].slice(0,20);
  }
  assert.equal(used.size,6);assert.throws(()=>library.selectStockRecording('unknown','reel',[]));
});

test('exhausting the cooldown never trades a matching mood for an unrelated unused recording',()=>{
  for(const mood of ['warm','reflective','journey']){
    let recent=manifest.recordings.filter(track=>track.moods.includes(mood)).map(track=>track.id);
    for(let index=0;index<20;index++){
      const seed=`same-mood-${mood}-${index}`,selection=library.selectStockRecording(mood,seed,recent);
      assert.ok(manifest.recordings.find(track=>track.id===selection.trackId).moods.includes(mood));
      assert.notEqual(selection.trackId,recent[0],'Multiple suitable tracks must still rotate without consecutive repeats');
      assert.deepEqual(library.selectStockRecording(mood,seed,recent),selection,'A saved recipe must remain deterministic');
      recent=[selection.trackId,...recent].slice(0,20);
    }
  }
  assert.equal(library.selectStockRecording('reflective','matching-mood-exhausted',['old-saga','love-her','work']).trackId,'work');
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
  for(const change of [{trackId:'../../private'},{library:'other'},{offsetSeconds:-1},{offsetSeconds:13},{offsetSeconds:NaN},{offsetSeconds:.123},{timing:'unknown'},{timing:'onset-v1',offsetSeconds:.123}]) assert.throws(()=>library.stockRecordingMetadata({...selection,...change}));
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

test('onset measurement detects actual attacks but rejects silence and steady tones',()=>{
  const seconds=6,pcm=Buffer.alloc(SAMPLE_RATE*2*seconds),expected=[];
  for(let pulse=.4;pulse<5.6;pulse+=.5){
    expected.push(pulse);
    for(let at=0;at<.12*SAMPLE_RATE;at++){
      const sample=Math.sin(2*Math.PI*100*at/SAMPLE_RATE)*Math.exp(-at/(SAMPLE_RATE*.035))*.7;
      pcm.writeInt16LE(Math.round(sample*32767),(Math.round(pulse*SAMPLE_RATE)+at)*2);
    }
  }
  const measured=recordingOnsets(pcm);
  assert.equal(measured.length,expected.length);
  for(let at=0;at<expected.length;at++)assert.ok(Math.abs(measured[at]-expected[at])<=.04);
  assert.deepEqual(recordingOnsets(Buffer.alloc(pcm.length)),[]);
  const steady=Buffer.alloc(pcm.length);
  for(let at=0;at<steady.length/2;at++)steady.writeInt16LE(Math.round(Math.sin(2*Math.PI*100*at/SAMPLE_RATE)*8000),at*2);
  assert.deepEqual(recordingOnsets(steady),[]);
  assert.throws(()=>recordingOnsets(Buffer.alloc(SAMPLE_RATE*2*62)),/61 seconds/);
});

test('new recording choices start on reproducible actual attacks while legacy offsets remain unchanged',async()=>{
  const ffmpeg=path.join(project,'node_modules','@ffmpeg-installer',`${process.platform}-${process.arch}`,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
  for(const track of manifest.recordings){
    const selection={library:'cc0-lofi-v1',trackId:track.id,offsetSeconds:0};
    const measured=measureRecording(await library.stockRecordingFile(selection),ffmpeg);
    assert.ok(measured.length>=8);
    assert.equal(track.onsets.version,'low-band-onsets-v1');
    assert.ok(track.onsets.seconds.every((time,at)=>Number.isFinite(time)&&time>0&&time<60&&(!at||time>track.onsets.seconds[at-1])));
    assert.ok(track.onsets.seconds.filter(time=>measured.some(actual=>Math.abs(actual-time)<=.021)).length>=track.onsets.seconds.length*.98,track.id);
  }
  for(let at=0;at<20;at++){
    const selected=library.selectStockRecording('warm',`rhythm-${at}`,[]);
    const track=manifest.recordings.find(track=>track.id===selected.trackId);
    assert.equal(selected.timing,'onset-v1');assert.ok(track.onsets.seconds.includes(selected.offsetSeconds));
    assert.deepEqual(library.selectStockRecording('warm',`rhythm-${at}`,[]),selected);
    assert.ok(library.stockRecordingOnsets(selected).every(time=>time>0&&time<=40));
    const legacy=library.selectStockRecording('warm',`rhythm-${at}`,[],false);
    assert.equal(legacy.timing,undefined);assert.ok(Number.isInteger(legacy.offsetSeconds));assert.deepEqual(library.stockRecordingOnsets(legacy),[]);
  }
  const selection=library.selectStockRecording('warm','decode-rhythm',[]),output=path.join(fixture,'measured-music.flac');
  const result=spawnSync(ffmpeg,library.stockRecordingPreparationArgs(await library.stockRecordingFile(selection),output,selection,16),{windowsHide:true,timeout:15000,maxBuffer:100000});
  assert.equal(result.status,0,result.stderr?.toString());
  const decoded=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-threads','1','-i',output,'-ac','1','-ar','8000','-f','s16le','pipe:1'],{windowsHide:true,timeout:15000,maxBuffer:300000});
  assert.equal(decoded.status,0);assert.equal(decoded.stdout.length,16*8000*2,'Recorded track retains the complete planned duration at native tempo');
});

test('final cut timing follows measured attacks after ordering without losing frames or sampled content',()=>{
  const {planStockIntervals,reorderStockIntervals,alignStockIntervalsToOnsets,stockPostingSamples}=require('../src/lib/stockReel.ts');
  const shots=Array.from({length:6},(_,at)=>({duration:20,start:2,end:18,trimMode:'auto',motionWindows:[{start:4,end:12,motion:at+4}]}));
  const planned=planStockIntervals(shots,25,'cinematic',undefined,'adaptive-v3');
  const ordered=reorderStockIntervals(planned,[0,3,1,4,2,5]);
  const samples=stockPostingSamples(ordered),bounds=ordered.map(()=>({start:4,end:12}));
  const onsets=ordered.slice(0,-1).map((item,at)=>item.outputEnd+(at%2?.08:-.08));
  const aligned=alignStockIntervalsToOnsets(ordered,bounds,onsets,samples);
  assert.equal(aligned.adjustedCuts,ordered.length-1);
  assert.equal(aligned.intervals.at(-1).outputEnd,ordered.at(-1).outputEnd);
  assert.equal(aligned.intervals.reduce((sum,item)=>sum+item.frames,0),ordered.reduce((sum,item)=>sum+item.frames,0));
  for(let at=0;at<ordered.length;at++){
    const actual=aligned.intervals[at];assert.equal(actual.speed,ordered[at].speed);
    assert.ok(actual.start>=bounds[at].start&&actual.end<=bounds[at].end);
    assert.ok(Math.abs((actual.end-actual.start)-actual.frames/24*(actual.speed||1))<1e-6);
    if(at<onsets.length)assert.ok(Math.abs(actual.outputEnd-onsets[at])<=1/48+1e-6);
  }
  for(const sample of samples){const interval=aligned.intervals[sample.shotIndex];assert.ok(sample.sourceSeconds>=interval.start&&sample.sourceSeconds<interval.end);}
  assert.deepEqual(alignStockIntervalsToOnsets(ordered,bounds,[]).intervals,ordered);
  const exact=ordered.map(item=>({start:item.start,end:item.end}));
  assert.deepEqual(alignStockIntervalsToOnsets(ordered,exact,onsets,samples).intervals,ordered,'No source can grow outside its exact available window');
  assert.throws(()=>alignStockIntervalsToOnsets(ordered,bounds,[NaN]),/bounded/);
  assert.throws(()=>alignStockIntervalsToOnsets(ordered,bounds,[2,1]),/bounded/);
});

test('recording and start fit actual edit times before a stable tie, without defeating mood or cooldown',()=>{
  // These cuts are relative to measured Beach attacks after its .48-second start.
  const cuts=[1.96,3.04,4.74,6.96,9.04],seed='cut-fit-0';
  const plain=library.selectStockRecording('warm',seed,[]),selected=library.selectStockRecording('warm',seed,[],true,cuts);
  const hits=selection=>cuts.filter(cut=>library.stockRecordingOnsets(selection).some(onset=>Math.abs(onset-cut)<=4/24)).length;
  assert.equal(hits(selected),cuts.length);assert.ok(hits(selected)>hits(plain));
  assert.ok(manifest.recordings.find(track=>track.id===selected.trackId).moods.includes('warm'));
  assert.deepEqual(library.selectStockRecording('warm',seed,[],true,cuts),selected);
  const recent=[selected.trackId,'love-her','old-saga'];
  assert.notEqual(library.selectStockRecording('warm',seed,recent,true,cuts).trackId,selected.trackId);
  assert.deepEqual(library.selectStockRecording('warm',seed,[],false,cuts),library.selectStockRecording('warm',seed,[],false));
  for(const invalid of [[NaN],[2,1],[41],Array.from({length:12},(_,at)=>at+1)])assert.throws(()=>library.selectStockRecording('warm',seed,[],true,invalid),/ordered final edit/);
});

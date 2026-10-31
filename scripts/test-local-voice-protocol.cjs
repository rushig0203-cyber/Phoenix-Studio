const assert=require('node:assert/strict');const {test}=require('node:test');
require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',moduleResolution:'node'}});
const {LOCAL_STOCK_VOICE_PROTOCOL:value,supportsLocalStockVoice:supports}=require('../src/lib/localVoiceProtocol.ts');
test('offline voice requires an exact renderer capability including its nullable Pydantic form',()=>{
 for(const field of [{const:value},{enum:[value]},{anyOf:[{const:value,type:'string'},{type:'null'}]}])assert.equal(supports({phoenix_local_voice_protocol:field}),true);
 for(const field of [undefined,null,{}, {type:'string'},{anyOf:'wrong'},{enum:[value,'online']},{anyOf:[{const:value},{type:'string'}]}])assert.equal(supports({phoenix_local_voice_protocol:field}),false);
});
test('generation preflight rejects an older renderer before a local-voice job reaches it',async()=>{
 const generation=require('../src/lib/generation.ts'),previous=process.env.MPT_BASE_URL,original=global.fetch;
 process.env.MPT_BASE_URL='http://127.0.0.1:8080';
 const properties={phoenix_storyboard:{},phoenix_artifacts_version:{},phoenix_playback_policy:{const:'native-speed-v1'}};
 global.fetch=async()=>Response.json({components:{schemas:{TaskVideoRequest:{properties}}}});
 try{
  await assert.rejects(generation.requireStockStoryboardRenderer(false,false,true),/offline local narration/);
  properties.phoenix_local_voice_protocol={anyOf:[{const:value},{type:'null'}]};
  await generation.requireStockStoryboardRenderer(false,false,true);
 }finally{global.fetch=original;if(previous===undefined)delete process.env.MPT_BASE_URL;else process.env.MPT_BASE_URL=previous;}
});

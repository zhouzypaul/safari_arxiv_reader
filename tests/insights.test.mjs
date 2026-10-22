import test from 'node:test';
import assert from 'node:assert/strict';
import {pangramFetch,pangramResult,waitForPangram,paperText} from '../extension/paper-insights.js';
test('Pangram transport uses fixed endpoint, private result and no cookies',async()=>{
 let seen;
 await pangramFetch('/task','secret',{text:'Paper text',model:'available-model',public_dashboard_link:true},{fetcher:async(url,init)=>{seen={url,init};return {ok:true,json:async()=>({task_id:'job'})};}});
 assert.equal(seen.url,'https://text.external-api.pangram.com/task');assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.redirect,'error');assert.equal(JSON.parse(seen.init.body).public_dashboard_link,false);
 await assert.rejects(pangramFetch('//evil.test','secret'),/Unsupported/);
 await assert.rejects(pangramFetch('/task','secret',{text:'',model:'x'}),/Invalid/);
 await assert.rejects(pangramFetch('/models','secret',{},{fetcher:()=>{throw Error('should not fetch');}}),/Invalid/);
 await assert.rejects(pangramFetch('/models','secret',{},{fetcher:()=>{throw Error('should not fetch');}}),/Invalid/);
 for(const [status,message] of [[401,/rejected/],[402,/credits/],[429,/rate-limited/]])await assert.rejects(pangramFetch('/models','secret',undefined,{fetcher:async()=>({ok:false,status})}),message);
});
test('Pangram results keep AI-written and assisted separate; malformed results fail',()=>{
 assert.deepEqual(pangramResult({fraction_ai:.2,fraction_ai_assisted:.3,fraction_human:.5,prediction_short:'Mixed'}),{ai:.2,assisted:.3,human:.5,label:'Mixed'});
 for(const data of [{},{fraction_ai:2,fraction_ai_assisted:0,fraction_human:0},{fraction_ai:0,fraction_ai_assisted:0,fraction_human:0}])assert.throws(()=>pangramResult(data),/incomplete/);
});
test('polling only retrieves existing task; cancellation and timeout never resubmit',async()=>{
 let calls=0;
 const request=async(path)=>{assert.equal(path,'/task/id');calls++;return calls===1?{stage:'STAGE_PREPROCESSING'}:{stage:'STAGE_SUCCESS',fraction_ai:0,fraction_ai_assisted:0,fraction_human:1};};
 assert.equal((await waitForPangram('id','key',{request,delay:async()=>{}})).human,1);
 await assert.rejects(waitForPangram('id','key',{attempts:1,request:async()=>({stage:'STAGE_PREPROCESSING'}),delay:async()=>{}}),/resume/);
 const controller=new AbortController();controller.abort();await assert.rejects(waitForPangram('id','key',{signal:controller.signal,request:()=>{throw Error('must not call');}}),{name:'AbortError'});
 assert.equal(paperText([[{text:'Title'},{text:'Body'}],[{text:'Reference'}]]),'Title\nBody\n\nReference');
});

test('Safari uses only native messaging and does not retry a failed native request',async()=>{
 const {pangramRequest}=await import('../extension/paper-insights.js');const original=globalThis.browser;let calls=0;
 globalThis.browser={runtime:{sendNativeMessage:async(app,message)=>{calls++;assert.equal(app,'dev.papertrail.reader');assert.equal(message.path,'/models');return {error:'The Pangram API key was rejected.'};}}};
 try{await assert.rejects(pangramRequest('/models','test-only'),/rejected/);assert.equal(calls,1);}finally{if(original===undefined)delete globalThis.browser;else globalThis.browser=original;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../extension/background.js',import.meta.url),'utf8');
async function navigate(url, status='complete', granted=true) {
  let listener; const calls=[];
  const browser={runtime:{onMessage:{addListener:()=>{}}},tabs:{onUpdated:{addListener:f=>{listener=f;}}},permissions:{contains:async p=>{calls.push(['permission',p.origins[0]]);return granted;}},scripting:{executeScript:async p=>{calls.push(['inject',p.target.tabId]);}}};
  vm.runInNewContext(source,{browser,URL,console});
  await listener(7,{status},{url});return calls;
}
test('enhances completed arXiv PDFs with existing access',async()=>{
  assert.deepEqual(await navigate('https://arxiv.org/pdf/1706.03762'),[['permission','https://arxiv.org/*'],['inject',7]]);
});
test('does not prompt or inject without access',async()=>{
  assert.deepEqual(await navigate('https://arxiv.org/pdf/1706.03762','complete',false),[['permission','https://arxiv.org/*']]);
});
test('ignores unrelated sites, abstract pages, and incomplete loads',async()=>{
  for(const url of ['https://arxiv.org/abs/1706.03762','https://arxiv.org.evil.example/pdf/1','https://example.com/pdf/1'])assert.deepEqual(await navigate(url),[]);
  assert.deepEqual(await navigate('https://arxiv.org/pdf/1706.03762','loading'),[]);
});

async function scholarMessage(message,{granted=true,sender={id:'papertrail'},result={html:'<div>Scholar result</div>'},active=false,redirect=false,canonical=false,initialBlank=false}={}){
 const listeners=[],calls=[],updated=new Set(),removed=new Set();let tab;
 const browser={runtime:{id:'papertrail',onMessage:{addListener:f=>listeners.push(f)}},
 tabs:{onUpdated:{addListener:f=>updated.add(f),removeListener:f=>updated.delete(f)},onRemoved:{addListener:f=>removed.add(f),removeListener:f=>removed.delete(f)},
 create:async options=>{calls.push(['create',options]);tab={...options,id:8,status:'complete',active};if(redirect)tab.url='https://example.com/';if(canonical){const url=new URL(tab.url);url.hash='';url.searchParams.set('oi','gsb');tab.url=url.href;}if(initialBlank){const loaded={...tab};tab={...tab,url:'about:blank',status:'loading'};setTimeout(()=>{tab=loaded;for(const fn of updated)fn(tab.id,{status:'complete'},tab);},10);}return tab;},get:async()=>tab,remove:async id=>calls.push(['remove',id])},
 permissions:{contains:async()=>granted},scripting:{executeScript:async options=>{calls.push(['read',options.target.tabId]);return [{result}];}}};
 vm.runInNewContext(source,{browser,URL,console,AbortSignal,crypto,setTimeout,clearTimeout});
 const response=await listeners[1](message,sender);return {result:response,calls,updated,removed};
}
test('Scholar opens an unfocused exact-title search and cleans up its tab and listeners',async()=>{
 const {result,calls,updated,removed}=await scholarMessage({type:'papertrail-scholar',title:'Paper title',url:'https://evil.test/'});
 assert.equal(result.html,'<div>Scholar result</div>');
 const url=new URL(calls[0][1].url);assert.equal(url.origin,'https://scholar.google.com');assert.equal(url.searchParams.get('q'),'"Paper title"');assert.equal(calls[0][1].active,false);
 assert.deepEqual(calls.slice(1),[['read',8],['remove',8]]);assert.equal(updated.size,1);assert.equal(removed.size,0);
});
test('Scholar respects website access and sender identity without opening tabs',async()=>{
 const denied=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},{granted:false});assert.equal(denied.result.permissionRequired,true);assert.equal(denied.calls.length,0);
 const foreign=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},{sender:{id:'other-extension'}});assert.equal(foreign.result,undefined);assert.equal(foreign.calls.length,0);
});
test('Scholar leaves tabs the user selects or navigates intact, and preserves block errors',async()=>{
 const selected=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},{active:true});assert.equal(selected.calls.some(c=>c[0]==='remove'),false);
 const navigated=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},{redirect:true});assert.match(navigated.result.error,/interrupted/);assert.equal(navigated.calls.some(c=>c[0]==='remove'||c[0]==='read'),false);
 const blocked=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},{result:{error:'Verification required',blocked:true}});assert.equal(blocked.result.blocked,true);assert.deepEqual(blocked.calls.at(-1),['remove',8]);
});

test('Scholar tolerates initial about:blank and canonical search redirects',async()=>{
 for(const options of [{initialBlank:true},{canonical:true},{initialBlank:true,canonical:true}]){
  const {result,calls}=await scholarMessage({type:'papertrail-scholar',title:'Paper title'},options);
  assert.ok(result.html);assert.deepEqual(calls.at(-1),['remove',8]);assert.equal(calls.filter(c=>c[0]==='read').length,1);
 }
});

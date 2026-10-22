import test from 'node:test';import assert from 'node:assert/strict';
import {scholarKey,scholarURL,validScholarCount} from '../extension/scholar.js';
test('Scholar query is an exact title search, with explicit import token',()=>{
 const url=new URL(scholarURL('Attention: Is All You Need','test-token-123'));
 assert.equal(url.origin,'https://scholar.google.com');assert.equal(url.searchParams.get('q'),'"Attention: Is All You Need"');assert.equal(url.searchParams.get('hl'),'en');assert.equal(url.hash,'#papertrail=test-token-123');
 assert.equal(scholarKey(' Attention: Is All You Need '),scholarKey('attention is all you need'));
});
test('Scholar snapshots require correct paper key, valid count and a real citation link',()=>{
 const result={key:'paper',title:'Paper',count:0,checkedAt:Date.now(),url:'https://scholar.google.com/scholar?cites=123'};
 assert.equal(validScholarCount(result,'paper'),true);
 for(const bad of [{...result,key:'other'},{...result,count:null},{...result,count:-1},{...result,count:1.2},{...result,url:'https://scholar.google.com.evil.test/scholar?cites=123'},{...result,url:'javascript:alert(1)'},{...result,url:'https://scholar.google.com/scholar?q=paper'}])assert.equal(validScholarCount(bad,'paper'),false);
});

import {createScholarLookup} from '../extension/scholar.js';
const snapshot=(title='Paper',count=42,checkedAt=1000)=>({key:scholarKey(title),title,count,checkedAt,url:'https://scholar.google.com/scholar?cites=123'});
const memory=()=>{const data={};return {data,get:async(k,f)=>data[k]??f,set:async(k,v)=>{data[k]=v;}};};
test('automatic lookup shares in-flight work and reuses fresh counts',async()=>{
 const store=memory();let calls=0;const lookup=createScholarLookup(store,async()=>{calls++;return snapshot();},()=>1000);
 const results=await Promise.all([lookup('Paper'),lookup('Paper')]);
 assert.equal(calls,1);assert.equal(results[0].value.count,42);assert.equal(results[1].value.count,42);
 await lookup('Paper');assert.equal(calls,1);
});
test('blocked Scholar access backs off across papers; missing count is never zero',async()=>{
 const store=memory();let calls=0;const lookup=createScholarLookup(store,async()=>{calls++;throw Object.assign(Error('HTTP 403'),{blocked:true});},()=>1000);
 assert.equal((await lookup('Paper')).value,null);
 assert.equal((await lookup('Other paper')).value,null);assert.equal(calls,1);
});
test('failed refresh preserves dated snapshot and suppresses repeated errors',async()=>{
 const store=memory();store.data['papertrail-scholar-counts']={paper:snapshot()};let calls=0;
 const lookup=createScholarLookup(store,async()=>{calls++;throw Error('Offline');},()=>8*86400000);
 const result=await lookup('Paper');assert.equal(result.value.count,42);assert.equal(result.error,'Offline');
 await lookup('Paper');assert.equal(calls,1);
});

test('transient failures retry after short backoff and clear their failure on success',async()=>{
 const store=memory();let time=1000,calls=0;
 const lookup=createScholarLookup(store,async()=>{if(++calls===1)throw Error('Navigation timed out');return snapshot('Paper',42,time);},()=>time);
 const first=await lookup('Paper');assert.equal(first.kind,'temporary');assert.equal(first.retryAt,31000);
 time=30000;await lookup('Paper');assert.equal(calls,1);
 time=31001;assert.equal((await lookup('Paper')).value.count,42);assert.equal(calls,2);
 assert.equal(store.data['papertrail-scholar-tab-attempts'].paper,undefined);
});
test('legacy cached failures do not trap a repaired lookup for another hour',async()=>{
 const store=memory();store.data['papertrail-scholar-tab-attempts']={paper:{until:3601000,error:'The first result did not match'}};
 let calls=0;const lookup=createScholarLookup(store,async()=>{calls++;return snapshot();},()=>1000);
 assert.equal((await lookup('Paper')).value.count,42);assert.equal(calls,1);
});
test('old access challenges retain a bounded cooldown; new challenges are not repeatedly requested',async()=>{
 const store=memory();store.data['papertrail-scholar-tab-attempts']={blockedUntil:86401000};let calls=0,time=1000;
 const lookup=createScholarLookup(store,async()=>{calls++;return snapshot('Paper',42,time);},()=>time);
 assert.equal((await lookup('Paper')).kind,'blocked');assert.equal(calls,0);
 time=1801001;assert.equal((await lookup('Paper')).value.count,42);assert.equal(calls,1);
});
test('no-count and not-found are distinct from access failure, with no invented zero',async()=>{
 for(const kind of ['no-count','not-found']){
  const store=memory();const lookup=createScholarLookup(store,async()=>{throw Object.assign(Error('Not available'),{kind});},()=>1000);
  const result=await lookup('Paper');assert.equal(result.value,null);assert.equal(result.kind,kind);assert.equal(result.retryAt,21601000);
 }
});

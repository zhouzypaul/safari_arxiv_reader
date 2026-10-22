import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(process.env.PAPERTRAIL_RUNTIME||import.meta.url);
const {webkit}=require('playwright');
const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://reader.test/**',async r=>{const file='extension'+new URL(r.request().url()).pathname;await r.fulfill({body:await fs.readFile(file),contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.route('https://api.openalex.org/**',r=>r.fulfill({json:{results:[{id:'https://openalex.org/W123',title:'Attention Is All You Need',cited_by_count:123456}]}}));
 let submitted=0,modelCalls=0,polls=0,failCredits=false;
 await page.route('https://text.external-api.pangram.com/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/models'){modelCalls++;return r.fulfill({json:{models:['default','pangram-4']}});}
  if(path==='/task'){
   const body=r.request().postDataJSON();assert.equal(body.public_dashboard_link,false);assert.ok(body.text.includes('Attention'));assert.equal(body.model,'default');submitted++;
   return failCredits?r.fulfill({status:402,json:{}}):r.fulfill({json:{task_id:'test-task'}});
  }
  polls++;return r.fulfill({json:polls===1?{stage:'STAGE_PREPROCESSING'}:{stage:'STAGE_SUCCESS',fraction_ai:.12,fraction_ai_assisted:.23,fraction_human:.65}});
 });
 await page.addInitScript(()=>{window.scholarCalls=0;window.browser={runtime:{sendMessage:async(message)=>{if(message.type==='papertrail-scholar'){window.scholarCalls++;return {html:'<div class="gs_r"><h3 class="gs_rt"><a>Attention Is All You Need</a></h3><a href="/scholar?cites=123456">Cited by 12,345</a></div>'};}throw Error('Unexpected native call');}}};});
 await page.goto('https://reader.test/reader.html');
 // Pangram continues using the mocked HTTP transport in this suite.
 await page.evaluate(()=>{window.browser.runtime.sendNativeMessage=async(app,message)=>{const response=await fetch('https://text.external-api.pangram.com'+message.path,{method:message.body?'POST':'GET',headers:{'Content-Type':'application/json'},body:message.body?JSON.stringify({...message.body,public_dashboard_link:false}):undefined});return response.ok?{data:await response.json()}:{error:'Your Pangram account needs API credits.'};};});
 const fixture=process.env.PAPERTRAIL_FIXTURES+'/attention.pdf';
 await page.locator('#file').setInputFiles(fixture);
 await page.waitForFunction(()=>document.querySelector('#citation-count').textContent==='12,345 citations · Scholar');
 assert.equal(await page.locator('header #rotate, header .brand, #references-tab, #references').count(),0);
 assert.equal(await page.locator('#title').textContent(),'Attention Is All You Need');
 assert.equal(await page.locator('button#citation-count').count(),0);
 assert.equal(await page.evaluate(()=>window.scholarCalls),1);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 assert.equal(await page.evaluate(()=>window.scholarCalls),1);
 assert.equal(submitted,0);assert.equal(modelCalls,0);
 await page.locator('#pangram').click();assert.equal(submitted,0);
 await page.locator('#pangram-key').fill('test-only-key');await page.locator('#pangram-models').click();await page.waitForFunction(()=>!document.querySelector('#pangram-send').disabled);
 assert.equal(submitted,0);assert.equal(await page.locator('#pangram-key').inputValue(),'');
 await page.locator('#pangram-send').click();await page.waitForFunction(()=>document.querySelector('#pangram-result').textContent.includes('12.0%'));
 assert.match(await page.locator('#pangram-result').textContent(),/23.0% AI-assisted/);assert.equal(submitted,1);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/pangram/i.test(k))),false);
 await page.screenshot({path:'insights-preview.png'});
 await page.locator('#close-pangram').click();await page.locator('#file').setInputFiles(fixture);await page.waitForFunction(()=>document.querySelector('#pangram').textContent==='AI check');await page.waitForFunction(()=>!document.querySelector('#pangram').disabled);
 assert.equal(await page.locator('#pangram').textContent(),'AI check');assert.equal(await page.locator('#pangram-result').textContent(),'');
 failCredits=true;await page.locator('#pangram').click();await page.locator('#pangram-send').click();await page.waitForFunction(()=>document.querySelector('#pangram-status').textContent.includes('credits'));
 assert.equal(await page.locator('#pangram-result').textContent(),'');
 await page.locator('#close-pangram').click();await page.setViewportSize({width:1100,height:850});
 const bounds=await page.locator('#citation-count').boundingBox();assert.ok(bounds.x+bounds.width<=1100);assert.equal(await page.locator('#title').isVisible(),true);
 await page.evaluate(()=>{localStorage.removeItem('papertrail-scholar-counts');window.browser.runtime.sendMessage=async()=>{window.scholarCalls++;return {error:'Google Scholar returned HTTP 403.',blocked:true};};window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>document.querySelector('#citation-count').textContent==='Scholar verification needed');
 assert.match(await page.locator('#citation-count').getAttribute('title'),/403/);
 assert.equal(await page.evaluate(()=>window.scholarCalls),2);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.querySelector('#citation-count').textContent==='Scholar verification needed');
 assert.equal(await page.evaluate(()=>window.scholarCalls),2);
 // A temporary failure gets one bounded automatic retry; a verified count
 // replaces the error without reloading the PDF or changing tabs.
 await page.evaluate(()=>{localStorage.removeItem('papertrail-scholar-tab-attempts');window.retryCalls=0;window.browser.runtime.sendMessage=async()=>++window.retryCalls===1?{error:'Lookup timed out'}:{html:'<div class="gs_r"><h3 class="gs_rt"><a>Attention Is All You Need</a></h3><a href="/scholar?cites=123456">Cited by 12,346</a></div>'};window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>document.querySelector('#citation-count').textContent==='Scholar unavailable');
 await page.waitForFunction(()=>document.querySelector('#citation-count').textContent==='12,346 citations · Scholar',{},{timeout:35000});
 assert.equal(await page.evaluate(()=>window.retryCalls),2);
 assert.equal(page.context().pages().length,1);
 assert.deepEqual(errors,[]);console.log('PASS: citation count, no automatic Pangram calls, model discovery, paid submission, percentages, private results, document reset, credits errors, toolbar layout.');
}finally{await browser.close();}

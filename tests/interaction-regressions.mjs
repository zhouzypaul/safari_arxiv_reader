import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const fixtures=process.env.PAPERTRAIL_FIXTURES||'.test-fixtures';
const require=createRequire(process.env.PAPERTRAIL_RUNTIME||import.meta.url);
const {webkit}=require('playwright');const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:980}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original='https://arxiv.org/pdf/1706.03762';const pdf=await fs.readFile(path.join(fixtures,'attention.pdf')),ln=await fs.readFile(path.join(fixtures,'layernorm.pdf'));const content=await fs.readFile('extension/content.js','utf8');
 await page.route('https://arxiv.org/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/abs/')){await route.fulfill({contentType:'text/html',body:await fs.readFile(u.pathname.includes('1706')?path.join(fixtures,'attention.html'):path.join(fixtures,'arxiv.html'),'utf8'),headers:{'Access-Control-Allow-Origin':'*'}});return;}if(route.request().isNavigationRequest())await route.fulfill({contentType:'text/html',body:'<!doctype html><title>PDF host test</title><body><embed id="native-pdf" type="application/pdf"></body>'});else await route.fulfill({contentType:'application/pdf',body:u.pathname.includes('1607')?ln:pdf,headers:{'Access-Control-Allow-Origin':'*'}});});
 let holdMetadata;
 await page.route('https://api.openalex.org/**',async route=>{if(holdMetadata)await holdMetadata;return route.fulfill({contentType:'application/json',path:path.join(fixtures,'openalex.json'),headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.route('https://extension.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;try{const data=await fs.readFile(process.env.PAPERTRAIL_BASELINE&&pathname==='/reader.js'?process.env.PAPERTRAIL_BASELINE+'/reader-before.js':process.env.PAPERTRAIL_BASELINE&&pathname==='/reader.css'?process.env.PAPERTRAIL_BASELINE+'/reader-before.css':'extension'+pathname);const type=/\.m?js$/.test(pathname)?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.html')?'text/html':'application/octet-stream';await route.fulfill({contentType:type,body:data});}catch{await route.abort();}});
 await page.addInitScript(()=>{delete ReadableStream.prototype[Symbol.asyncIterator];window.browser={runtime:{getURL:p=>'https://extension.test/'+p},permissions:{contains:async()=>true,request:async()=>true}};});
 await page.goto(original);await page.evaluate(content);const f=page.frameLocator('#papertrail-reader-frame');
 await f.locator('#status').filter({hasText:/15 pages · 22 sections · 40 references/}).waitFor({state:'attached',timeout:30000});
 await f.locator('.outline-link').filter({hasText:'Introduction'}).click();
 await f.locator('.pdf-page[data-page="2"] .annotation').first().waitFor();
 if(!process.env.PAPERTRAIL_BASELINE){
   let releaseMetadata;holdMetadata=new Promise(resolve=>{releaseMetadata=resolve;});
   await f.locator('.pdf-page[data-page="2"] .annotation').first().click();
   await f.locator('#preview-body').getByRole('button',{name:'Cite',exact:true}).waitFor();
   assert.equal(await f.locator('#preview-body').getByRole('button',{name:'Cite',exact:true}).isEnabled(),false);
   releaseMetadata();holdMetadata=null;
   await f.locator('#preview-body').getByRole('button',{name:'Cite',exact:true}).waitFor();await f.locator('.paper-abstract').waitFor();assert.equal(await f.locator('#preview-body').getByRole('button',{name:'Cite',exact:true}).isEnabled(),true);await f.locator('#close-preview').click();
 }
 // Capture canvas lifetime and dispatch cost for a dense wheel/pinch burst.
 const perf=await f.locator('body').evaluate(async()=>{
   const main=document.querySelector('#main'),node=document.querySelector('.pdf-page[data-page="2"]');
   const canvas=node.querySelector('canvas');const oldWidth=node.getBoundingClientRect().width;const sidebar=document.querySelector('#sidebar').getBoundingClientRect().width;
   let removed=0;const observer=new MutationObserver(list=>{for(const m of list)for(const n of m.removedNodes)if(n===canvas||n.contains?.(canvas))removed++;});observer.observe(node,{childList:true,subtree:true});
   const start=performance.now();for(let i=0;i<240;i++)document.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-.2,clientX:850,clientY:450,bubbles:true,cancelable:true}));const burstMs=performance.now()-start;
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
   const feedback={scaled:node.getBoundingClientRect().width>oldWidth,keptOriginal:canvas.isConnected,sidebarStable:sidebar===document.querySelector('#sidebar').getBoundingClientRect().width};
   const frames=[];const until=performance.now()+650;while(performance.now()<until){await new Promise(requestAnimationFrame);frames.push(!!node.querySelector('canvas'));}
   observer.disconnect();return {burstMs,...feedback,blankFrames:frames.filter(x=>!x).length,removedCanvases:removed};
 });
 console.log(JSON.stringify({zoom:perf}));
 if(process.env.PAPERTRAIL_BASELINE){assert.deepEqual(errors,[]);process.exitCode=0;}else{
   assert.equal(perf.scaled,true);assert.equal(perf.keptOriginal,true);assert.equal(perf.sidebarStable,true);assert.equal(perf.blankFrames,0);
   // A small real Safari pinch must accumulate and retain its surface through pauses.
   const pinch=await f.locator('body').evaluate(async()=>{
     const node=document.querySelector('.pdf-page[data-page="2"]'),canvas=node.querySelector('.page-surface:not(.rendering-surface) canvas'),width=node.getBoundingClientRect().width;
     const send=(type,scale)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{scale,clientX:850,clientY:450});document.dispatchEvent(e);};
     send('gesturestart',1);for(let i=1;i<=50;i++)send('gesturechange',1+i*.0001);
     await new Promise(r=>setTimeout(r,300));const result={widthGrew:node.getBoundingClientRect().width>width,retained:canvas.isConnected};send('gestureend',1.005);return result;
   });assert.equal(pinch.widthGrew,true);assert.equal(pinch.retained,true);
   // Sharp content replaces the old surface after the gesture settles.
   await f.locator('.pdf-page[data-page="2"]').evaluate(async node=>{const expected=parseFloat(document.querySelector('#zoom').value)/100;const start=performance.now();while(Math.abs(Number(node.dataset.rasterScale)-expected)>.006){if(performance.now()-start>10000)throw Error('Sharper page never settled');await new Promise(requestAnimationFrame);}});
   await f.locator('#search').click();await f.locator('#find-input').fill('attention');await f.locator('#find-count').filter({hasText:/1 \/ \d+/}).waitFor();
   const result=await f.locator('body').evaluate(async()=>{
     const {textMatches}=await import('./search-highlights.js');const node=document.querySelector('.pdf-page:has(.search-mark)');const layer=node.querySelector('.page-surface:not(.rendering-surface) .textLayer');const matches=textMatches(layer,'attention');
     return {texts:matches.map(r=>r.toString()),widths:matches.map(r=>({match:r.getBoundingClientRect().width,line:r.startContainer.parentElement.getBoundingClientRect().width})),marks:node.querySelectorAll('.search-mark').length};
   });
   assert.ok(result.texts.length);assert.ok(result.texts.every(x=>x.toLowerCase()==='attention'));assert.ok(result.widths.some(x=>x.match<x.line/2));assert.ok(result.marks>=result.texts.length);
   // A match can span a nested citation without removing its click listener.
   const nested=await f.locator('body').evaluate(async()=>{const {textMatches}=await import('./search-highlights.js');const layer=document.createElement('div');layer.innerHTML='<span>A searched <span class="citation">word</span> repeats WORD.</span>';return textMatches(layer,'word').map(r=>r.toString());});assert.deepEqual(nested,['word','WORD']);
   await page.screenshot({path:'search-preview.png'});
   await f.locator('#find-close').click();assert.equal(await f.locator('.search-mark').count(),0);
   await f.locator('.outline-link').filter({hasText:'Introduction'}).click();await f.locator('.pdf-page[data-page="2"] .annotation').first().click();await f.locator('.paper-abstract').waitFor();
   await f.locator('#preview-body').getByRole('button',{name:'Cite',exact:true}).click();assert.equal(await f.locator('#utility-title').textContent(),'BibTeX');assert.equal(await f.locator('#utility-body pre').count(),1);assert.match(await f.locator('#utility-body pre').textContent(),/^@/);assert.equal(await f.locator('#utility-body button').count(),2);assert.equal(await f.locator('#utility-body').getByRole('button',{name:'Copy BibTeX'}).count(),1);
   await page.screenshot({path:'bibtex-preview.png'});await f.locator('#utility-close').click();
   await f.locator('#cite').click();assert.equal(await f.locator('#utility-body pre').count(),1);assert.equal(await f.locator('#utility-title').textContent(),'BibTeX');
   assert.deepEqual(errors,[]);console.log('PASS: retained zoom bitmap, stable sidebar, sharp replacement, exact search ranges, citation and toolbar BibTeX-only dialogs.');
 }
}finally{await browser.close();}

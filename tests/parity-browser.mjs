import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const fixtures=process.env.PAPERTRAIL_FIXTURES||'.test-fixtures';
const require=createRequire(process.env.PAPERTRAIL_RUNTIME||import.meta.url);
const {webkit}=require('playwright');const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:980}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const original='https://arxiv.org/pdf/1706.03762';const pdf=await fs.readFile(path.join(fixtures,'attention.pdf')),ln=await fs.readFile(path.join(fixtures,'layernorm.pdf'));const content=await fs.readFile('extension/content.js','utf8');
 await page.route('https://arxiv.org/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/abs/')){await route.fulfill({contentType:'text/html',body:await fs.readFile(u.pathname.includes('1706')?path.join(fixtures,'attention.html'):path.join(fixtures,'arxiv.html'),'utf8'),headers:{'Access-Control-Allow-Origin':'*'}});return;}if(route.request().isNavigationRequest())await route.fulfill({contentType:'text/html',body:'<!doctype html><title>PDF host test</title><body><embed id="native-pdf" type="application/pdf"></body>'});else await route.fulfill({contentType:'application/pdf',body:u.pathname.includes('1607')?ln:pdf,headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.route('https://api.openalex.org/**',route=>route.fulfill({contentType:'application/json',path:path.join(fixtures,'openalex.json'),headers:{'Access-Control-Allow-Origin':'*'}}));
 await page.route('https://extension.test/**',async route=>{const pathname=new URL(route.request().url()).pathname;try{const data=await fs.readFile('extension'+pathname);const type=/\.m?js$/.test(pathname)?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.html')?'text/html':'application/octet-stream';await route.fulfill({contentType:type,body:data});}catch{await route.abort();}});
 await page.addInitScript(()=>{delete ReadableStream.prototype[Symbol.asyncIterator];window.browser={runtime:{getURL:p=>'https://extension.test/'+p},permissions:{contains:async()=>true,request:async()=>true}};});
 await page.goto(original);await page.evaluate(content);const f=page.frameLocator('#papertrail-reader-frame');
 await f.locator('#status').filter({hasText:/15 pages · 22 sections · 40 references/}).waitFor({state:'attached',timeout:30000});
 const metrics=()=>f.locator('body').evaluate(()=>({header:document.querySelector('header').getBoundingClientRect().height,sidebar:document.querySelector('#sidebar').getBoundingClientRect().width,pdf:document.querySelector('.pdf-page').getBoundingClientRect().width,body:document.documentElement.scrollWidth,zoom:parseFloat(document.querySelector('#zoom').value)}));
 const before=await metrics();await f.locator('.outline-link').filter({hasText:'Introduction'}).click();
 await f.locator('#zoomin').click();await f.locator('#zoom').press('Meta+=');await f.locator('#zoom').press('Meta+-');await f.locator('#zoom').press('Meta+0');
 for(let i=0;i<12;i++){await f.locator('#zoomin').click();await f.locator('#zoomout').click();}
 await f.locator('.pdf-page[data-page="2"] canvas').waitFor();
 const after=await metrics();assert.equal(after.header,before.header);assert.equal(after.sidebar,before.sidebar);assert.equal(after.body,1400);assert.equal(after.zoom,100);
 await f.locator('.outline-link').filter({hasText:'Introduction'}).click();await f.locator('.pdf-page[data-page="2"] .annotation').first().click();
 await f.locator('.paper-abstract').waitFor();assert.match(await f.locator('#preview-body h3').first().textContent(),/long short.term memory/i);assert.equal(await f.locator('#preview').evaluate(e=>e.matches(':modal')),false);
 await page.screenshot({path:'citation-preview.png'});
 await f.locator('#close-preview').click();await f.locator('#search').click();await f.locator('#find-input').fill('attention');await f.locator('#find-count').filter({hasText:/1 \/ \d+/}).waitFor();await f.locator('#find-next').click();assert.match(await f.locator('#find-count').textContent(),/^2 \/ /);await f.locator('#find-close').click();
 await f.locator('#thumbnails-tab').click();await f.locator('.thumbnail').nth(14).waitFor();await f.locator('.thumbnail').nth(2).click();assert.match(page.url(),/#page=3$/);
 await f.locator('#outline-tab').click();await f.locator('#collapse-all').click();assert.equal(await f.locator('[data-section="3"]').isVisible(),false);await f.locator('#collapse-all').click();
 await f.locator('#more').click();await f.locator('#theme').selectOption('night');assert.equal(await f.locator('body').getAttribute('data-theme'),'night');assert.equal(await f.locator('.annotation').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:'reader-night-preview.png'});await f.locator('#theme').selectOption('light');await f.locator('#more').click();
 await f.locator('#more').click();await f.locator('#rotate').click();await f.locator('#more').click();await f.locator('.pdf-page canvas').first().waitFor();assert.ok(await f.locator('.pdf-page').first().evaluate(e=>e.offsetWidth>e.offsetHeight));
 await f.locator('#cite').click();assert.match(await f.locator('#utility-body').textContent(),/BibTeX/);await f.locator('#utility-close').click();
 await f.locator('#more').click();await f.locator('#save-paper').click();await f.locator('#more').click();await f.locator('#library').click();assert.match(await f.locator('#utility-body').textContent(),/Attention Is All You Need/);await f.locator('#utility-close').click();
 // Replace the test paper: author-year references must also be recognized.
 await page.goto('https://arxiv.org/pdf/1607.06450');await page.evaluate(content);await f.locator('#status').filter({hasText:/14 pages/}).waitFor({state:'attached',timeout:30000});
 const refCount=Number((await f.locator('#status').textContent()).match(/(\d+) references/)[1]);assert.ok(refCount>20,'Expected author-year bibliography, got '+refCount);
 assert.equal(await f.locator('#references-tab, #references, header .brand').count(),0);
 await f.locator('#outline-tab').click();await f.locator('#fit').click();await page.screenshot({path:'reader-preview.png'});

 // Ordinary text selection remains available without an annotation popup.
 await f.locator('.pdf-page[data-page="1"] .textLayer span').first().waitFor();
 await f.locator('.pdf-page[data-page="1"] .textLayer span').filter({hasText:'Layer Normalization'}).first().evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(r);e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 assert.match(await f.locator('body').evaluate(()=>getSelection().toString()),/Layer Normalization/);
 assert.equal(await f.locator('#selection-tools, [data-note-color], .note-mark').count(),0);
 await f.locator('#notes-tab').click();assert.match(await f.locator('#notes-list').textContent(),/No saved notes/);
 await f.locator('#more').click();await f.locator('#original').click();await page.locator('#native-pdf').waitFor();assert.equal(await page.locator('#papertrail-reader-frame').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: rapid PDF zoom stable; 33+ UI checks including automatic abstract, search, thumbnails, collapse, rotation, themes, citation exports, local library, text selection without highlighter, original-view restoration and '+refCount+' author-year references.');
}finally{await browser.close();}

import {createRequire} from 'node:module';import os from 'node:os';import path from 'node:path';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const require=createRequire(process.env.PAPERTRAIL_RUNTIME||import.meta.url);
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'papertrail-test-'));
const fixturePath=path.join(scratch,'fixture.pdf');
const {webkit}=require('playwright');const {PDFDocument,StandardFonts}=require('pdf-lib');
const fixture=await PDFDocument.create();fixture.setTitle('A field guide to attentive reading');const font=await fixture.embedFont(StandardFonts.TimesRoman);const bold=await fixture.embedFont(StandardFonts.TimesRomanBold);
const p1=fixture.addPage([612,792]);const p2=fixture.addPage([612,792]);
const draw=(page,text,y,size=12,f=font)=>page.drawText(text,{x:60,y,size,font:f});
draw(p1,'A field guide to attentive reading',725,23,bold);draw(p1,'1 Introduction',660,16,bold);draw(p1,'A useful reader connects ideas while preserving context.',630);draw(p1,'Attention models provide one example [1].',610);draw(p1,'2 Method',520,16,bold);draw(p1,'Use a section outline to move between parts of a paper.',490);draw(p1,'Follow citations to inspect the original evidence.',470);draw(p2,'References',725,16,bold);draw(p2,'[1] Vaswani et al. Attention is all you need.',690);draw(p2,'arXiv:1706.03762, 2017.',670);
draw(p1,'See Figure 1 for an overview.',570);draw(p2,'Figure 1: An overview of the method.',760);
await fs.writeFile(fixturePath,await fixture.save());
const browser=await webkit.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:980}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let aiCalls=0;page.on('request',r=>{if(r.url().includes('api.openai.com'))aiCalls++;});
try {
 await page.route('https://arxiv.org/abs/**',r=>r.fulfill({contentType:'text/html',body:'<meta name="citation_title" content="Attention is all you need"><meta name="citation_author" content="Ashish Vaswani"><meta name="citation_abstract" content="Test abstract">'}));
 await page.goto('http://127.0.0.1:18743');await page.locator('#file').setInputFiles(fixturePath);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('references'),{timeout:20000});
 assert.match(await page.locator('#status').textContent(),/2 pages · 3 sections · 1 references/);assert.equal(aiCalls,0);
 await page.locator('.textLayer .citation').first().click();await page.locator('#preview').waitFor({state:'visible'});assert.match(await page.locator('#preview-body').textContent(),/Vaswani/);assert.equal(await page.locator('#preview-body .primary').count(),1);
 await page.screenshot({path:path.join(scratch,'preview.png')});await page.locator('#close-preview').click();
 await page.locator('.outline-link').filter({hasText:'References'}).click();assert.ok(await page.locator('#main').evaluate(e=>e.scrollTop)>500);await page.locator('#back').click();assert.ok(await page.locator('#main').evaluate(e=>e.scrollTop)<100);
 await page.locator('.internal-reference').filter({hasText:'Figure 1'}).first().click();assert.ok(await page.locator('#main').evaluate(e=>e.scrollTop)>500);await page.locator('#back').click();
 await page.locator('#zoom').fill('100%');await page.locator('#zoom').press('Enter');await page.locator('#zoomin').click();await page.waitForFunction(()=>document.querySelector('#zoom').value==='115%');
 await page.route('https://api.openai.com/v1/responses',async route=>{const input=JSON.parse(route.request().postDataJSON().input);await route.fulfill({json:{output:[{content:[{type:'output_text',text:JSON.stringify({sections:input.map(s=>({id:s.id,bullets:['Fixture summary for '+s.title]}))})}]}]}});});
 await page.locator('#ai').click();await page.locator('#api-key').fill('test-key-not-real');await page.locator('#summarize').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.summary').length===2);assert.equal(await page.locator('#api-key').inputValue(),'');await page.locator('#ai-dialog').evaluate(e=>e.close());await page.locator('#collapse-all').click();await page.locator('#collapse-all').click();assert.equal(await page.locator('.summary').count(),2);
 console.log('PASS: rendering, non-AI default, previews, jump/back, zoom, mocked summaries');
 if(process.env.TEST_PDF){
   await page.locator('#file').setInputFiles(process.env.TEST_PDF);
   await page.waitForFunction(()=>/pages · .* sections · .* references$/.test(document.querySelector('#status').textContent));
   console.log(await page.locator('#status').textContent());
 }
 assert.deepEqual(errors,[]);
 console.log('Test artifacts: '+scratch);
}finally{await browser.close();}

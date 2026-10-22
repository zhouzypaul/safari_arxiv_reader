import {createRequire} from 'node:module';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(process.env.PAPERTRAIL_RUNTIME||import.meta.url),{webkit}=require('playwright');
const browser=await webkit.launch({headless:true});
try{
 const page=await browser.newPage();const script=await fs.readFile('extension/scholar-content.js','utf8');
 await page.route('https://scholar.google.com/**',r=>r.fulfill({contentType:'text/html',body:`<body><div class="gs_r"><div class="gs_ri"><h3 class="gs_rt"><a href="https://arxiv.org/abs/1706.03762">Attention Is All You Need</a></h3><div class="gs_fl"><a href="/scholar?cites=123456">Cited by 12,345</a></div></div></div><div class="gs_r"><h3 class="gs_rt">No count available</h3></div></body>`}));
 await page.addInitScript(()=>{const data={'papertrail-scholar-pending-test-token-123':{key:'attention is all you need',title:'Attention Is All You Need',createdAt:Date.now()}};window.testStorage=data;window.browser={storage:{local:{get:async k=>k===null?data:{[k]:data[k]},set:async entries=>Object.assign(data,entries),remove:async k=>{delete data[k];}}}};});
 await page.goto('https://scholar.google.com/scholar?hl=en&q=%22Attention+Is+All+You+Need%22');await page.evaluate(script);assert.equal(await page.locator('#papertrail-scholar-panel').count(),0);
 await page.goto('https://scholar.google.com/scholar?hl=en&q=%22Attention+Is+All+You+Need%22#papertrail=test-token-123');await page.evaluate(script);
 await page.locator('.papertrail-use-citations').waitFor();assert.equal(await page.locator('.papertrail-use-citations').count(),1);
 assert.equal(await page.evaluate(()=>testStorage['papertrail-scholar-counts']),undefined);
 await page.locator('.papertrail-use-citations').click();await page.waitForFunction(()=>!!testStorage['papertrail-scholar-counts']);
 const value=await page.evaluate(()=>testStorage['papertrail-scholar-counts']['attention is all you need']);assert.equal(value.count,12345);assert.equal(value.title,'Attention Is All You Need');assert.equal(value.url,'https://scholar.google.com/scholar?cites=123456');assert.equal(await page.evaluate(()=>testStorage['papertrail-scholar-pending-test-token-123']),undefined);
 const moduleSource=await fs.readFile('extension/scholar.js','utf8');
 const parsed=await page.evaluate(async source=>{
  const {parseScholarCount}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  const card=(title,count='Cited by 1,234',url='/scholar?cites=123')=>`<div class="gs_r"><h3 class="gs_rt"><a>${title}</a></h3><a href="${url}">${count}</a></div>`;
  const title='Attention Is All You Need';const failures=[];
  for(const html of [card('Wrong paper'),card(title,'Related articles'),card(title,'Cited by 1,2'),card(title,'Cited by 10','https://evil.test/scholar?cites=123'),'<html>Forbidden</html>']){
   try{parseScholarCount(html,title);failures.push(false);}catch{failures.push(true);}
  }
  return {later:parseScholarCount(card('Wrong paper')+card(title),title),value:parseScholarCount(card(title),title),zero:parseScholarCount(card(title,'Cited by 0'),title),mirrors:parseScholarCount(card(title)+card(title,'Cited by 4'),title),failures};
 },moduleSource);
 assert.equal(parsed.later.count,1234);assert.equal(parsed.value.count,1234);assert.equal(parsed.zero.count,0);assert.equal(parsed.mirrors.count,1234);assert.ok(parsed.failures.every(Boolean));
 const background=await fs.readFile('extension/background.js','utf8');
 const readSource=background.slice(background.indexOf('async function readScholarTab'),background.indexOf('function sameScholarSearch'));
 await page.setContent('<body>Loading</body>');
 const delayed=await page.evaluate(async source=>{
  const read=eval('('+source+')');
  setTimeout(()=>{document.body.innerHTML='<div id="gs_res_ccl_mid"><div class="gs_r">Ready</div></div>';},50);
  return read();
 },readSource);
 assert.match(delayed.html,/Ready/);
 await page.setContent('<form action="/sorry/"></form>');
 const challenge=await page.evaluate(source=>eval('('+source+')')(),readSource);assert.equal(challenge.blocked,true);
 console.log('PASS: only explicit Scholar lookup activates helper; visible count imported only after selection; missing count is not zero; snapshot and cleanup verified.');
}finally{await browser.close();}

import {SCHOLAR_COUNTS,scholarKey,scholarURL,validScholarCount,createScholarLookup} from './scholar.js';
import {paperText,pangramRequest,waitForPangram} from './paper-insights.js';
import {paintSearchHighlights} from './search-highlights.js';
import {citationFormats} from './citations.js';
import {clampScale,installPDFZoom} from './zoom.js';
import {resolveReference} from './metadata.js';
import {readPageText} from './pdf-text.js';
import {pdfAccess} from './permissions.js';
import * as pdfjs from './vendor/pdf.mjs';
import {linesFromItems,inferOutline,extractReferences,matchReferences,safeURL,identifiers,sectionsForSummary,referenceQuery} from './analysis.js';
import {lookupReference,summarizeSections} from './services.js';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const $=s=>document.querySelector(s), el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const api=globalThis.browser||globalThis.chrome;
let doc,loadingTask,outline=[],refs=[],pageRows=[],records=[],scale=1,epoch=0,observer,renderQueue=Promise.resolve(),summaryAbort;
let history=[],previewVersion=0,previousFocus,ready=false,rotation=0,fitMode='width',currentSource=null,documentInfo=null;
let zoomTimer,zoomFrame=0,pendingAnchor,gestureActive=false,scrollFrame=0;
const RASTER_BUDGET=64*1024*1024;
const residentPages=new Set();
const collapsedSections=new Set();
const summaries=new Map();
const internalTargets=new Map();
function appendSummary(item,summary){if(!summary)return;item.append(el('p',summary.truncated?'AI summary · excerpt only':'AI summary · verify against paper','summary-label'));const list=el('ul',null,'summary');for(const bullet of summary.bullets)list.append(el('li',bullet));item.append(list);}
let statusTimer;
const status=(s,visible=true)=>{const node=$('#status');node.textContent=s;node.hidden=!visible;clearTimeout(statusTimer);if(visible)statusTimer=setTimeout(()=>{node.hidden=true;},8000);};
const report=e=>status(e?.name==='AbortError'?'Request cancelled.':e.message||String(e));
async function destPosition(dest){
  const d=typeof dest==='string'?await doc.getDestination(dest):dest;
  if(!d)return null;
  const page=typeof d[0]==='number'?d[0]+1:await doc.getPageIndex(d[0])+1;
  return {page,y:d[1]?.name==='XYZ'?d[3]:d[1]?.name==='FitH'?d[2]:null};
}
async function flattenOutline(items,level=0){
  const result=[];
  for(const item of items||[]){
    const pos=await destPosition(item.dest).catch(()=>null);
    if(pos)result.push({title:item.title,...pos,level});
    result.push(...await flattenOutline(item.items,level+1));
  }
  return result;
}
function jump(page,y,remember=true){
  flushZoom();
  const record=records[page-1];if(!record)return;
  if(window.parent!==window)window.parent.postMessage({type:'papertrail-position',page},new URL(new URL(location.href).searchParams.get('url')).origin);
  if(remember){history.push($('#main').scrollTop);$('#back').disabled=false;}
  const offset=y==null?0:record.viewport.convertToViewportPoint(0,y)[1];
  $('#main').scrollTop=record.node.offsetTop-$('#main').offsetTop+offset-20;
  for(const b of document.querySelectorAll('.outline-link'))b.classList.toggle('active',Number(b.dataset.page)===page && b.dataset.y===String(y??''));
}
$('#back').onclick=()=>{$('#main').scrollTop=history.pop()??0;$('#back').disabled=!history.length;};
function drawOutline(){
  $('#outline').replaceChildren();
  if(!outline.length){$('#outline').append(el('p','No section headings found. Scanned PDFs need OCR before an outline can be extracted.','small'));return;}
  const refreshCollapse=()=>{
    for(let i=0;i<outline.length;i++){
      let hidden=false;
      for(const parent of collapsedSections){if(i>parent){let end=parent+1;while(end<outline.length&&outline[end].level>outline[parent].level)end++;if(i<end)hidden=true;}}
      const item=$(`[data-section="${i}"]`);if(item)item.hidden=hidden;
    }
  };
  outline.forEach((o,i)=>{
    const item=el('div',null,'outline-item');item.dataset.section=i;
    const b=el('button',null,'outline-link');b.style.paddingLeft=`${9+Math.min(o.level,4)*12}px`;b.dataset.page=o.page;b.dataset.y=String(o.y??'');
    b.append(el('span',o.title),el('span',o.page,'page-number'));b.onclick=()=>jump(o.page,o.y);
    const heading=el('div',null,'outline-heading');heading.append(b);
    if(outline[i+1]?.level>o.level){const toggle=el('button',collapsedSections.has(i)?'▸':'▾','section-toggle');toggle.setAttribute('aria-label','Collapse '+o.title);toggle.setAttribute('aria-expanded',String(!collapsedSections.has(i)));toggle.onclick=()=>{if(collapsedSections.has(i))collapsedSections.delete(i);else collapsedSections.add(i);toggle.textContent=collapsedSections.has(i)?'▸':'▾';toggle.setAttribute('aria-expanded',String(!collapsedSections.has(i)));toggle.setAttribute('aria-label',(collapsedSections.has(i)?'Expand ':'Collapse ')+o.title);refreshCollapse();};heading.append(toggle);}
    item.append(heading);appendSummary(item,summaries.get(i));$('#outline').append(item);
  });
  refreshCollapse();
}
function link(label,url,primary=false){const a=el('a',label,primary?'primary':'');a.href=safeURL(url)||'#';a.target='_blank';a.rel='noopener noreferrer';return a;}
function closePreview(){previewVersion++;$('#preview').close();previousFocus?.focus();}
$('#close-preview').onclick=closePreview;
document.addEventListener('pointerdown',event=>{if($('#preview').open&&!$('#preview').contains(event.target)&&!event.target.closest('.citation,.annotation'))closePreview();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#preview').open)closePreview();});
$('#preview').addEventListener('cancel',()=>previewVersion++);
async function openPDF(url){
  const safe=safeURL(url);if(!safe)throw new Error('This is not a supported PDF address.');
  if(!await pdfAccess(api,safe,true))throw new Error('Website access was not granted. Use the publisher link or download the PDF.');
  if(window.parent!==window){
    const source=new URL(location.href).searchParams.get('url');
    window.parent.postMessage({type:'papertrail-navigate',url:safe},new URL(source).origin);
  }else location.assign(safe);
}
function pdfButton(url){const b=el('button','Read PDF →','primary');b.onclick=()=>openPDF(url).catch(report);return b;}
function positionPreview(anchor){
  const dialog=$('#preview'),box=anchor?.getBoundingClientRect();
  const width=dialog.getBoundingClientRect().width;
  dialog.style.left=Math.max(12,Math.min((box?.left??innerWidth/2)-20,innerWidth-width-16))+'px';
  dialog.style.top=Math.max(76,Math.min((box?.bottom??110)+10,innerHeight-Math.min(dialog.scrollHeight,innerHeight*.7)-16))+'px';
}
function paperActions(paper,ref){
  const actions=el('div',null,'links');
  if(paper.pdf||ref?.pdf)actions.append(pdfButton(paper.pdf||ref.pdf));
  if(paper.url)actions.append(link('Paper page',paper.url));
  const cite=el('button','Cite');cite.disabled=!paper.authors&&!paper.year;if(cite.disabled)cite.title='Paper details are needed to generate BibTeX';cite.onclick=()=>showCite(paper);actions.append(cite);
  const save=el('button','Save');save.onclick=()=>savePaper(paper).then(()=>{save.textContent='Saved';}).catch(report);actions.append(save);
  const q=encodeURIComponent(paper.title||referenceQuery(ref?.text||''));
  actions.append(link('Google Scholar',`https://scholar.google.com/scholar?q=${q}`));
  if(paper.openalex){actions.append(link(`Cited by ${paper.citedBy??''}`,`https://openalex.org/works?filter=cites:${paper.openalex.split('/').pop()}`));}
  if(paper.related?.length)actions.append(link('Related articles','https://openalex.org/works?filter=ids.openalex:'+paper.related.map(x=>x.split('/').pop()).join('|')));
  if(paper.versions?.length){const versions=el('details');versions.append(el('summary','All available versions'));for(const v of paper.versions)versions.append(link(v.label||'Paper version',v.url));actions.append(versions);}
  if(ref?.page){const b=el('button','See in references');b.onclick=()=>{closePreview();jump(ref.page,ref.y);};actions.append(b);}
  return actions;
}
function showPreview(matches,anchor){
  previousFocus=document.activeElement;const version=++previewVersion;const body=$('#preview-body');body.replaceChildren();
  for(const ref of matches){
    const block=el('section',null,'reference-card');
    block.append(el('h3',referenceQuery(ref.text)||ref.text),el('p',ref.text,'citation-text'));
    block.append(paperActions({title:referenceQuery(ref.text),pdf:ref.pdf},ref));
    const result=el('div');result.append(el('p','Loading title and abstract…','small'));block.append(result);body.append(block);
    resolveReference(ref).then(works=>{
      if(version!==previewVersion||!block.isConnected)return;
      const paper=works[0];
      if(!paper){result.replaceChildren(el('p','No reliable metadata match found. The original reference is shown above.','small'));return;}
      block.replaceChildren(el('h3',paper.title),el('p',[paper.authors,paper.venue,paper.year].filter(Boolean).join(' · '),'paper-authors'));
      if(paper.abstract){
        const abstract=el('p',paper.abstract.length>700?paper.abstract.slice(0,700)+'…':paper.abstract,'paper-abstract');block.append(abstract);
        if(paper.abstract.length>700){const more=el('button','Show more','text-button');let expanded=false;more.onclick=()=>{expanded=!expanded;abstract.textContent=expanded?paper.abstract:paper.abstract.slice(0,700)+'…';more.textContent=expanded?'Show less':'Show more';positionPreview(anchor);};block.append(more);}
      }else block.append(el('p','No abstract is available from this metadata source.','small'));
      block.append(paperActions(paper,ref),el('p',`${paper.source}${paper.exact?' · matched by identifier':' · title match; check authors and year'}`,'small'));
      const original=el('details');original.append(el('summary','Original reference'),el('p',ref.text,'citation-text'));block.append(original);
      positionPreview(anchor);
    }).catch(error=>{
      if(version!==previewVersion)return;
      result.replaceChildren(el('p','Paper details could not be loaded. '+error.message,'small'));
      const retry=el('button','Retry');retry.onclick=()=>showPreview(matches,anchor);result.append(retry);
    });
  }
  if(!$('#preview').open)$('#preview').show();positionPreview(anchor);
}
async function renderPage(record,version){
  if(version!==epoch)return;
  if(record.rendered){if(record.surface){highlightSearch(record);}return;}
  if(ready&&!nearViewport(record,300))return;
  record.rendered=true;const viewport=record.viewport;
  const page=record.page;
  const surface=el('div',null,'page-surface rendering-surface');surface.style.visibility='hidden';surface.style.width=viewport.width+'px';surface.style.height=viewport.height+'px';record.node.append(surface);
  const canvas=el('canvas');const context=canvas.getContext('2d');
  const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(8000000/(viewport.width*viewport.height)));
  canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);
  canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';surface.append(canvas);
  const task=page.render({canvasContext:context,viewport,transform:[ratio,0,0,ratio,0,0]});record.task=task;
  await task.promise;if(version!==epoch)return;
  const content=record.textContent||await readPageText(page);record.textContent=content;if(version!==epoch)return;
  const layer=el('div',null,'textLayer');layer.style.setProperty('--total-scale-factor',viewport.scale);surface.append(layer);
  const textLayer=record.textTask=new pdfjs.TextLayer({textContentSource:content,container:layer,viewport});await textLayer.render();if(version!==epoch)return;
  for(const span of layer.querySelectorAll('span')){
    const text=span.textContent;
    const citations=[...text.matchAll(/\[[^\]]*(?:\d)[^\]]*\]|\([^)]*(?:19|20)\d{2}[a-z]?[^)]*\)/g)];
    const internal=[...text.matchAll(/\b(Figure|Fig\.?|Table)\s+(\d+(?:\.\d+)?|[IVX]+)\b/gi)].filter(m=>!citations.some(c=>m.index>=c.index&&m.index<c.index+c[0].length));
    const parts=[...citations,...internal].sort((a,b)=>a.index-b.index);
    if(!parts.length)continue;
    let cursor=0;const fragment=document.createDocumentFragment();
    for(const part of parts){
      fragment.append(document.createTextNode(text.slice(cursor,part.index)));
      const target=part[1]?internalTargets.get((/^tab/i.test(part[1])?'table':'figure')+part[2].toLowerCase()):null;
      const matches=matchReferences(part[0],refs).length?matchReferences(part[0],refs):matchReferences(text,refs);
      if(target){const jumpLink=el('span',part[0],'citation internal-reference');jumpLink.tabIndex=0;jumpLink.setAttribute('role','button');jumpLink.setAttribute('aria-label','Go to '+part[0]);jumpLink.onclick=()=>jump(target.page,target.y);jumpLink.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();jumpLink.click();}};fragment.append(jumpLink);}
      else if(matches.length){const citation=el('span',part[0],'citation');citation.tabIndex=0;citation.setAttribute('role','button');citation.setAttribute('aria-label','Preview citation '+part[0]);citation.onclick=()=>showPreview(matches,citation);citation.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showPreview(matches,citation);}};fragment.append(citation);}
      else fragment.append(document.createTextNode(part[0]));
      cursor=part.index+part[0].length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));span.replaceChildren(fragment);
  }
  const annotations=record.annotations||await page.getAnnotations();record.annotations=annotations;if(version!==epoch)return;
  for(const a of annotations){
    if(a.subtype!=='Link')continue;
    const rect=viewport.convertToViewportRectangle(a.rect);const b=el('button',null,'annotation');b.setAttribute('aria-label','Follow PDF link');
    Object.assign(b.style,{left:Math.min(rect[0],rect[2])+'px',top:Math.min(rect[1],rect[3])+'px',width:Math.abs(rect[2]-rect[0])+'px',height:Math.abs(rect[3]-rect[1])+'px'});
    b.onclick=async()=>{
      try{
        if(a.dest){const p=await destPosition(a.dest);if(!p)return;
          const named=typeof a.dest==='string'?refs.find(r=>r.key&&a.dest.toLowerCase().includes(r.key.toLowerCase())):null;
          const onPage=refs.filter(r=>r.page===p.page);const ref=named||(p.y==null?null:onPage.slice().sort((a,b)=>Math.abs(a.y-p.y)-Math.abs(b.y-p.y))[0]);
          if(ref&&(named||Math.abs(ref.y-p.y)<65))showPreview([ref],b);else jump(p.page,p.y);
        }else if(safeURL(a.url)){const ids=identifiers(a.url);if(ids.doi||ids.arxiv||ids.pdf)showPreview([{text:a.url,...ids}],b);else window.open(a.url,'_blank','noopener,noreferrer');}
      }catch(e){report(e);}
    };surface.append(b);
  }
  releaseSurface(record.surface);surface.classList.remove('rendering-surface');surface.style.visibility='';record.surface=surface;record.rasterViewport=viewport;record.linksReady=ready;record.node.dataset.rasterScale=viewport.scale;
  record.task=null;record.textTask=null;residentPages.add(record);
  highlightSearch(record);trimPageCache();
}
function releaseSurface(surface){if(!surface)return;for(const c of surface.querySelectorAll("canvas")){c.width=0;c.height=0;}surface.remove();}
function nearViewport(record,margin=0){const main=$("#main"),top=record.node.offsetTop;return top<main.scrollTop+main.clientHeight+margin&&top+record.node.offsetHeight>main.scrollTop-margin;}
function trimPageCache(){
  const main=$("#main"),center=main.scrollTop+main.clientHeight/2;
  const candidates=[...residentPages].sort((a,b)=>Math.abs(b.node.offsetTop-center)-Math.abs(a.node.offsetTop-center));
  let bytes=candidates.reduce((sum,r)=>{const c=r.surface?.querySelector("canvas");return sum+(c?c.width*c.height*4:0);},0);
  for(const r of candidates){
    if(nearViewport(r)||r.node.contains(document.getSelection()?.anchorNode))continue;
    if(nearViewport(r,main.clientHeight)&&bytes<=RASTER_BUDGET)continue;
    const c=r.surface?.querySelector("canvas");bytes-=c?c.width*c.height*4:0;
    releaseSurface(r.surface);r.surface=null;r.rendered=false;r.textContent=null;r.annotations=null;r.rasterViewport=null;delete r.node.dataset.rasterScale;
    r.node.querySelectorAll(".search-mark").forEach(n=>n.remove());r.page.cleanup();residentPages.delete(r);
  }
}
function queueRender(record,version){
  renderQueue=renderQueue.then(()=>renderPage(record,version)).catch(e=>{
    if(version!==epoch)return;
    record.rendered=false;record.node.querySelectorAll('.rendering-surface').forEach(releaseSurface);
    if(e.name!=='RenderingCancelledException'&&e.name!=='AbortException')report(e);
  });
}
function observePages(){
  observer?.disconnect();const version=epoch;const main=$('#main');
  // Render the page in view before spending time on neighboring pages.
  const visible=records.filter(r=>r.node.offsetTop<main.scrollTop+main.clientHeight&&r.node.offsetTop+r.node.offsetHeight>main.scrollTop);
  for(const r of visible)queueRender(r,version);
  observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const record=records[Number(entry.target.dataset.page)-1];if(record&&entry.isIntersecting)queueRender(record,version);}
  },{root:main,rootMargin:'250px 0px'});
  for(const r of records)observer.observe(r.node);
}
async function loadPDF(source,name){
  resetInsights();
  clearTimeout(zoomTimer);cancelAnimationFrame(zoomFrame);cancelAnimationFrame(scrollFrame);zoomFrame=scrollFrame=0;gestureActive=false;ready=false;currentSource=source;const version=++epoch;observer?.disconnect();summaryAbort?.abort();
  $('#summarize').disabled=true;$('#ai').disabled=true;$('#welcome').hidden=false;
  for(const r of records){r.task?.cancel();r.textTask?.cancel();}
  for(const r of records){releaseSurface(r.surface);r.node.querySelectorAll(".rendering-surface").forEach(releaseSurface);}residentPages.clear();
  await loadingTask?.destroy();
  if(version!==epoch)return;
  doc=null;records=[];pageRows=[];collapsedSections.clear();summaries.clear();outline=[];refs=[];history=[];$('#back').disabled=true;$('#pages').replaceChildren();drawOutline();status('Opening PDF…',false);
  try{
    loadingTask=pdfjs.getDocument({...source,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false});
    loadingTask.onPassword=(update,reason)=>{const password=prompt(reason===2?'Incorrect password. Try again:':'This PDF is password protected. Enter its password:');if(password===null)loadingTask.destroy();else update(password);};
    doc=await loadingTask.promise;if(version!==epoch)return;
    $('#welcome').hidden=true;const metadata=await doc.getMetadata().catch(()=>null);
    $('#title').textContent=metadata?.info?.Title||name||'Untitled paper';document.title=$('#title').textContent+' · ArxivPDFReader';
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n);if(version!==epoch)return;
      const viewport=page.getViewport({scale});const node=el('section',null,'pdf-page');node.dataset.page=n;node.setAttribute('aria-label',`Page ${n}`);node.style.width=viewport.width+'px';node.style.height=viewport.height+'px';$('#pages').append(node);records.push({number:n,node,page,viewport,rendered:false});
    }
    if(fitMode==='width'){scale=clampScale(($('#main').clientWidth-56)/records[0].page.getViewport({scale:1,rotation}).width);for(const r of records){r.viewport=r.page.getViewport({scale,rotation});r.node.style.width=r.viewport.width+'px';r.node.style.height=r.viewport.height+'px';}updateZoomLabel();}
    // Render the first page while the text index is built. Re-render once references exist.
    await renderPage(records[0],version);
    for(let n=1;n<=doc.numPages;n++){
      const record=records[n-1],page=record.page;const text=record.textContent||await readPageText(page);record.textContent=text;if(version!==epoch)return;
      pageRows.push(linesFromItems(text.items,n,page.getViewport({scale:1}).width));if(!record.surface){record.textContent=null;page.cleanup();}status(`Finding sections and references · ${n} / ${doc.numPages}`,false);
    }
    outline=await flattenOutline(await doc.getOutline());if(!outline.length)outline=inferOutline(pageRows);
    refs=extractReferences(pageRows);internalTargets.clear();pageRows.forEach((rows,p)=>{for(const r of rows){const m=r.text.match(/^(Figure|Fig\.?|Table)\s+(\d+(?:\.\d+)?|[IVX]+)\s*[:.]/i);if(m){const key=(/^tab/i.test(m[1])?'table':'figure')+m[2].toLowerCase();if(!internalTargets.has(key))internalTargets.set(key,{page:p+1,y:r.y});}}});drawOutline();
    $('#sidebar-note').textContent=outline.some(o=>o.inferred)?'Detected from PDF text · headings may need checking':'Document outline';
    for(const r of records)r.rendered=false;
    ready=true;observePages();$('#main').scrollTop=0;onDocumentReady();$('#ai').disabled=false;$('#summarize').disabled=false;
    status(`${doc.numPages} pages · ${outline.length} sections · ${refs.length} references`,false);
  }catch(e){if(version===epoch){$('#welcome').hidden=false;report(new Error('Could not open PDF: '+e.message+' Download it and use Open PDF if the website blocks access.'));}}
}
async function loadURL(url,fromUserGesture=true){
  const safe=safeURL(url);if(!safe)throw new Error('Enter an HTTP or HTTPS PDF address.');
  const allowed=await pdfAccess(api,safe,fromUserGesture);
  if(!allowed){
    $('#url').value=safe;
    status('Click Read beside the PDF link to allow website access.');
    return;
  }
  // Public PDFs must omit cross-origin cookies: arXiv uses Access-Control-Allow-Origin: *.
  await loadPDF({url:safe,withCredentials:false},decodeURIComponent(new URL(safe).pathname.split('/').pop()));
}
const openPicker=()=>$('#file').click();$('#open').onclick=openPicker;$('#choose').onclick=openPicker;
$('#file').onchange=async e=>{const file=e.target.files[0];if(file)await loadPDF({data:new Uint8Array(await file.arrayBuffer())},file.name);e.target.value='';};
$('#url-form').onsubmit=e=>{e.preventDefault();loadURL($('#url').value).catch(report);};
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',async e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)await loadPDF({data:new Uint8Array(await file.arrayBuffer())},file.name);});
$('#toggle').onclick=()=>document.body.classList.toggle('hide-sidebar');
function updateZoomLabel(){const input=$('#zoom');if(input.tagName==='INPUT')input.value=Math.round(scale*100)+'%';else input.textContent=Math.round(scale*100)+'%';}
function setScale(value,anchor){
  if(!ready||!records.length)return;
  value=clampScale(value);if(Math.abs(value-scale)<1e-8&&records[0].viewport.rotation===rotation)return;
  scale=value;pendingAnchor=anchor;updateZoomLabel();
  // Many wheel/pinch events can arrive between display frames. Layout once.
  if(!zoomFrame)zoomFrame=requestAnimationFrame(applyZoom);
  clearTimeout(zoomTimer);if(!gestureActive)zoomTimer=setTimeout(finishZoom,120);
}
function finishZoom(){flushZoom();trimPageCache();observePages();}
function beginGesture(){gestureActive=true;clearTimeout(zoomTimer);}
function endGesture(){gestureActive=false;clearTimeout(zoomTimer);zoomTimer=setTimeout(finishZoom,40);}
function flushZoom(){if(zoomFrame){cancelAnimationFrame(zoomFrame);applyZoom();}}
function applyZoom(){
  zoomFrame=0;if(!ready||!records.length)return;
  const main=$('#main'),box=main.getBoundingClientRect(),anchor=pendingAnchor;
  const x=anchor?Math.max(0,Math.min(box.width,anchor.x-box.left)):main.clientWidth/2;
  const y=anchor?Math.max(0,Math.min(box.height,anchor.y-box.top)):main.clientHeight/2;
  const center=main.scrollTop+y;
  const record=records.find(r=>r.node.offsetTop+r.node.offsetHeight>=center)||records.at(-1);
  const frac=(center-record.node.offsetTop)/record.viewport.height;
  const horizontal=(main.scrollLeft+x-record.node.offsetLeft)/record.viewport.width;
  ++epoch;observer?.disconnect();
  for(const r of records){
    r.task?.cancel();r.textTask?.cancel();r.task=r.textTask=null;r.node.querySelectorAll('.rendering-surface').forEach(releaseSurface);
    r.viewport=r.page.getViewport({scale,rotation});r.node.style.width=r.viewport.width+'px';r.node.style.height=r.viewport.height+'px';
    if(r.surface){
      const old=r.rasterViewport,ratio=scale/old.scale,turn=(rotation-old.rotation+360)%360;
      const x=turn===90?old.height*ratio:turn===180?old.width*ratio:0;
      const y=turn===180?old.height*ratio:turn===270?old.width*ratio:0;
      r.surface.style.transform=`translate(${x}px,${y}px) rotate(${turn}deg) scale(${ratio})`;
      r.rendered=r.linksReady&&Math.abs(old.scale-scale)<.001&&old.rotation===rotation;
    }else r.rendered=false;
  }
  main.scrollTop=record.node.offsetTop+frac*record.viewport.height-y;
  main.scrollLeft=record.node.offsetLeft+horizontal*record.viewport.width-x;
  // Only visible pages need overlay geometry refreshed during a gesture.
  const visible=[...residentPages].filter(r=>nearViewport(r));
  for(const r of visible){highlightSearch(r);}
}
function zoomBy(delta){fitMode=null;setScale(scale+delta);}
function zoomAction(command,value,anchor){fitMode=null;setScale(command==='reset'?1:command==='multiply'?scale*value:scale+(command==='in'?.15:-.15),anchor);}
installPDFZoom(document,zoomAction,()=>showSearch(),{start:beginGesture,end:endGesture});
window.addEventListener('message',event=>{
  if(event.source!==window.parent||window.parent===window)return;
  const source=new URL(location.href).searchParams.get('url');if(!source||event.origin!==new URL(source).origin)return;
  if(event.data?.type==='papertrail-gesture'){if(event.data.phase==='start')beginGesture();else endGesture();}
  if(event.data?.type==='papertrail-zoom')zoomAction(event.data.command,event.data.value,event.data.anchor);
  if(event.data?.type==='papertrail-search')showSearch();
  if(event.data?.type==='papertrail-go-page')jump(Number(event.data.page),null,false);
});
$('#zoomin').onclick=()=>zoomBy(.15);$('#zoomout').onclick=()=>zoomBy(-.15);
$('#close-ai').onclick=()=>$('#ai-dialog').close();
function summaryInput(){const all=sectionsForSummary(outline,pageRows);return $('#summary-scope').value==='all'?all:all.slice(0,5);}
function estimate(){const sections=summaryInput();$('#ai-estimate').textContent=`${sections.length} sections · approximately ${Math.ceil(JSON.stringify(sections).length/4).toLocaleString()} input tokens. Charged at your selected model’s API rates.`;}
$('#summary-scope').onchange=estimate;
$('#ai').onclick=()=>{if(!doc||!outline.length){status('Open a PDF with detectable headings first.');return;}estimate();$('#ai-dialog').showModal();};
$('#summarize').onclick=async()=>{
  const key=$('#api-key').value.trim(),model=$('#model').value.trim();
  if(!key||!model){$('#ai-status').textContent='Enter an API key and model.';return;}
  const sections=summaryInput();const targetDoc=doc;$('#summarize').disabled=true;summaryAbort=new AbortController();
  try{
    for(let i=0;i<sections.length;i+=4){
      $('#ai-status').textContent=`Summarizing sections ${i+1}–${Math.min(i+4,sections.length)} of ${sections.length}…`;
      const timer=setTimeout(()=>summaryAbort.abort(),90000);
      let results;try{results=await summarizeSections(sections.slice(i,i+4),key,model,fetch,summaryAbort.signal);}finally{clearTimeout(timer);}
      if(doc!==targetDoc)return;
      for(const s of results){const section=sections.find(x=>x.id===s.id);if(!section)continue;const i=outline.findIndex(x=>x.title===section.title&&x.page===section.page);summaries.set(i,{bullets:s.bullets,truncated:section.truncated});}drawOutline();
    }
    $('#ai-status').textContent='Summaries added to the outline.';status('AI outline ready · verify important claims against the paper');$('#ai-dialog').close();
  }catch(e){$('#ai-status').textContent=e.name==='AbortError'?'Summary cancelled or timed out. Completed sections are retained.':e.message;}finally{$('#summarize').disabled=false;$('#api-key').value='';}
};
const sidebarModes=['outline','thumbnails','notes'];
function selectSidebar(mode){for(const name of sidebarModes){$('#'+name).hidden=name!==mode;$('#'+name+'-tab').classList.toggle('selected',name===mode);}$('#outline-actions').hidden=mode!=='outline';if(mode==='thumbnails')drawThumbnails().catch(report);if(mode==='notes')drawNotes();}
for(const mode of sidebarModes)$('#'+mode+'-tab').onclick=()=>selectSidebar(mode);
$('#collapse-all').onclick=()=>{const collapse=collapsedSections.size===0;collapsedSections.clear();if(collapse)outline.forEach((o,i)=>{if(outline[i+1]?.level>o.level)collapsedSections.add(i);});drawOutline();$('#collapse-all').textContent=collapse?'Expand all':'Collapse all';};
$('#copy-outline').onclick=()=>copyText(outline.map((o,i)=>'  '.repeat(o.level)+o.title+' (p. '+o.page+')'+($(`[data-section="${i}"] .summary`)?.textContent?'\n'+$(`[data-section="${i}"] .summary`).textContent:'')).join('\n'));
function currentPage(){const main=$('#main'),center=main.scrollTop+main.clientHeight*.35;return records.find(r=>r.node.offsetTop+r.node.offsetHeight>center)?.number||1;}
$('#main').addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(ready){$('#page-number').value=currentPage();if(!zoomFrame&&!gestureActive)trimPageCache();}});}, {passive:true});
$('#page-number').onchange=()=>{const page=Number($('#page-number').value);if(doc&&Number.isInteger(page)&&page>0&&page<=doc.numPages)jump(page);else $('#page-number').value=currentPage();};
$('#prev-page').onclick=()=>jump(Math.max(1,currentPage()-1));$('#next-page').onclick=()=>jump(Math.min(doc?.numPages||1,currentPage()+1));
$('#zoom').onchange=()=>{fitMode=null;setScale(parseFloat($('#zoom').value)/100);updateZoomLabel();};
function fitWidth(){if(!ready)return;fitMode='width';const raw=records[currentPage()-1].page.getViewport({scale:1,rotation});setScale(($('#main').clientWidth-56)/raw.width);}
$('#fit').onclick=fitWidth;
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(fitMode==='width')fitWidth();},120);});
$('#rotate').onclick=()=>{if(!ready)return;const page=currentPage();rotation=(rotation+90)%360;setScale(scale);jump(page,null,false);};
$('#toggle').addEventListener('click',()=>{if(fitMode==='width')fitWidth();});
let searchMatches=[],searchIndex=-1;
function showSearch(){$('#find-bar').hidden=false;$('#find-input').focus();$('#find-input').select();}
$('#search').onclick=showSearch;$('#find-close').onclick=()=>{$('#find-bar').hidden=true;$('#find-input').value='';searchMatches=[];for(const r of records)highlightSearch(r);};
function searchPDF(){const q=$('#find-input').value.trim().toLowerCase();searchMatches=[];searchIndex=-1;if(q)pageRows.forEach((rows,index)=>{const text=rows.map(r=>r.text).join(' ').toLowerCase();let from=0,at;while((at=text.indexOf(q,from))>=0){let offset=0;const row=rows.find(r=>{offset+=r.text.length+1;return offset>at;});searchMatches.push({page:index+1,at,y:row?.y});from=at+q.length;if(searchMatches.length>=10000)break;}});for(const r of records)highlightSearch(r);stepSearch(1);}
function stepSearch(delta){if(!searchMatches.length){$('#find-count').textContent=$('#find-input').value?'No matches':'';return;}searchIndex=(searchIndex+delta+searchMatches.length)%searchMatches.length;const hit=searchMatches[searchIndex];jump(hit.page,hit.y,false);$('#find-count').textContent=`${searchIndex+1} / ${searchMatches.length}`;}
function highlightSearch(record){paintSearchHighlights(record.node,$('#find-input').value);}
let searchTimer;$('#find-input').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchPDF,150);};$('#find-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();stepSearch(e.shiftKey?-1:1);}if(e.key==='Escape')$('#find-close').click();};$('#find-next').onclick=()=>stepSearch(1);$('#find-prev').onclick=()=>stepSearch(-1);
let thumbnailDoc;
async function drawThumbnails(){if(!ready||thumbnailDoc===doc)return;const target=doc;thumbnailDoc=target;$('#thumbnails').replaceChildren();for(const r of records){if(doc!==target)return;const b=el('button',null,'thumbnail');b.setAttribute('aria-label','Go to page '+r.number);const canvas=el('canvas');const viewport=r.page.getViewport({scale:.22});canvas.width=viewport.width;canvas.height=viewport.height;b.append(canvas,el('span','Page '+r.number));b.onclick=()=>jump(r.number);$('#thumbnails').append(b);await r.page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;}}
const storage={async get(key,fallback){try{const v=api?.storage? (await api.storage.local.get(key))[key]:JSON.parse(localStorage.getItem(key));return v??fallback;}catch{return fallback;}},async set(key,value){if(api?.storage)await api.storage.local.set({[key]:value});else localStorage.setItem(key,JSON.stringify(value));}};
function utility(title){$('#utility-title').textContent=title;$('#utility-body').replaceChildren();if(!$('#utility-dialog').open)$('#utility-dialog').showModal();return $('#utility-body');}
$('#utility-close').onclick=()=>$('#utility-dialog').close();
async function copyText(text){try{await navigator.clipboard.writeText(text);status('Copied to clipboard');}catch{const body=utility('Copy text');const area=el('textarea');area.value=text;body.append(area);area.select();}}
function saveFile(data,type,name){const url=URL.createObjectURL(new Blob([data],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function savePaper(paper){const list=await storage.get('papertrail-library',[]);const id=paper.url||paper.pdf||paper.title;const item={...paper,savedAt:Date.now()};await storage.set('papertrail-library',[item,...list.filter(x=>(x.url||x.pdf||x.title)!==id)].slice(0,500));status('Saved to this browser’s ArxivPDFReader library');}
$('#save-paper').onclick=()=>{if(documentInfo)savePaper(documentInfo).catch(report);};
$('#library').onclick=async()=>{const body=utility('Saved papers');const list=await storage.get('papertrail-library',[]);if(!list.length)body.append(el('p','No saved papers yet.'));for(const p of list){const section=el('section');section.append(el('h3',p.title),el('p',[p.authors,p.year].filter(Boolean).join(' · '),'small'),paperActions(p));const remove=el('button','Remove from library');remove.onclick=async()=>{const current=await storage.get('papertrail-library',[]);await storage.set('papertrail-library',current.filter(x=>(x.url||x.pdf||x.title)!==(p.url||p.pdf||p.title)));section.remove();};section.append(remove);body.append(section);}const exp=el('button','Export library');exp.onclick=()=>saveFile(JSON.stringify(list,null,2),'application/json','arxivpdfreader-library.json');body.append(exp);};
function showCite(paper){
  const body=utility('BibTeX'),text=citationFormats(paper).BibTeX;
  body.append(el('pre',text));const copy=el('button','Copy BibTeX');copy.onclick=()=>copyText(text);
  const download=el('button','Download .bib');download.onclick=()=>saveFile(text,'application/x-bibtex','citation.bib');body.append(copy,download);
}
$('#cite').onclick=()=>{if(documentInfo)showCite(documentInfo);};
$('#scholar').onclick=()=>checkOnScholar();
$('#download').onclick=async()=>{if(!doc)return;try{saveFile(await doc.getData(),'application/pdf',($('#title').textContent||'paper').replace(/[^\w .-]/g,'_')+'.pdf');}catch(e){report(e);}};
$('#print').onclick=async()=>{
  if(!doc||!ready)return;const target=doc;const area=el('div');area.id='print-pages';document.body.append(area);status('Preparing printable pages…');
  try{for(let n=1;n<=target.numPages;n++){if(doc!==target)throw Error('Document changed.');const p=await target.getPage(n),v=p.getViewport({scale:1.5}),canvas=el('canvas');canvas.width=v.width;canvas.height=v.height;area.append(canvas);await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;}window.print();}catch(e){report(e);}finally{area.remove();status('Ready to read',false);}
};
$('#properties').onclick=async()=>{if(!doc)return;const m=await doc.getMetadata();const body=utility('Document properties');for(const [key,value] of Object.entries({Title:documentInfo?.title,Pages:doc.numPages,Version:m.info?.PDFFormatVersion,Author:m.info?.Author,Producer:m.info?.Producer,Created:m.info?.CreationDate,Size:((await doc.getData()).length/1024/1024).toFixed(2)+' MB'})){if(value)body.append(el('p',key+': '+value));}};
$('#original').onclick=()=>{const source=new URL(location.href).searchParams.get('url');if(source&&window.parent!==window)window.parent.postMessage({type:'papertrail-original'},new URL(source).origin);};
$('#more').onclick=()=>{$('#more-menu').hidden=!$('#more-menu').hidden;};document.addEventListener('pointerdown',e=>{if(!e.target.closest('#more,#more-menu'))$('#more-menu').hidden=true;});$('#more-menu').addEventListener('click',e=>{if(e.target.tagName==='BUTTON')$('#more-menu').hidden=true;});
async function applyTheme(value,persist=true){document.body.dataset.theme=value;$('#theme').value=value;if(persist)await storage.set('papertrail-theme',value);}
$('#theme').onchange=()=>applyTheme($('#theme').value);storage.get('papertrail-theme','system').then(x=>applyTheme(x,false));
let notes=[],notesKey='';
async function loadNotes(){const key='papertrail-notes-'+doc.fingerprints[0];notesKey=key;const saved=await storage.get(key,[]);if(notesKey!==key)return;notes=saved;drawNotes();}
async function persistNotes(){await storage.set(notesKey,notes);drawNotes();}
function drawNotes(){const list=$('#notes-list');list.replaceChildren();if(!notes.length)list.append(el('p','No saved notes.','small'));for(const n of notes){const b=el('button',`Page ${n.page} · ${n.quote}\n${n.comment||''}`);b.onclick=()=>{jump(n.page);editNote(n);};list.append(b);}}
function editNote(note){const body=utility('Saved note');body.append(el('blockquote',note.quote));const text=el('textarea');text.value=note.comment||'';text.placeholder='Add a comment…';body.append(text);const save=el('button','Save comment');save.onclick=async()=>{note.comment=text.value;await persistNotes();$('#utility-dialog').close();};const remove=el('button','Remove note');remove.onclick=async()=>{notes=notes.filter(n=>n.id!==note.id);await persistNotes();$('#utility-dialog').close();};body.append(save,remove);}
$('#export-notes').onclick=()=>saveFile(JSON.stringify({paper:documentInfo,notes},null,2),'application/json','arxivpdfreader-notes.json');
function onDocumentReady(){
  $('#page-count').textContent='/ '+doc.numPages;$('#page-number').value=1;thumbnailDoc=null;notes=[];loadNotes().catch(report);
  const source=currentSource?.url||null;const id=source?identifiers(source):{};const target=doc;
  const guess=pageRows[0]?.filter(r=>r.text.length>12&&!/provided proper|arxiv:|abstract/i.test(r.text)).sort((a,b)=>b.size-a.size)[0]?.text;
  documentInfo={title:$('#title').textContent,authors:'',year:'',pdf:source,url:source,...id};
  if(/^\d{4}\.\d+/.test(documentInfo.title)||/\.pdf$/i.test(documentInfo.title)||!documentInfo.title.trim())documentInfo.title=guess||documentInfo.title;
  $('#title').textContent=documentInfo.title;$('#title').title=documentInfo.title;document.title=documentInfo.title;
  $('#pangram').disabled=false;
  (async()=>{
    if(id.arxiv){try{const works=await resolveReference({text:source,...id});if(doc!==target)return;if(works[0]){documentInfo=works[0];$('#title').textContent=documentInfo.title;$('#title').title=documentInfo.title;document.title=documentInfo.title;}}catch{}}
    if(doc===target)updateCitationCount(target);
  })();
}

let scholarRetryTimer=null,scholarRetryKey='',scholarRetried=false;
let insightsVersion=0,pangramAbort=null,pangramTask=null,pangramKey='',pangramText='';
function resetInsights(){
  clearTimeout(scholarRetryTimer);scholarRetryKey='';scholarRetried=false;
  insightsVersion++;pangramAbort?.abort();pangramAbort=null;pangramTask=null;pangramText='';
  $('#pangram-key').disabled=false;$('#pangram-models').disabled=false;
  $('#pangram').disabled=true;$('#pangram').textContent='AI check';
  $('#pangram-dialog').close();$('#pangram-result').replaceChildren();$('#pangram-status').textContent='';
  $('#pangram-resume').hidden=true;$('#pangram-stop').hidden=true;$('#pangram-send').disabled=!$('#pangram-model').value;
  const label=$('#citation-count');label.textContent='Scholar citations…';label.title='Looking up this paper on Google Scholar';
}
const lookupScholar=createScholarLookup(storage);
async function updateCitationCount(target){
  const version=insightsVersion,label=$('#citation-count'),title=documentInfo?.title,key=scholarKey(title);
  const current=()=>version===insightsVersion&&doc===target&&scholarKey(documentInfo?.title)===key;
  const counts=await storage.get(SCHOLAR_COUNTS,{});
  if(!current())return;
  const paint=(value,error,kind)=>{
    label.textContent=value?`${value.count.toLocaleString()} citations · Scholar`:({'not-found':'Not found on Scholar','no-count':'No count on Scholar',blocked:'Scholar verification needed',permission:'Scholar access needed'})[kind]||'Scholar unavailable';
    label.title=value?`Google Scholar: “${value.title}” · checked ${new Date(value.checkedAt).toLocaleDateString()}.${error?' Refresh unavailable: '+error:''}`:error||'Citation count unavailable';
  };
  if(validScholarCount(counts[key],key))paint(counts[key]);
  else{label.textContent='Scholar citations…';label.title='Looking up this paper on Google Scholar';}
  try{
    const result=await lookupScholar(title);if(!current())return;
    paint(result.value,result.error,result.kind);
    if(scholarRetryKey!==key){clearTimeout(scholarRetryTimer);scholarRetryKey=key;scholarRetried=false;}
    if(!result.error){clearTimeout(scholarRetryTimer);return;}
    // One automatic recovery per paper, only for temporary failures. Focus can
    // retry later after backoff; verification challenges never trigger polling.
    if(result.kind==='temporary'&&!scholarRetried&&result.retryAt){
      clearTimeout(scholarRetryTimer);
      scholarRetryTimer=setTimeout(()=>{scholarRetried=true;if(current()&&!document.hidden)updateCitationCount(target);},Math.max(0,result.retryAt-Date.now())+100);
    }
  }
  catch(error){if(current())paint(null,error.message);}
}
function checkOnScholar(){
  const title=documentInfo?.title;if(!title)return;
  // Request access in the click stack, before awaiting anything (Safari).
  const permission=api?.permissions?.request({origins:['https://scholar.google.com/*']})||Promise.resolve(false);
  const version=insightsVersion;
  permission.then(async granted=>{
    if(version!==insightsVersion)return;
    if(!granted||!api?.tabs?.create){window.open(scholarURL(title),'_blank','noopener,noreferrer');status('Check “Cited by” on Google Scholar. Website access is required to import the count.');return;}
    const token=crypto.randomUUID(),key=scholarKey(title);
    // Expire abandoned requests; only count snapshots are kept long-term.
    const saved=await api.storage.local.get(null);
    const expired=Object.keys(saved).filter(k=>k.startsWith('papertrail-scholar-pending-')&&Date.now()-saved[k].createdAt>30*60*1000);
    if(expired.length)await api.storage.local.remove(expired);
    await api.storage.local.set({['papertrail-scholar-pending-'+token]:{key,title,createdAt:Date.now()}});
    await api.tabs.create({url:scholarURL(title,token),active:true});
    status('Choose “Use citation count” under the correct Google Scholar result, then return here.');
  }).catch(e=>status('Could not open Google Scholar: '+e.message));
}
api?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[SCHOLAR_COUNTS]&&ready)updateCitationCount(doc);});
window.addEventListener('focus',()=>{if(ready)updateCitationCount(doc);});
$('#pangram').onclick=()=>{
  if(!ready)return;
  pangramText=paperText(pageRows);
  const words=pangramText.match(/\S+/g)?.length||0;
  $('#pangram-scope').textContent=`${doc.numPages} pages · approximately ${words.toLocaleString()} extracted words. Check current pricing before sending.`;
  $('#pangram-send').disabled=!$('#pangram-model').value||!pangramText||pangramText.length>500000||!!pangramTask;
  if(!pangramText)$('#pangram-status').textContent='No readable text found. This PDF may need OCR; you can upload it on Pangram instead.';
  if(pangramText.length>500000)$('#pangram-status').textContent='This paper exceeds the 500,000-character integration limit. Copy the text or upload the PDF on Pangram; nothing has been sent.';
  $('#pangram-dialog').showModal();
};
$('#close-pangram').onclick=()=>$('#pangram-dialog').close();
$('#pangram-copy').onclick=()=>copyText(pangramText);
$('#pangram-key').oninput=()=>{pangramKey='';$('#pangram-model').replaceChildren(new Option('Reload models for this key',''));$('#pangram-model').disabled=true;$('#pangram-send').disabled=true;};
$('#pangram-models').onclick=async()=>{
  const version=insightsVersion,key=$('#pangram-key').value.trim()||pangramKey;
  if(!key){$('#pangram-status').textContent='Enter your Pangram API key first, or use Copy paper text and Open Pangram.';return;}
  $('#pangram-models').disabled=true;$('#pangram-status').textContent='Loading available models…';
  try{
    const data=await pangramRequest('/models',key);
    if(version!==insightsVersion)return;
    if(!Array.isArray(data.models)||!data.models.length||data.models.some(m=>typeof m!=='string'||!m))throw Error('No detection models are available for this key.');
    pangramKey=key;$('#pangram-key').value='';
    $('#pangram-model').replaceChildren(...data.models.map(m=>new Option(m,m)));$('#pangram-model').disabled=false;
    $('#pangram-send').disabled=!pangramText||pangramText.length>500000||!!pangramTask;
    $('#pangram-status').textContent='Ready. Text is sent only when you select Send text & analyze.';
  }catch(e){if(version===insightsVersion)$('#pangram-status').textContent=e.message;}
  finally{$('#pangram-models').disabled=false;}
};
async function checkPangram(submit){
  const version=insightsVersion;
  if(pangramAbort&&!pangramAbort.signal.aborted)return;
  const controller=new AbortController();pangramAbort=controller;
  $('#pangram-send').disabled=true;$('#pangram-resume').hidden=true;$('#pangram-stop').hidden=false;$('#pangram-models').disabled=true;$('#pangram-key').disabled=true;
  try{
    if(submit){
      if(!pangramKey||!pangramText||!$('#pangram-model').value)throw Error('Load your Pangram models before sending.');
      $('#pangram-status').textContent='Submitting extracted text to Pangram…';
      // Keep the returned task ID even if waiting is stopped: never silently
      // resubmit a paid job when the user resumes polling.
      const data=await pangramRequest('/task',pangramKey,{text:pangramText,model:$('#pangram-model').value});
      if(version!==insightsVersion)return;
      if(typeof data.task_id!=='string'||! /^[A-Za-z0-9_-]+$/.test(data.task_id))throw Error('Pangram did not return a task ID. Check your Pangram dashboard before submitting again.');
      pangramTask={id:data.task_id,key:pangramKey};
    }
    controller.signal.throwIfAborted();
    $('#pangram-status').textContent='Pangram is analyzing the paper…';
    const result=await waitForPangram(pangramTask.id,pangramTask.key,{signal:controller.signal});
    if(version!==insightsVersion)return;
    const percent=n=>(n*100).toFixed(1)+'%';
    $('#pangram-result').replaceChildren(el('h3','Pangram estimate'),el('p',`${percent(result.ai)} AI-written · ${percent(result.assisted)} AI-assisted · ${percent(result.human)} human-written`),el('p','Classification of the extracted text; not a verified measure of authorship.','small'));
    $('#pangram').textContent=`AI ${percent(result.ai)}`;$('#pangram-status').textContent='Analysis complete.';pangramTask.complete=true;
  }catch(e){if(version===insightsVersion)$('#pangram-status').textContent=e.name==='AbortError'?'Stopped waiting. A submitted check may still finish and incur charges. Check result resumes the same job.':e.message;}
  finally{
    if(version===insightsVersion){pangramAbort=null;$('#pangram-stop').hidden=true;$('#pangram-resume').hidden=!pangramTask||pangramTask.complete;$('#pangram-send').disabled=!!pangramTask||!$('#pangram-model').value;$('#pangram-models').disabled=false;$('#pangram-key').disabled=false;}
  }
}
$('#pangram-send').onclick=()=>checkPangram(true);
$('#pangram-resume').onclick=()=>checkPangram(false);
$('#pangram-stop').onclick=()=>pangramAbort?.abort();

const initial=new URL(location.href).searchParams.get('url');if(initial)loadURL(initial,false).then(()=>{const page=Number(new URLSearchParams(new URL(initial).hash.slice(1)).get('page'));if(doc&&Number.isInteger(page)&&page>0&&page<=doc.numPages)jump(page,null,false);}).catch(report);

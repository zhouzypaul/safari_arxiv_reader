export const clean = s => s.replace(/\s+/g,' ').trim();
export function safeURL(value) { try { const u=new URL(value); return /^https?:$/.test(u.protocol)?u.href:null; } catch { return null; } }
export function linesFromItems(items, page, width) {
  const rows=[];
  for(const item of items) {
    if(!item.str?.trim()) continue;
    const x=item.transform[4], y=item.transform[5], size=Math.hypot(item.transform[2],item.transform[3]);
    let row=rows.find(r=>Math.abs(r.y-y)<Math.max(2,size*.2)&&Math.abs(r.right-x)<24);
    if(!row) { row={text:'',x,y,right:x,size,page,width,font:item.fontName}; rows.push(row); }
    row.text+= (row.text && x-row.right>size*.15?' ':'')+item.str;
    row.right=x+item.width; row.size=Math.max(row.size,size);
  }
  // Separate two-column body text only when there is strong evidence of two columns.
  const left=rows.filter(r=>r.x<width*.4&&r.right<width*.57);
  const right=rows.filter(r=>r.x>width*.43);
  const columns=left.length>10&&right.length>10;
  const column=r=>columns&&r.x>width*.43?1:0;
  return rows.sort((a,b)=>column(a)-column(b)||b.y-a.y||a.x-b.x).map(r=>({...r,text:clean(r.text)}));
}
export function inferOutline(pages) {
  const rows=pages.flat();
  const counts=new Map(); for(const r of rows){ const n=Math.round(r.size*2)/2; counts.set(n,(counts.get(n)||0)+r.text.length); }
  const body=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||10;
  const out=[],seen=new Set();
  for(const r of rows) {
    const t=r.text;
    const numbered=/^(\d{1,2}(?:\.\d{1,2}){0,3}\.?|[A-H](?:\.\d+)?)\s+([A-Z][\w ,:()\-–/&]+)$/.exec(t);
    const named=/^(abstract|introduction|background|related work|methods?|methodology|experiments?|results|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments|appendix(?:\s.*)?)$/i.test(t);
    const typographic=r.size>body*1.13 && t.length>3 && !/[.!?]$/.test(t);
    if(t.length>105 || t.length<3 || seen.has(t.toLowerCase()) || !(named || (numbered&&r.size>=body*.95) || (typographic&&out.length>0))) continue;
    if(/^(figure|table|https?:|arxiv:)/i.test(t)) continue;
    seen.add(t.toLowerCase()); out.push({title:t,page:r.page,y:r.y,level:numbered?numbered[1].split('.').filter(Boolean).length-1:0,inferred:true});
    if(out.length>=120) break;
  }
  return out;
}
export function extractReferences(pages) {
  const rows=pages.flat();
  const start=rows.findIndex(r=>/^(?:(?:\d+|[A-Z])\.?\s+)?(?:references|bibliography)$/i.test(r.text));
  if(start<0) return [];
  const refs=[]; let current=null;
  const bodyRows=rows.slice(start+1);
  const indents=bodyRows.filter(r=>r.text.length>30).map(r=>r.x).filter(Number.isFinite);
  const left=indents.length?Math.min(...indents):null;
  const hanging=left!==null&&bodyRows.filter(r=>r.x>left+5&&r.x<left+20).length>4;
  for(const r of rows.slice(start+1)) {
    if(/^(?:[A-Z]\s+)?(?:appendix|supplementary material)\b/i.test(r.text)) break;
    if(/^\d+$/.test(r.text)||r.text.length<3) continue;
    const numbered=/^\s*\[(\d+)\]\s*(.*)/.exec(r.text)||/^\s*(\d{1,3})\.\s+([A-Z].*)/.exec(r.text);
    const authorStart=/^[\p{L}'’\-]+,\s*(?:[A-Z]\.|[A-Z][a-z]+)/u.test(r.text)|| (hanging&&Math.abs(r.x-left)<3&&/^[A-ZÀ-Ž]/.test(r.text)&&r.text.length>20);
    if(numbered || (authorStart&&(!current || /(?:19|20)\d{2}/.test(current.text)))) {
      current={id:numbered?numbered[1]:String(refs.length+1),text:numbered?numbered[2]:r.text,page:r.page,y:r.y,numbered:!!numbered}; refs.push(current);
    } else if(current) current.text=clean(current.text.replace(/-$/,'')+(current.text.endsWith('-')?'':' ')+r.text);
    else if(authorStart){current={id:String(refs.length+1),text:r.text,page:r.page,y:r.y,numbered:false};refs.push(current);}
  }
  return refs.map(r=>{const first=r.text.split(/,| and /)[0];const surname=first.trim().split(/\s+/).at(-1).replace(/[.;:]$/,'');return {...r,surname,...identifiers(r.text)};});
}
export function identifiers(text) {
  const doi=text.match(/10\.\d{4,9}\/[\w.();/:\-]+/i)?.[0]?.replace(/[.,;)]+$/,'');
  const arxiv=text.match(/(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/|\babs\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7})/i)?.[1];
  const pdf=text.match(/https?:\/\/[^\s<>]+\.pdf(?:\?[^\s<>]*)?/i)?.[0];
  return {doi,arxiv,pdf:safeURL(pdf)||(arxiv?`https://arxiv.org/pdf/${arxiv}`:null)};
}
export function citationNumbers(text) {
  const found=[];
  for(const match of text.matchAll(/\[([\d\s,;–—-]+)\]/g)) for(const chunk of match[1].split(/[,;]/)) {
    const range=chunk.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if(range){const a=+range[1],b=+range[2];if(b>=a&&b-a<30)for(let n=a;n<=b;n++)found.push(String(n));}
    else if(/^\d+$/.test(chunk.trim())) found.push(String(+chunk));
  }
  return [...new Set(found)];
}
export function matchReferences(text, refs) {
  const nums=citationNumbers(text);
  if(nums.length) return refs.filter(r=>r.numbered&&nums.includes(r.id));
  const years=[...text.matchAll(/(?:19|20)\d{2}[a-z]?/g)].map(m=>m[0]);
  if(!years.length) return [];
  const lower=text.toLowerCase();
  return refs.filter(r=>!r.numbered&&years.some(y=>r.text.includes(y))&&lower.includes((r.surname||r.text.split(/[,\s]/)[0]).toLowerCase()));
}
export function referenceQuery(text) {
  const normalized=clean(text.replace(/https?:\/\/\S+/g,'').replace(/\barxiv\s*:[\w./-]+/gi,''));
  const parts=normalized.split(/(?<=[a-z0-9)])\.\s+(?=[A-Z])/);
  const title=parts.length>1&&(/,| and |et al|\b(?:19|20)\d{2}\b/.test(parts[0])||/^[A-Z]\./.test(parts[0]))?parts[1]:normalized;
  return title.replace(/[.,]+$/,'').slice(0,450);
}
export function titleSimilarity(query,title) {
  const words=s=>new Set(s.toLowerCase().match(/[a-z]{3,}/g)||[]);
  const q=words(query),t=words(title); return t.size?[...t].filter(w=>q.has(w)).length/t.size:0;
}
export function sectionsForSummary(outline,pages) {
  const rows=pages.flat();
  const main=outline.filter(o=>!/references|bibliography/i.test(o.title));
  return main.slice(0,60).map((o,i)=>{
    const start=rows.findIndex(r=>r.page===o.page&&(o.y==null||r.y<=o.y+3));
    const next=main[i+1];
    let end=next?rows.findIndex((r,k)=>k>start&&r.page>=next.page&&(r.page>next.page||next.y==null||r.y<=next.y+3)):rows.length;
    if(end<0)end=rows.length;
    const bibliography=rows.findIndex((r,k)=>k>start&&/^(references|bibliography)$/i.test(r.text));
    if(bibliography>=0)end=Math.min(end,bibliography);
    const text=rows.slice(Math.max(0,start),end).map(r=>r.text).join('\n');
    return {id:i,title:o.title,page:o.page,text:text.slice(0,14000),truncated:text.length>14000};
  });
}

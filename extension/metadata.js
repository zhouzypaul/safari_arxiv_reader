import {referenceQuery,titleSimilarity,safeURL,identifiers} from './analysis.js';
const cache=new Map();
export function parseArxivHTML(html,id) {
  const dom=new DOMParser().parseFromString(html,'text/html');
  const meta=name=>dom.querySelector(`meta[name="${name}"]`)?.content||'';
  const title=meta('citation_title');
  if(!title)throw Error('arXiv metadata is unavailable.');
  const authors=Array.from(dom.querySelectorAll('meta[name="citation_author"]'),m=>m.content);
  return {title,authors:authors.join('; '),authorList:authors,doi:meta('citation_doi').replace(/^https?:\/\/doi.org\//,''),year:meta('citation_date').slice(0,4),abstract:meta('citation_abstract')||dom.querySelector('blockquote.abstract')?.textContent.replace(/^\s*Abstract:\s*/,'').trim()||'',pdf:`https://arxiv.org/pdf/${id}`,url:`https://arxiv.org/abs/${id}`,arxiv:id,score:1,source:'arXiv',exact:true};
}
export async function metadataFetch(url,fetcher=fetch) {
  const api=globalThis.browser||globalThis.chrome;
  if(api?.runtime?.sendMessage && fetcher===fetch){
    const response=await api.runtime.sendMessage({type:'papertrail-metadata',url});
    if(response?.error)throw Error(response.error);
    if(response?.text!==undefined)return response.text;
  }
  const response=await fetcher(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Metadata service returned ${response.status}.`);
  return response.text();
}
export async function resolveReference(ref, fetcher=fetch) {
  const ids={...identifiers(ref.text||''),...Object.fromEntries(Object.entries(ref).filter(([,v])=>v!=null))};
  const key=ids.arxiv||ids.doi||ref.text;
  if(cache.has(key))return cache.get(key);
  const pending=(async()=>{
    if(ids.arxiv){
      try{return [parseArxivHTML(await metadataFetch(`https://arxiv.org/abs/${ids.arxiv}`,fetcher),ids.arxiv)];}catch{}
    }
    const query=referenceQuery(ref.text||'');
    const endpoint=ids.doi?`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(ids.doi)}`:`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=5`;
    const data=JSON.parse(await metadataFetch(endpoint,fetcher));
    const works=ids.doi?[data]:(data.results||[]);
    const year=(ref.text||'').match(/\b(?:19|20)\d{2}\b/g)?.at(-1);
    return works.map(w=>{
      const locations=[w.best_oa_location,w.primary_location,...(w.locations||[])].filter(Boolean);
      const authorList=(w.authorships||[]).map(a=>a.author?.display_name).filter(Boolean);
      const score=ids.doi?1:Math.sqrt(titleSimilarity(query,w.title||'')*titleSimilarity(w.title||'',query));
      const abstract=w.abstract_inverted_index?Object.entries(w.abstract_inverted_index).flatMap(([word,positions])=>positions.map(p=>[p,word])).sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join(' '):'';
      const paper={title:w.title||'Untitled',authors:authorList.slice(0,8).join(', '),authorList,year:w.publication_year,pdf:locations.map(l=>safeURL(l.pdf_url)).find(Boolean)||ids.pdf,url:safeURL(w.doi)||safeURL(w.id),doi:w.doi?.replace('https://doi.org/',''),abstract,score,source:'OpenAlex',exact:!!ids.doi,venue:w.primary_location?.source?.display_name||'',citedBy:w.cited_by_count,openalex:safeURL(w.id),related:(w.related_works||[]).map(safeURL).filter(Boolean),versions:[...new Map(locations.map(l=>{const url=safeURL(l.pdf_url)||safeURL(l.landing_page_url);return [url,{url,label:l.source?.display_name||'Paper version'}];})).values()].filter(x=>x.url)};
      paper.rank=score+(year&&String(w.publication_year)===year?0.08:0);
      return paper;
    }).filter(w=>w.score>=.62).sort((a,b)=>b.rank-a.rank).slice(0,2);
  })();
  cache.set(key,pending);if(cache.size>200)cache.delete(cache.keys().next().value);
  try{return await pending;}catch(e){cache.delete(key);throw e;}
}

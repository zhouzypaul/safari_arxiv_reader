const api = globalThis.browser || globalThis.chrome;
// Safari's native PDF documents can skip declarative content scripts. Inject
// after navigation completes, using only website access already granted.
api.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !tab.url) return;
  let url;
  try { url = new URL(tab.url); } catch { return; }
  if (url.protocol !== 'https:' ||
      !(url.hostname === 'arxiv.org' || url.hostname.endsWith('.arxiv.org')) ||
      !url.pathname.startsWith('/pdf/')) return;
  try {
    if (!await api.permissions.contains({origins:[`${url.origin}/*`]})) return;
    await api.scripting.executeScript({target:{tabId},files:['content.js']});
  } catch (error) {
    console.debug('ArxivPDFReader: automatic PDF enhancement unavailable', error.message);
  }
});

// A narrow public-metadata transport for the embedded Safari reader, never a
// general-purpose proxy. Cookies and authorization headers are not forwarded.
api.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type!=='papertrail-metadata')return;
  if(sender.id&&sender.id!==api.runtime.id)return;
  return (async()=>{
    try{
      const url=new URL(message.url);
      const allowed=url.protocol==='https:' && !url.username && !url.password && (
        (url.hostname==='arxiv.org' && /^\/abs\/(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)$/.test(url.pathname)) ||
        (url.hostname==='api.openalex.org' && /^\/works(?:\/|$)/.test(url.pathname)));
      if(!allowed)throw Error('Unsupported metadata endpoint.');
      const response=await fetch(url.href,{credentials:'omit',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`Metadata service returned ${response.status}.`);
      const text=await response.text();if(text.length>3000000)throw Error('Metadata response is too large.');
      return {text};
    }catch(error){return {error:error.message};}
  })();
});

// Use an ordinary Safari navigation: Google may reject native and extension
// fetches even when the same URL is accessible in the user's browser session.
// Keep at most one temporary lookup tab alive and never take focus from the PDF.
const scholarPending=new Map();let scholarQueue=Promise.resolve();
async function readScholarTab(){
  // A completed navigation can precede the results DOM in Safari. Observe only
  // this short lookup window, then release the observer and timer.
  const ready=()=>document.querySelector('#gs_res_ccl_mid .gs_r,#gs_captcha_f,[action*="/sorry/"]')||document.querySelector('#gs_res_ccl_mid')?.textContent.trim()||location.pathname.startsWith('/sorry/');
  if(!ready())await new Promise(resolve=>{
    const observer=new MutationObserver(()=>{if(ready())finish();});
    const timer=setTimeout(finish,4000);
    function finish(){observer.disconnect();clearTimeout(timer);resolve();}
    observer.observe(document.documentElement,{childList:true,subtree:true});
    if(ready())finish();
  });
  if(document.querySelector('#gs_captcha_f,[action*="/sorry/"]')||location.pathname.startsWith('/sorry/'))return {error:'Google Scholar requires verification. Open Scholar to complete it.',blocked:true};
  const results=document.querySelector('#gs_res_ccl_mid');
  if(!results)return {error:'Google Scholar did not provide readable search results.',blocked:/403|Forbidden|unusual traffic/i.test(document.title+' '+document.body?.innerText.slice(0,1000))};
  // Send only search results, excluding account navigation and profile details.
  const html=results.innerHTML;
  return html.length<=2000000?{html}:{error:'Google Scholar response is too large.'};
}
function sameScholarSearch(actual,expected){
  try{const url=new URL(actual);return url.origin===expected.origin&&url.pathname===expected.pathname&&url.searchParams.get('q')===expected.searchParams.get('q')&&(!url.hash||url.hash===expected.hash);}catch{return false;}
}
async function lookupScholarTab(title){
  const url=new URL('https://scholar.google.com/scholar');
  url.searchParams.set('hl','en');url.searchParams.set('q','"'+title+'"');
  url.hash='papertrail-lookup='+crypto.randomUUID();
  let tabId,timer,reading=false,finished=false;
  let finish;
  const result=new Promise(resolve=>{finish=value=>{if(!finished){finished=true;resolve(value);}};});
  async function inspect(tab){
    if(finished||reading||tab.id!==tabId)return;
    if(!tab.url||tab.url==='about:blank')return;
    const actual=new URL(tab.url);
    if(actual.origin===url.origin&&actual.pathname.startsWith('/sorry/')){finish({error:'Google Scholar requires verification. Open Scholar to complete it.',blocked:true});return;}
    if(!sameScholarSearch(tab.url,url)){finish({error:'Scholar lookup was interrupted or redirected.'});return;}
    if(tab.status!=='complete')return;
    reading=true;
    try{
      const values=await api.scripting.executeScript({target:{tabId},func:readScholarTab});
      finish(values?.[0]?.result||{error:'Google Scholar returned no readable response.'});
    }catch(error){finish({error:error.message});}
  }
  const updated=(id,change,tab)=>{if(id===tabId)inspect({...tab,id,status:change.status||tab.status});};
  const removed=id=>{if(id===tabId)finish({error:'Scholar lookup tab was closed.'});};
  api.tabs.onUpdated.addListener(updated);api.tabs.onRemoved.addListener(removed);
  try{
    timer=setTimeout(()=>finish({error:'Google Scholar lookup timed out.'}),20000);
    const tab=await api.tabs.create({url:url.href,active:false});tabId=tab.id;
    inspect(await api.tabs.get(tabId));
    return await result;
  }finally{
    clearTimeout(timer);api.tabs.onUpdated.removeListener(updated);api.tabs.onRemoved.removeListener(removed);
    // If the user selected/navigated the tab, leave their tab alone.
    if(tabId!==undefined)try{const tab=await api.tabs.get(tabId);if(!tab.active&&sameScholarSearch(tab.url,url))await api.tabs.remove(tabId);}catch{}
  }
}
api.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type!=='papertrail-scholar')return;
  if(sender.id&&sender.id!==api.runtime.id)return;
  return (async()=>{
    if(typeof message.title!=='string'||message.title.trim().length<3||message.title.length>1000)return {error:'Paper title is unavailable.'};
    if(!await api.permissions.contains({origins:['https://scholar.google.com/*']}))return {error:'Allow ArxivPDFReader access to scholar.google.com in Safari to retrieve citation counts.',permissionRequired:true};
    const title=message.title.trim();
    if(scholarPending.has(title))return scholarPending.get(title);
    const work=scholarQueue.then(()=>lookupScholarTab(title)).catch(error=>({error:error.message}));
    scholarPending.set(title,work);scholarQueue=work.then(()=>{});
    try{return await work;}finally{scholarPending.delete(title);}
  })();
});

export const SCHOLAR_COUNTS='papertrail-scholar-counts';
export function scholarKey(title){return (title||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function scholarURL(title,token){
  const url=new URL('https://scholar.google.com/scholar');
  url.searchParams.set('hl','en');url.searchParams.set('q','"'+title+'"');
  if(token)url.hash='papertrail='+encodeURIComponent(token);
  return url.href;
}
export function validScholarCount(value,key){
  if(!value||value.key!==key||!Number.isSafeInteger(value.count)||value.count<0||!Number.isFinite(value.checkedAt)||typeof value.title!=='string')return false;
  try{const url=new URL(value.url);return url.origin==='https://scholar.google.com'&&url.pathname==='/scholar'&&/^\d+$/.test(url.searchParams.get('cites')||'');}catch{return false;}
}

// Detached HTML parsing never inserts Scholar markup into the reader.
export function parseScholarCount(html,title,now=Date.now()){
  const key=scholarKey(title),page=new DOMParser().parseFromString(html,'text/html');
  if(page.querySelector('#gs_captcha_f,[action*="/sorry/"]'))throw Object.assign(Error('Google Scholar requires verification.'),{blocked:true});
  // Choose the first exact-title match in Scholar's ranking, not simply the
  // first search result. Never combine counts from duplicate versions.
  const card=[...page.querySelectorAll('.gs_r')].find(card=>{
    const heading=card.querySelector('.gs_rt');
    const text=heading?.querySelector('a')?.textContent||heading?.textContent?.replace(/^\s*\[(?:PDF|HTML|BOOK|CITATION)\]\s*/i,'');
    return scholarKey(text)===key;
  });
  if(!card)throw Object.assign(Error('No exact title match was found on Google Scholar.'),{kind:'not-found'});
  const counts=[];
  for(const link of card.querySelectorAll('a')){
    const text=link.textContent.trim();
    if(!/^Cited by\s+(?:\d+|\d{1,3}(?:,\d{3})+)$/i.test(text))continue;
    const value={key,title,count:Number(text.replace(/[^0-9]/g,'')),url:new URL(link.getAttribute('href'), 'https://scholar.google.com').href,checkedAt:now};
    if(validScholarCount(value,key))counts.push(value);
  }
  if(counts.length!==1)throw Object.assign(Error('Google Scholar lists this paper without a readable citation count.'),{kind:'no-count'});
  return counts[0];
}
export async function requestScholarCount(title){
  const api=globalThis.browser||globalThis.chrome;
  if(!api?.runtime?.sendMessage)throw Error('Google Scholar lookup requires the Safari extension.');
  const result=await api.runtime.sendMessage({type:'papertrail-scholar',title});
  if(result?.error)throw Object.assign(Error(result.error),{blocked:result.blocked===true,permissionRequired:result.permissionRequired===true,kind:result.kind});
  if(typeof result?.html!=='string')throw Error('Google Scholar returned no readable response.');
  return parseScholarCount(result.html,title);
}
function scholarAttempts(state){
  if(state.version===2)return {...state};
  // Old builds cached every transient error for an hour and blocks for a day.
  // Discard obsolete transient failures; preserve a bounded challenge cooldown.
  return {version:2,blockedUntil:Math.max(0,(state.blockedUntil||0)-86400000+1800000)};
}
export function createScholarLookup(storage,request=requestScholarCount,now=Date.now){
  const pending=new Map();
  return async title=>{
    const key=scholarKey(title);
    if(!key)throw Error('Paper title is unavailable.');
    if(pending.has(key))return pending.get(key);
    const work=(async()=>{
      const counts=await storage.get(SCHOLAR_COUNTS,{}),saved=counts[key];
      const valid=validScholarCount(saved,key);
      if(valid&&now()-saved.checkedAt<7*86400000)return {value:saved};
      const state=scholarAttempts(await storage.get('papertrail-scholar-tab-attempts',{}));
      const failure=state[key];
      const blocked=state.blockedUntil>now();
      if(blocked||failure?.until>now())return {value:valid?saved:null,error:blocked?'Google Scholar requires verification or is temporarily limiting access. Use More → Google Scholar to check.':failure.error,kind:blocked?'blocked':failure.kind,retryAt:blocked?state.blockedUntil:failure.until};
      try{
        const value=await request(title);
        if(!validScholarCount(value,key))throw Error('Google Scholar returned an invalid count.');
        const latest=await storage.get(SCHOLAR_COUNTS,{});latest[key]=value;
        await storage.set(SCHOLAR_COUNTS,Object.fromEntries(Object.entries(latest).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,200)));
        const attempts=scholarAttempts(await storage.get('papertrail-scholar-tab-attempts',{}));delete attempts[key];attempts.blockedUntil=0;attempts.version=2;await storage.set('papertrail-scholar-tab-attempts',attempts);
        return {value};
      }catch(error){
        if(error.permissionRequired)return {value:valid?saved:null,error:error.message,kind:'permission'};
        const latest=scholarAttempts(await storage.get('papertrail-scholar-tab-attempts',{}));
        const failures=Object.fromEntries(Object.entries(latest).filter(([k,v])=>k!=='blockedUntil'&&v?.until>now()).slice(-199));
        const kind=error.blocked?'blocked':error.kind||'temporary';
        const tries=latest.version===2?(latest[key]?.tries||0)+1:1;
        const delay=kind==='blocked'?1800000:['not-found','no-count'].includes(kind)?6*3600000:Math.min(300000,30000*2**Math.min(tries-1,4));
        const retryAt=now()+delay;
        failures[key]={until:retryAt,error:error.message,kind,tries};
        failures.blockedUntil=error.blocked?retryAt:latest.blockedUntil||0;failures.version=2;
        await storage.set('papertrail-scholar-tab-attempts',failures);
        return {value:valid?saved:null,error:error.message,kind,retryAt};
      }
    })();
    pending.set(key,work);
    try{return await work;}finally{pending.delete(key);}
  };
}

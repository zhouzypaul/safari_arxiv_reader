// Read only the result page the user explicitly opened from ArxivPDFReader.
// No background requests, pagination, automatic selection, or CAPTCHA handling.
(async()=>{
  if(globalThis.__papertrailScholar)return;
  const url=new URL(location.href),token=new URLSearchParams(url.hash.slice(1)).get('papertrail');
  if(url.origin!=='https://scholar.google.com'||url.pathname!=='/scholar'||!token||!/^[-\w]{10,80}$/.test(token))return;
  const api=globalThis.browser||globalThis.chrome;if(!api?.storage)return;
  const pendingKey='papertrail-scholar-pending-'+token;
  const pending=(await api.storage.local.get(pendingKey))[pendingKey];
  if(!pending||typeof pending.title!=='string'||Date.now()-pending.createdAt>30*60*1000||url.searchParams.get('q')!=='"'+pending.title+'"')return;
  globalThis.__papertrailScholar=true;
  const panel=document.createElement('section');panel.id='papertrail-scholar-panel';
  Object.assign(panel.style,{background:'#eaf2f8',color:'#243b4d',padding:'14px 24px',borderBottom:'1px solid #cbd9e4',font:'14px/1.5 system-ui'});
  const heading=document.createElement('strong');heading.textContent='ArxivPDFReader · '+pending.title;
  const note=document.createElement('div');note.textContent='Choose “Use citation count” under the correct result. The count will appear in your PDF reader; return to that tab when finished.';
  panel.append(heading,note);document.body.prepend(panel);
  let added=0;
  for(const card of document.querySelectorAll('.gs_r')){
    const title=(card.querySelector('.gs_rt a')||card.querySelector('.gs_rt'))?.textContent?.trim();
    if(!title)continue;
    const citation=Array.from(card.querySelectorAll('a[href]')).find(a=>{
      try{const target=new URL(a.href);return target.origin==='https://scholar.google.com'&&target.pathname==='/scholar'&&/^\d+$/.test(target.searchParams.get('cites')||'')&&/^Cited by\s+[\d,]+\s*$/i.test(a.textContent.trim());}catch{return false;}
    });
    if(!citation)continue;
    const count=Number(citation.textContent.trim().replace(/^Cited by\s+/i,'').replaceAll(',',''));
    if(!Number.isSafeInteger(count)||count<0)continue;
    const button=document.createElement('button');button.type='button';button.className='papertrail-use-citations';
    button.textContent='Use citation count: '+count.toLocaleString();button.title='Use Google Scholar’s count for '+title;
    Object.assign(button.style,{margin:'6px 0',padding:'5px 9px',color:'#142d3f',background:'#73A4C6',border:'0',borderRadius:'4px',cursor:'pointer'});
    button.onclick=async()=>{
      button.disabled=true;
      try{
        const cache=(await api.storage.local.get('papertrail-scholar-counts'))['papertrail-scholar-counts']||{};
        const value={key:pending.key,title,count,url:citation.href,checkedAt:Date.now()};
        const entries=Object.entries(cache).filter(([key])=>key!==pending.key).sort((a,b)=>(b[1].checkedAt||0)-(a[1].checkedAt||0)).slice(0,199);
        const attempts=(await api.storage.local.get('papertrail-scholar-tab-attempts'))['papertrail-scholar-tab-attempts']||{};delete attempts[pending.key];attempts.blockedUntil=0;
        await api.storage.local.set({'papertrail-scholar-tab-attempts':attempts,'papertrail-scholar-counts':Object.fromEntries([[pending.key,value],...entries])});
        await api.storage.local.remove(pendingKey);
        note.textContent='Saved '+count.toLocaleString()+' citations for “'+title+'”. Return to your PDF tab to see the count.';
        for(const b of document.querySelectorAll('.papertrail-use-citations'))b.disabled=true;
        button.textContent='Citation count saved';
      }catch{button.disabled=false;note.textContent='Could not save the count. Try again.';}
    };
    (card.querySelector('.gs_ri')||card).append(button);added++;
  }
  if(!added)note.textContent='No readable “Cited by” count found. Check the result or any Google access prompt yourself. No count has been imported; absence of a count does not mean zero.';
})().catch(()=>{});

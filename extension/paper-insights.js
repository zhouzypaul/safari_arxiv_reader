export function paperText(pageRows) {
  return pageRows.map(rows=>rows.map(r=>r.text).join('\n')).join('\n\n').trim();
}

export function pangramResult(data) {
  const values=['fraction_ai','fraction_ai_assisted','fraction_human'].map(k=>data[k]);
  if(values.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||Math.abs(values.reduce((a,b)=>a+b,0)-1)>.03)
    throw Error('Pangram returned an incomplete result. No percentages are shown.');
  return {ai:values[0],assisted:values[1],human:values[2],label:typeof data.prediction_short==='string'?data.prediction_short:'Analysis complete'};
}

export async function pangramRequest(path,key,body,{signal,fetcher=fetch}={}) {
  signal?.throwIfAborted();
  const api=globalThis.browser||globalThis.chrome;
  if(api?.runtime?.sendNativeMessage&&fetcher===fetch){
    const result=await api.runtime.sendNativeMessage('dev.papertrail.reader',{type:'papertrail-pangram',path,key,body});
    signal?.throwIfAborted();
    if(result?.error)throw Error(result.error);
    if(!result?.data)throw Error('Pangram bridge did not respond. Reload the updated extension.');
    return result.data;
  }
  return pangramFetch(path,key,body,{signal,fetcher});
}

export async function pangramFetch(path,key,body,{signal,fetcher=fetch}={}) {
  if(!/^\/(?:models|task(?:\/[A-Za-z0-9_-]+)?)$/.test(path))throw Error('Unsupported Pangram endpoint.');
  if(typeof key!=='string'||!key.trim()||key.length>4096||/[\r\n]/.test(key))throw Error('Enter a valid Pangram API key.');
  if(body!==undefined&&(path!=='/task'||typeof body.text!=='string'||!body.text.trim()||body.text.length>500000||typeof body.model!=='string'||!body.model))throw Error('Invalid Pangram submission (maximum 500,000 characters).');
  const response=await fetcher('https://text.external-api.pangram.com'+path,{
    method:body===undefined?'GET':'POST',credentials:'omit',redirect:'error',
    headers:{'Content-Type':'application/json','x-api-key':key.trim()},
    body:body===undefined?undefined:JSON.stringify({text:body.text,model:body.model,public_dashboard_link:false}),
    signal:signal||AbortSignal.timeout(30000)
  });
  if(!response.ok){
    const messages={401:'The Pangram API key was rejected.',402:'Your Pangram account needs API credits.',403:'This Pangram key cannot access the selected model or task.',429:'Pangram is busy or rate-limited. Try again shortly.',422:'Pangram could not analyze this text or model.'};
    throw Error(messages[response.status]||`Pangram returned ${response.status}. Try again later.`);
  }
  return response.json();
}

export async function waitForPangram(taskId,key,{signal,request=pangramRequest,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=100}={}) {
  for(let n=0;n<attempts;n++){
    signal?.throwIfAborted();
    const data=await request('/task/'+taskId,key,undefined,{signal});
    if(data.stage==='STAGE_SUCCESS')return pangramResult(data);
    if(data.stage==='STAGE_FAILED')throw Error('Pangram could not analyze this document. Try checking the extracted text on Pangram.');
    await delay(Math.min(1000+n*500,5000));
  }
  throw Error('Pangram is still processing. Use Check result to resume without submitting again.');
}

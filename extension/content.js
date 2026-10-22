// Replace only the displayed PDF surface. Keep the tab and its original URL.
(() => {
  const api=globalThis.browser||globalThis.chrome;
  if(window!==window.top || !api?.runtime)return {mounted:false,reason:'Not a top-level extension page'};
  const isPDF=document.contentType.toLowerCase()==='application/pdf'||!!document.querySelector('embed[type="application/pdf"],object[type="application/pdf"]');
  if(!isPDF)return {mounted:false,reason:'Open a PDF first.'};
  if(document.getElementById('papertrail-reader-frame'))return {mounted:true};
  const originalURL=location.href;
  const originalBody=document.body;const originalStyle=document.documentElement.style.cssText;
  const frame=document.createElement('iframe');
  frame.id='papertrail-reader-frame';frame.title='safari_arxiv_reader PDF reader';
  const reader=new URL(api.runtime.getURL('reader.html'));
  reader.searchParams.set('url',originalURL);reader.searchParams.set('embedded','1');
  frame.src=reader.href;
  frame.addEventListener('load',()=>frame.focus());
  Object.assign(frame.style,{position:'fixed',inset:'0',width:'100%',height:'100%',border:'0',zIndex:'2147483647',background:'#eaf0f5'});
  const mount=()=>{
    if(document.getElementById(frame.id))return;
    document.documentElement.style.cssText='height:100%;width:100%;overflow:hidden;';
    const body=document.createElement('body');body.style.cssText='margin:0;height:100%;overflow:hidden;';body.append(frame);
    if(document.body)document.body.replaceWith(body);else document.documentElement.append(body);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  // Only accept navigation metadata from our own embedded extension page.
  const origin=reader.origin;
  const send=data=>frame.contentWindow?.postMessage(data,origin);
  document.addEventListener('keydown',event=>{
    if(!frame.isConnected||!(event.metaKey||event.ctrlKey)||event.altKey)return;
    const command=['+','='].includes(event.key)?'in':event.key==='-'?'out':event.key==='0'?'reset':null;
    if(command){event.preventDefault();event.stopPropagation();send({type:'papertrail-zoom',command});}
    if(event.key.toLowerCase()==='f'){event.preventDefault();send({type:'papertrail-search'});}
  },true);
  let gestureScale=1,gesturing=false;
  const updateGesture=event=>{const next=Number(event.scale);if(!Number.isFinite(next)||next<=0)return;const ratio=next/gestureScale;gestureScale=next;if(ratio!==1)send({type:'papertrail-zoom',command:'multiply',value:ratio,anchor:{x:event.clientX,y:event.clientY}});};
  document.addEventListener('gesturestart',event=>{event.preventDefault();gestureScale=1;gesturing=true;send({type:'papertrail-gesture',phase:'start'});},{passive:false});
  document.addEventListener('gesturechange',event=>{event.preventDefault();updateGesture(event);},{passive:false});
  document.addEventListener('gestureend',event=>{event.preventDefault();updateGesture(event);gesturing=false;send({type:'papertrail-gesture',phase:'end'});},{passive:false});
  document.addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();if(!gesturing){const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?800:1);send({type:'papertrail-zoom',command:'multiply',value:Math.exp(-delta*.005),anchor:{x:event.clientX,y:event.clientY}});}}},{passive:false});
  window.addEventListener('blur',()=>{if(gesturing){gesturing=false;send({type:'papertrail-gesture',phase:'end'});}});
  window.addEventListener('popstate',()=>{const page=Number(new URLSearchParams(location.hash.slice(1)).get('page'));send({type:'papertrail-go-page',page:page||1});});

  window.addEventListener('message',event=>{
    if(event.source!==frame.contentWindow||event.origin!==origin)return;
    if(event.data?.type==='papertrail-original'){if(originalBody&&document.body!==originalBody){document.body.replaceWith(originalBody);document.documentElement.style.cssText=originalStyle;}return;}
    if(event.data?.type==='papertrail-navigate'){
      try{const target=new URL(event.data.url);if(/^https?:$/.test(target.protocol))location.assign(target.href);}catch{}
      return;
    }
    if(event.data?.type!=='papertrail-position')return;
    const page=Number(event.data.page);
    if(!Number.isInteger(page)||page<1||page>100000)return;
    const url=new URL(location.href);url.hash=`page=${page}`;if(location.hash!==url.hash)history.pushState(null,'',url.href);
  });
  return {mounted:true};
})();

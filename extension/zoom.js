export const clampScale=value=>Math.min(5,Math.max(.25,Number(value)||1));
export function zoomCommand(event){
  if(!(event.metaKey||event.ctrlKey)||event.altKey)return null;
  if(event.key==='+'||event.key==='='||event.code==='NumpadAdd')return 'in';
  if(event.key==='-'||event.code==='NumpadSubtract')return 'out';
  if(event.key==='0'||event.code==='Numpad0')return 'reset';
  return null;
}
export function installPDFZoom(target,change,search,lifecycle={}){
  target.addEventListener('keydown',event=>{
    const command=zoomCommand(event);
    if(command){event.preventDefault();event.stopPropagation();change(command);}
    else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'&&search){event.preventDefault();search();}
  },true);
  let gestureScale=1,gesturing=false;
  const anchor=e=>({x:e.clientX,y:e.clientY});
  const updateGesture=event=>{
    const next=Number(event.scale);if(!Number.isFinite(next)||next<=0)return;
    const ratio=next/gestureScale;gestureScale=next;if(ratio!==1)change('multiply',ratio,anchor(event));
  };
  target.addEventListener('gesturestart',event=>{event.preventDefault();gesturing=true;gestureScale=1;lifecycle.start?.();}, {passive:false});
  target.addEventListener('gesturechange',event=>{event.preventDefault();updateGesture(event);}, {passive:false});
  target.addEventListener('gestureend',event=>{event.preventDefault();updateGesture(event);gesturing=false;lifecycle.end?.();}, {passive:false});
  target.defaultView?.addEventListener('blur',()=>{if(gesturing){gesturing=false;lifecycle.end?.();}});
  target.addEventListener('wheel',event=>{if(event.ctrlKey){event.preventDefault();if(!gesturing){const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?800:1);change('multiply',Math.exp(-delta*.005),anchor(event));}}}, {passive:false});
}

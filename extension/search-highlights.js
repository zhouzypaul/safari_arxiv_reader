// Find exact character ranges without rewriting selectable PDF text or link nodes.
export function textMatches(layer,query){
  const q=query.trim();if(!q)return [];
  const entries=[];let text='';
  const spans=Array.from(layer.querySelectorAll(':scope > span, :scope > .markedContent span')).filter(s=>!s.closest('.citation'));
  for(const span of spans){
    if(text&&!/\s$/.test(text))text+=' ';
    const walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){const start=text.length;text+=node.data;entries.push({node,start,end:text.length});}
  }
  const matches=[];const pattern=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  for(const match of text.matchAll(pattern)){
    const at=match.index,end=at+match[0].length;const first=entries.find(e=>e.end>at),last=entries.find(e=>e.end>=end);
    if(first&&last){const range=document.createRange();range.setStart(first.node,Math.max(0,at-first.start));range.setEnd(last.node,end-last.start);matches.push(range);}
  }
  return matches;
}
export function paintSearchHighlights(pageNode,query){
  pageNode.querySelectorAll('.search-mark').forEach(n=>n.remove());
  const layer=pageNode.querySelector('.page-surface:not(.rendering-surface) .textLayer');if(!layer)return;
  const box=pageNode.getBoundingClientRect();const fragment=document.createDocumentFragment();
  for(const range of textMatches(layer,query))for(const rect of range.getClientRects()){
    if(rect.width<=0||rect.height<=0)continue;
    const mark=document.createElement('div');mark.className='search-mark';mark.setAttribute('aria-hidden','true');
    Object.assign(mark.style,{left:rect.left-box.left+'px',top:rect.top-box.top+'px',width:rect.width+'px',height:rect.height+'px'});fragment.append(mark);
  }
  pageNode.append(fragment);
}

import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
function environment(url='https://arxiv.org/pdf/1706.03762',contentType='application/pdf'){
 const nodes=new Map(),messages={},navigations=[],history=[];
 const node=tag=>({tag,style:{},addEventListener(){},focus(){},append(child){nodes.set(child.id,child);},replaceWith(replacement){document.body=replacement;},contentWindow:{}});
 const document={addEventListener:(type,fn)=>{messages[type]=fn;},querySelector:()=>null,contentType,readyState:'complete',documentElement:node('html'),body:node('body'),createElement:node,getElementById:id=>nodes.get(id)};
 const location=Object.assign(new URL(url),{assign:u=>navigations.push(u)});
 const window={addEventListener:(type,fn)=>{messages[type]=fn;}};window.top=window;
 const context=vm.createContext({document,location,window,URL,history:{pushState:(a,b,u)=>history.push(u)},browser:{runtime:{getURL:p=>'https://extension.test/'+p}}});
 return {context,document,nodes,messages,window,navigations,history,location};
}
test('in-page mount preserves PDF URL and replaces the native body once',()=>{const e=environment(),body=e.document.body;assert.equal(vm.runInContext(script,e.context).mounted,true);assert.equal(e.location.href,'https://arxiv.org/pdf/1706.03762');assert.notEqual(e.document.body,body);const frame=e.nodes.get('papertrail-reader-frame');assert.equal(new URL(frame.src).searchParams.get('url'),e.location.href);assert.equal(new URL(frame.src).searchParams.get('embedded'),'1');vm.runInContext(script,e.context);assert.equal(e.nodes.size,1);});
test('non-PDF pages are left intact',()=>{const e=environment('https://arxiv.org/abs/1706.03762','text/html');const body=e.document.body;assert.equal(vm.runInContext(script,e.context).mounted,false);assert.equal(e.document.body,body);});
test('in-page navigation accepts only the reader frame and safe URLs',()=>{const e=environment();vm.runInContext(script,e.context);const source=e.nodes.get('papertrail-reader-frame').contentWindow;
 e.messages.message({source:{},origin:'https://extension.test',data:{type:'papertrail-navigate',url:'https://evil.example'}});assert.equal(e.navigations.length,0);
 e.messages.message({source,origin:'https://evil.example',data:{type:'papertrail-navigate',url:'https://evil.example'}});assert.equal(e.navigations.length,0);
 e.messages.message({source,origin:'https://extension.test',data:{type:'papertrail-navigate',url:'javascript:alert(1)'}});assert.equal(e.navigations.length,0);
 e.messages.message({source,origin:'https://extension.test',data:{type:'papertrail-navigate',url:'https://arxiv.org/pdf/1234.56789'}});assert.equal(e.navigations[0],'https://arxiv.org/pdf/1234.56789');
 e.messages.message({source,origin:'https://extension.test',data:{type:'papertrail-position',page:3}});assert.equal(e.history[0],'https://arxiv.org/pdf/1706.03762#page=3');
});

test('HTML access challenges at a PDF URL are left intact',()=>{const e=environment('https://arxiv.org/pdf/1706.03762','text/html');const body=e.document.body;assert.equal(vm.runInContext(script,e.context).mounted,false);assert.equal(e.document.body,body);});

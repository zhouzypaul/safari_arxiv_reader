import {pdfAccess, pdfPermission} from './permissions.js';
const api = globalThis.browser || globalThis.chrome;
const current = document.querySelector('#current');
const status = document.querySelector('#status');
let currentURL,currentTabId;
current.disabled = true;
status.textContent = 'Checking this tab…';
document.querySelector('#empty').onclick = () => api.tabs.create({url:api.runtime.getURL('reader.html')});
// Resolve the tab BEFORE enabling the button so the click can request access
// immediately, without an asynchronous operation consuming Safari's gesture.
api.tabs.query({active:true,currentWindow:true}).then(([tab]) => {
  pdfPermission(tab?.url);
  currentURL=tab.url;currentTabId=tab.id;
  current.disabled=false;
  status.textContent='Enhance this PDF in place · v0.3.14';
}).catch(e => { status.textContent=e.message; });
current.onclick = async () => {
  if (!currentURL || current.disabled) return;
  try {
    const permission=pdfAccess(api,currentURL,true);
    current.disabled=true;
    const granted=await permission;
    if (!granted) throw new Error('Website access is needed to load this PDF. Click Read this PDF to try again.');
    const results=await api.scripting.executeScript({target:{tabId:currentTabId},files:['content.js']});
    if(!results?.some(r=>r.result?.mounted))throw new Error('Safari could not enhance this PDF in place. Reload the PDF and try again.');
    window.close();
  } catch(e) { status.textContent=e.message; }
  finally { current.disabled=false; }
};

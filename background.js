
// SideFlow background — applies side panel mapping on tab changes
// Keys
const KEY_GLOBAL = 'sf:globalUrl';
const TAB_PREFIX = 'sf:tab:'; // session key per tab

async function getTabUrl(tabId){
  try{
    const s = await chrome.storage.session.get(TAB_PREFIX+tabId);
    if(s && s[TAB_PREFIX+tabId]) return s[TAB_PREFIX+tabId];
  }catch{}
  try{
    const l = await chrome.storage.local.get(KEY_GLOBAL);
    if(l && l[KEY_GLOBAL]) return l[KEY_GLOBAL];
  }catch{}
  return null;
}

async function applyToTab(tabId){
  if(!tabId) return;
  const url = await getTabUrl(tabId);
  try{
    if(url){
      await chrome.sidePanel.setOptions({tabId, path:url, enabled:true});
    }else{
      // Disable on tabs without mapping
      await chrome.sidePanel.setOptions({tabId, path:'fallback.html', enabled:false});
    }
  }catch(e){
    // Ignore
  }
}

chrome.tabs.onActivated.addListener(async ({tabId})=>{
  await applyToTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab)=>{
  if(info.status === 'complete'){
    await applyToTab(tabId);
  }
});

// Cleanup session map on tab removal
chrome.tabs.onRemoved.addListener(async (tabId)=>{
  try{ await chrome.storage.session.remove(TAB_PREFIX+tabId); }catch{}
});

// Expose a simple query for current window's sideflows
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async ()=>{
    if(msg?.type === 'SF_LIST_WINDOW'){
      const tabs = await chrome.tabs.query({currentWindow:true});
      const keys = tabs.map(t=> TAB_PREFIX + t.id);
      const map = await chrome.storage.session.get(keys);
      const rows = tabs
        .filter(t=> map[TAB_PREFIX+t.id])
        .map(t=> ({tabId:t.id, title:t.title, url:map[TAB_PREFIX+t.id]}));
      sendResponse({ok:true, rows});
      return;
    }
  })();
  return true;
});

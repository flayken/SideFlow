// SideFlow background worker
const GLOBAL_KEYS = { keep:'sf:globalKeep', url:'sf:globalUrl' };
const PT_KEY = 'sf:perTabMap';
const FOLLOW_KEY = 'sf:followState';

let LAST_GLOBAL_URL = null;

async function getGlobal(){ const r = await chrome.storage.local.get([GLOBAL_KEYS.keep, GLOBAL_KEYS.url]); return { keep: !!r[GLOBAL_KEYS.keep], url: r[GLOBAL_KEYS.url] || null }; }
async function setGlobal(keep, url){ const obj={}; if(typeof keep==='boolean') obj[GLOBAL_KEYS.keep]=keep; if(typeof url==='string' || url===null) obj[GLOBAL_KEYS.url]=url; await chrome.storage.local.set(obj); }
async function getPerTabMap(){ try{ const r=await chrome.storage.session.get(PT_KEY); return r[PT_KEY]||{}; }catch{ const r2=await chrome.storage.local.get(PT_KEY); return r2[PT_KEY]||{}; } }
async function setPerTabMap(map){ try{ await chrome.storage.session.set({ [PT_KEY]: map }); }catch{ await chrome.storage.local.set({ [PT_KEY]: map }); } }
async function setPerTab(tabId, url){ const map=await getPerTabMap(); map[String(tabId)]={ url, keep:true }; await setPerTabMap(map); }
async function unlinkTab(tabId){ const map=await getPerTabMap(); const had=!!map[String(tabId)]; delete map[String(tabId)]; await setPerTabMap(map); return had; }
async function getPerTab(tabId){ const map=await getPerTabMap(); return map[String(tabId)]||null; }

async function getFollow(){
  try{
    const r = await chrome.storage.session.get(FOLLOW_KEY);
    return r[FOLLOW_KEY] || { on:false, url:null, lastTabId:null, prev:{} };
  }catch{
    const r2 = await chrome.storage.local.get(FOLLOW_KEY);
    return r2[FOLLOW_KEY] || { on:false, url:null, lastTabId:null, prev:{} };
  }
}
async function setFollow(state){
  try{ await chrome.storage.session.set({ [FOLLOW_KEY]: state }); }
  catch{ await chrome.storage.local.set({ [FOLLOW_KEY]: state }); }
}

async function activeTabId(){
  try{
    const [t] = await chrome.tabs.query({ active:true, lastFocusedWindow:true });
    return t?.id || null;
  }catch{
    return null;
  }
}

async function listLinkedTabs(windowId){
  const map = await getPerTabMap();
  const ids = Object.keys(map).map(id=>parseInt(id,10));
  if(!ids.length) return [];
  const tabs = await chrome.tabs.query(windowId ? {windowId} : {});
  const out = [];
  for(const t of tabs){
    if(ids.includes(t.id)){
      out.push({ id:t.id, windowId:t.windowId, title:t.title, url: map[String(t.id)].url, active: t.active, index: t.index, favIconUrl: t.favIconUrl || null });
    }
  }
  return out.sort((a,b)=> a.windowId===b.windowId ? a.index-b.index : a.windowId-b.windowId);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    if(msg?.type==='SP_SET_PER_TAB'){
      if(!msg.tabId || !msg.url) return void sendResponse({ ok:false, error:'Missing tabId/url' });
      await setPerTab(msg.tabId, msg.url);
      return void sendResponse({ ok:true });
    }
    if(msg?.type==='SP_SET_GLOBAL'){
      if(!msg.url) return void sendResponse({ ok:false, error:'Missing url' });
      await setGlobal(true, msg.url);
      LAST_GLOBAL_URL = msg.url;
      return void sendResponse({ ok:true });
    }
    if(msg?.type==='SP_FOCUS_GLOBAL'){
      try{
        const url = msg.url;
        if(!url) return void sendResponse({ ok:false, error:'Missing url' });
        const winId = sender?.tab?.windowId ?? (await chrome.windows.getCurrent())?.id;
        if(!winId) return void sendResponse({ ok:false, error:'No window' });
        await setGlobal(true, url);
        LAST_GLOBAL_URL = url;
        await setFollow({ on:false, url:null, lastTabId:null, prev:{} });
        await chrome.sidePanel.setOptions({ path:url, enabled:true });
        await chrome.sidePanel.open({ windowId: winId });
        return void sendResponse({ ok:true });
      }catch(e){
        return void sendResponse({ ok:false, error: e && e.message || String(e) });
      }
    }
    if(msg?.type==='SP_UNLINK_TAB'){
      if(!msg.tabId) return void sendResponse({ ok:false, error:'Missing tabId' });
      const had = await unlinkTab(msg.tabId);
      return void sendResponse({ ok:had, error: had? null : 'Tab not linked' });
    }
    if(msg?.type==='SP_CLEAR_GLOBAL_AND_CLOSE'){
      try{
        await setGlobal(false, null);
        LAST_GLOBAL_URL = null;
        try{ await chrome.sidePanel.setOptions({ enabled:false }); }catch{}
        const tabs = await chrome.tabs.query({});
        let closed = 0;
        for(const t of tabs){
          const per = await getPerTab(t.id);
          if(!per){
            try{ await chrome.sidePanel.setOptions({ tabId: t.id, enabled:false }); closed++; }catch{}
          }
        }
        return void sendResponse({ ok:true, closed });
      }catch(e){
        return void sendResponse({ ok:false, error: e && e.message || String(e) });
      }
    }
    if(msg?.type==='SP_GET_STATE'){
      const tabId = msg.tabId || (sender?.tab?.id);
      const [per, global] = await Promise.all([ tabId ? getPerTab(tabId) : null, getGlobal() ]);
      return void sendResponse({ ok:true, perTab: per, global });
    }
    if(msg?.type==='SP_LIST_LINKED_TABS'){
      const tabs = await listLinkedTabs(msg.windowId);
      return void sendResponse({ ok:true, tabs: tabs.map(t=>({ id:t.id, windowId:t.windowId, title:t.title, url:t.url, index:t.index, favicon: t.favIconUrl })) });
    }
    if(msg?.type==='SP_FOLLOW_START'){
      if(!msg.url){ return void sendResponse({ ok:false, error:'Missing url' }); }
      let tabId = sender?.tab?.id;
      if(!tabId) tabId = await activeTabId();
      if(!tabId) return void sendResponse({ ok:false, error:'No tab' });
      const f = await getFollow();
      f.on = true;
      f.url = msg.url;
      f.lastTabId = tabId;
      f.prev = {};
      const per = await getPerTab(tabId);
      f.prev[String(tabId)] = per ? { url: per.url } : null;
      await setFollow(f);
      return void sendResponse({ ok:true });
    }
    if(msg?.type==='SP_FOLLOW_STOP'){
      let tabId = sender?.tab?.id;
      if(!tabId) tabId = await activeTabId();
      if(!tabId) return void sendResponse({ ok:false, error:'No tab' });
      const f = await getFollow();
      const followUrl = f.url;
      for(const [idStr, prev] of Object.entries(f.prev||{})){
        const id = parseInt(idStr,10);
        if(id === tabId) continue;
        try{
          if(prev && prev.url){ await chrome.sidePanel.setOptions({ tabId:id, path:prev.url, enabled:true }); }
          else{ await chrome.sidePanel.setOptions({ tabId:id, enabled:false }); }
        }catch{}
      }
      await setPerTab(tabId, followUrl);
      await setFollow({ on:false, url:null, lastTabId:null, prev:{} });
      return void sendResponse({ ok:true });
    }
    if(msg?.type==='SP_FOLLOW_INFO'){
      let tabId = sender?.tab?.id;
      if(!tabId) tabId = await activeTabId();
      const f = await getFollow();
      const replacing = !!(f.prev && f.prev[String(tabId)]);
      return void sendResponse({ ok:true, follow: f, replacing });
    }
    if(msg?.type==='SP_FOLLOW_UPDATE_URL'){
      if(!msg.url) return void sendResponse({ ok:false, error:'Missing url' });
      const f = await getFollow();
      if(f.on){ f.url = msg.url; await setFollow(f); }
      return void sendResponse({ ok:true });
    }
    if(msg?.type==='SP_CLOSE_TAB_PANEL'){
      if(!msg.tabId) return void sendResponse({ ok:false, error:'Missing tabId' });
      try{
        await chrome.sidePanel.setOptions({ tabId: msg.tabId, enabled:false });
      }catch{}
      const had = await unlinkTab(msg.tabId);
      return void sendResponse({ ok: had });
    }
    if(msg?.type==='SP_GOTO_TAB'){
      if(!msg.tabId) return void sendResponse({ ok:false, error:'Missing tabId' });
      try{
        if(msg.windowId) await chrome.windows.update(msg.windowId, { focused:true });
        await chrome.tabs.update(msg.tabId, { active:true });
        return void sendResponse({ ok:true });
      }catch(e){ return void sendResponse({ ok:false, error: e && e.message || String(e) }); }
    }
    sendResponse({ ok:false, error:'Unknown message' });
  })();
  return true;
});

async function applyForActive(tabId, windowId){
  const g = await getGlobal();
  if(g?.url){
    if(LAST_GLOBAL_URL !== g.url){
      try{ await chrome.sidePanel.setOptions({ path:g.url, enabled:true }); LAST_GLOBAL_URL = g.url; }catch{}
    }
    try{ await chrome.sidePanel.open({ windowId }); }catch{}
    return;
  }else{
    LAST_GLOBAL_URL = null;
  }
  const f = await getFollow();
  if(f.on){
    if(f.lastTabId && f.lastTabId !== tabId){
      const prev = f.prev[String(f.lastTabId)];
      try{
        if(prev && prev.url){ await chrome.sidePanel.setOptions({ tabId:f.lastTabId, path:prev.url, enabled:true }); }
        else{ await chrome.sidePanel.setOptions({ tabId:f.lastTabId, enabled:false }); }
      }catch{}
    }
    if(!f.prev[String(tabId)]){
      const perExisting = await getPerTab(tabId);
      f.prev[String(tabId)] = perExisting ? { url: perExisting.url } : null;
    }
    try{ await chrome.sidePanel.setOptions({ tabId, path:f.url, enabled:true }); await chrome.sidePanel.open({ tabId }); }catch{}
    f.lastTabId = tabId;
    await setFollow(f);
    return;
  }
  const per = await getPerTab(tabId);
  if(per?.url){
    try{ await chrome.sidePanel.setOptions({ tabId, path: per.url, enabled:true }); await chrome.sidePanel.open({ tabId }); }catch{}
    return;
  }
  try{ await chrome.sidePanel.setOptions({ tabId, enabled:false }); }catch{}
}
chrome.tabs.onActivated.addListener(async ({ tabId, windowId })=>{ await applyForActive(tabId, windowId); });
chrome.windows.onFocusChanged.addListener(async (windowId)=>{
  if(windowId === chrome.windows.WINDOW_ID_NONE) return;
  try{ const [tab] = await chrome.tabs.query({active:true, windowId}); if(tab) await applyForActive(tab.id, windowId); }catch{}
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab)=>{
  if(changeInfo.status==='complete' && tab?.active){
    await applyForActive(tabId, tab.windowId);
  }
});
chrome.tabs.onRemoved.addListener(async (tabId)=>{
  await unlinkTab(tabId);
  const f = await getFollow();
  if(f.prev && f.prev[String(tabId)]){ delete f.prev[String(tabId)]; await setFollow(f); }
});

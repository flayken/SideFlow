// SideFlow popup logic (compact favorites, live per-tab list, theme fix)
const KEY_FAVS = 'sideflow.favorites';
const KEY_SCOPE = 'sideflow.scope'; // 'tab' | 'global'
const KEY_THEME = 'sideflow.theme';
const $ = (sel, root=document) => root.querySelector(sel);

// Theme toggle (default to dark)
(function(){
  const root = document.documentElement;
  const saved = localStorage.getItem(KEY_THEME) || 'dark';
  root.setAttribute('data-theme', saved);
  const sw = document.getElementById('theme-switch');
  if(saved==='light') sw?.setAttribute('aria-pressed','true');
  sw?.addEventListener('click', ()=>{
    const next = (root.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    sw?.setAttribute('aria-pressed', String(next==='light'));
    localStorage.setItem(KEY_THEME, next);
  });
})();

function normalize(s){
  s=(s||'').trim();
  if(!s) return null;
  const hasDot = /\./.test(s);
  if(/^https?:\/\//i.test(s) || hasDot){
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try{ return new URL(s).toString(); }catch{}
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}
function favIcon(u){ try{ const h=new URL(u).host; return 'https://www.google.com/s2/favicons?domain='+encodeURIComponent(h)+'&sz=64'; }catch{return ''; } }
function hostOf(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return u; } }
async function getActiveTab(){ const [t] = await chrome.tabs.query({active:true,currentWindow:true}); return t; }
async function loadFavs(){ const r = await chrome.storage.local.get(KEY_FAVS); return r[KEY_FAVS] || []; }
async function saveFavs(v){ await chrome.storage.local.set({ [KEY_FAVS]: v }); }
function toast(msg){ const wrap=document.querySelector('.toast-wrap'); const t=document.createElement('div'); t.className='toast'; t.textContent=msg; wrap.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(6px)'; },1600); setTimeout(()=> t.remove(), 2100); }

function setScope(val){
  localStorage.setItem(KEY_SCOPE, val);
  document.getElementById('scope-tab').setAttribute('aria-pressed', String(val!=='global'));
  document.getElementById('scope-global').setAttribute('aria-pressed', String(val==='global'));
}
function getScope(){ return localStorage.getItem(KEY_SCOPE) || 'tab'; }

async function openFrom(scope, url){
  if(!chrome.sidePanel?.setOptions || !chrome.sidePanel?.open){
    throw new Error('Side panel API not supported in this browser');
  }
  if(scope==='tab'){
    const t = await getActiveTab();
    await chrome.runtime.sendMessage({ type:'SP_SET_PER_TAB', tabId:t.id, url });
    await chrome.sidePanel.setOptions({ tabId: t.id, path:url, enabled:true });
    await chrome.sidePanel.open({ tabId: t.id });
  }else{
    await chrome.runtime.sendMessage({ type:'SP_SET_GLOBAL', url });
    await chrome.sidePanel.setOptions({ path:url, enabled:true });
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
  }
  // refresh sideflows list after change
  renderSideflows();
}

function renderFavs(list, filter=''){
  const wrap = document.getElementById('fav-wrap');
  const root = document.getElementById('fav-list');
  root.innerHTML='';
  let show = list;
  if(filter && filter.trim()){
    const q = filter.toLowerCase();
    show = list.filter(f => f.url.toLowerCase().includes(q) || hostOf(f.url).toLowerCase().includes(q));
  }
  if(!show.length){
    const empty = document.createElement('div');
    empty.className='empty';
    empty.textContent='No favorites yet — type a URL and click Save.';
    root.appendChild(empty);
    return;
  }
  for(const fav of show){
    const item = document.createElement('div'); item.className='rowitem';
    const ico = document.createElement('img'); ico.className='favicon'; ico.src=favIcon(fav.url); ico.alt='';
    const meta = document.createElement('div'); meta.className='meta';
    const name = document.createElement('div'); name.className='name'; name.textContent = hostOf(fav.url);
    const url = document.createElement('div'); url.className='sub'; url.textContent = fav.url;
    meta.append(name, url);
    const actions = document.createElement('div'); actions.className='actions';
    const bTab = document.createElement('button'); bTab.className='btn'; bTab.textContent='Open (tab)';
    const bGlobal = document.createElement('button'); bGlobal.className='btn primary'; bGlobal.textContent='Open (global)';
    const bDel = document.createElement('button'); bDel.className='btn danger'; bDel.textContent='Delete';
    actions.append(bTab,bGlobal,bDel);
    item.append(ico,meta,actions); root.appendChild(item);
    meta.addEventListener('click', ()=>{ document.getElementById('url').value=fav.url; });
    bTab.addEventListener('click', ()=> openFrom('tab', fav.url).then(()=>toast('Opened on this tab')));
    bGlobal.addEventListener('click', ()=> openFrom('global', fav.url).then(()=>toast('Opened globally')));
    bDel.addEventListener('click', async ()=>{
      const next = (await loadFavs()).filter(x=>x.url!==fav.url);
      await saveFavs(next); renderFavs(next, document.getElementById('filter').value); toast('Removed from favorites');
    });
  }
}

async function renderSideflows(){
  const list = document.getElementById('list-sideflows'); list.innerHTML='';
  try{
    const win = await chrome.windows.getCurrent();
    const resp = await chrome.runtime.sendMessage({ type:'SP_LIST_LINKED_TABS', windowId: win.id });
    const rows = resp?.tabs || [];
    if(rows.length===0){
      const empty = document.createElement('div'); empty.className='empty'; empty.textContent='No per‑tab SideFlows on this window yet.'; list.appendChild(empty); return;
    }
    for(const r of rows){
      const item = document.createElement('div'); item.className='rowitem';
      const ico = document.createElement('img'); ico.className='favicon'; ico.src = r.favicon || ''; ico.alt='';
      const meta = document.createElement('div'); meta.className='meta';
      const name = document.createElement('div'); name.className='name'; name.textContent = r.title || '(Tab '+r.id+')';
      const url = document.createElement('div'); url.className='sub'; url.textContent = r.url;
      meta.append(name,url);
      const actions = document.createElement('div'); actions.className='actions';
      const bGoto = document.createElement('button'); bGoto.className='btn'; bGoto.textContent='Go to tab';
      const bClose = document.createElement('button'); bClose.className='btn danger'; bClose.textContent='Close panel';
      actions.append(bGoto,bClose);
      item.append(ico,meta,actions); list.appendChild(item);
      bGoto.addEventListener('click', async ()=>{
        await chrome.runtime.sendMessage({ type:'SP_GOTO_TAB', tabId: r.id, windowId: r.windowId });
      });
      bClose.addEventListener('click', async ()=>{
        const res = await chrome.runtime.sendMessage({ type:'SP_CLOSE_TAB_PANEL', tabId: r.id });
        if(res?.ok){ toast('Closed for tab'); renderSideflows(); } else { toast('Could not close'); }
      });
    }
  }catch(e){
    const empty = document.createElement('div'); empty.className='empty'; empty.textContent='Unable to load tabs.'; list.appendChild(empty);
  }
}

(async () => {
  const urlInput = document.getElementById('url');
  const useCurrent = document.getElementById('use-current');
  const bOpen = document.getElementById('open');
  const bSave = document.getElementById('save');
  const bCloseGlobal = document.getElementById('close-global');
  const fInput = document.getElementById('filter');
  const scopeTab = document.getElementById('scope-tab');
  const scopeGlobal = document.getElementById('scope-global');

  // Disclosures
  const dsFav = document.getElementById('ds-favs');
  const favWrap = document.getElementById('fav-wrap');
  dsFav.addEventListener('click', ()=>{
    const open = dsFav.getAttribute('aria-expanded') === 'true';
    dsFav.setAttribute('aria-expanded', String(!open));
    favWrap.style.display = open ? 'none' : 'block';
  });
  const dsSF = document.getElementById('ds-sideflows');
  const listSF = document.getElementById('list-sideflows');
  dsSF.addEventListener('click', ()=>{
    const open = dsSF.getAttribute('aria-expanded') === 'true';
    dsSF.setAttribute('aria-expanded', String(!open));
    listSF.style.display = open ? 'none' : 'grid';
  });

  scopeTab.addEventListener('click', ()=> setScope('tab'));
  scopeGlobal.addEventListener('click', ()=> setScope('global'));
  setScope(getScope());

  useCurrent.addEventListener('click', async ()=>{
    const t = await getActiveTab();
    if(t?.url){ urlInput.value = t.url; urlInput.focus(); urlInput.select(); }
  });

  function apply(){
    const u = normalize(urlInput.value);
    if(!u){ toast('Please enter a URL or search.'); urlInput.focus(); return; }
    openFrom(getScope(), u).catch(e=> toast('Failed: '+(e && e.message || e)));
  }
  bOpen.addEventListener('click', apply);
  urlInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') apply(); });

  bSave.addEventListener('click', async ()=>{
    const u = normalize(urlInput.value);
    if(!u){ toast('Please enter a URL or search.'); return; }
    const arr = await loadFavs();
    if(arr.some(x=>x.url===u)){ toast('Already in favorites'); return; }
    arr.unshift({ url:u, addedAt:Date.now() });
    await saveFavs(arr.slice(0,200));
    renderFavs(arr, fInput.value); toast('Saved to favorites');
  });

  bCloseGlobal.addEventListener('click', async ()=>{
    try { const resp = await chrome.runtime.sendMessage({ type:'SP_CLEAR_GLOBAL_AND_CLOSE' });
      toast(resp?.ok ? ('Global cleared. Disabled on '+(resp.closed||0)+' tabs.') : 'Failed to clear global');
      renderSideflows();
    } catch(e){ toast('Error: '+(e && e.message || e)); }
  });

  fInput.addEventListener('input', async ()=> renderFavs(await loadFavs(), fInput.value));

  renderFavs(await loadFavs());
  renderSideflows();
})();
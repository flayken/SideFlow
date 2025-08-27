const KEY_FAVS = 'sideflow.favorites';
const KEY_SCOPE = 'sideflow.scope';
const THEME_KEY = 'sideflow_theme';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function normalize(s){
  s = (s||'').trim();
  if(!s) return null;
  const hasDot = /\./.test(s);
  if(/^https?:\/\//i.test(s) || hasDot){
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try{ return new URL(s).toString(); }catch{}
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}
function favIcon(u){
  try {
    const h = new URL(u).host;
    return 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(h);
  } catch {
    return '';
  }
}
function labelFrom(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return u; } }
async function getActiveTab(){ const [t] = await chrome.tabs.query({active:true,currentWindow:true}); return t; }

async function openFrom(scope, url){
  // Only allow regular web pages to be opened. Internal browser pages such as
  // `chrome://` or `about:` cannot be displayed inside the side panel and would
  // crash the extension if attempted.
  if(!/^https?:\/\//i.test(url)){
    toast('This page cannot be used with SideFlow');
    return;
  }
  const t = await getActiveTab();
  try{ await chrome.storage.session.set({ lastPanelUrl: url }); }catch{}
  try{
    if(scope==='tab'){
      await chrome.runtime.sendMessage({ type:'SP_SET_PER_TAB', tabId:t.id, url });
      await chrome.sidePanel.setOptions({ tabId: t.id, path:url, enabled:true });
      await chrome.sidePanel.open({ tabId: t.id });
    }else{
      await chrome.runtime.sendMessage({ type:'SP_SET_GLOBAL', url });
      await chrome.sidePanel.setOptions({ path:url, enabled:true });
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    }
  }catch(e){
    console.error('Failed to open side panel', e);
    toast('Unable to open side panel');
  }
  renderSideflows();
}

async function loadFavs(){ const r = await chrome.storage.local.get(KEY_FAVS); return r[KEY_FAVS] || []; }
async function saveFavs(v){ await chrome.storage.local.set({ [KEY_FAVS]: v }); }

let favorites = [];
let scope = 'tab';
let theme = localStorage.getItem(THEME_KEY) || 'dark';
const activeDropdownClosers = new Set();

function applyTheme(){
  document.documentElement.setAttribute('data-theme', theme);
  const tgl = $('#themeToggle');
  tgl.className = 'toggle ' + (theme === 'dark' ? 'dark' : 'light');
  $('#iconMoon').style.display = theme === 'dark' ? 'block' : 'none';
  $('#iconSun').style.display  = theme === 'dark' ? 'none'  : 'block';
  tgl.setAttribute('aria-checked', theme === 'dark');
}

function setScope(val){
  scope = val;
  localStorage.setItem(KEY_SCOPE, val);
  $$('#scopeSeg button').forEach(b=> b.classList.toggle('active', b.dataset.value===val));
}
function getScope(){ return localStorage.getItem(KEY_SCOPE) || 'tab'; }

function toast(msg){
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.position='fixed'; t.style.left='50%'; t.style.bottom='24px'; t.style.transform='translateX(-50%)';
  t.style.padding='8px 12px'; t.style.borderRadius='14px'; t.style.color='#fff'; t.style.zIndex='9999';
  t.className='gradient';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1400);
}

function renderFavs(){
  // Clean up any active close listeners from prior renders
  for(const fn of activeDropdownClosers){
    document.removeEventListener('click', fn);
  }
  activeDropdownClosers.clear();

  const wrap=$('#favorites');
  wrap.innerHTML='';
  const groups={};
  for(const f of favorites){
    const domain = f.label || labelFrom(f.url);
    (groups[domain] ||= []).push(f);
  }
  for(const [domain,list] of Object.entries(groups)){
    const li=document.createElement('div');
    li.className='fav';
    
    const tile=document.createElement('button');
    tile.className='tile';
    tile.innerHTML = `<img src="${favIcon(list[0].url)}" alt="" width="22" height="22" style="border-radius:6px" onerror="this.onerror=null;this.src='logo.png';" />`;
    li.appendChild(tile);

    const label=document.createElement('div');
    label.className='label';
    label.title=domain;
    label.textContent=domain;
    li.appendChild(label);

    const remove=document.createElement('button');
    remove.className='remove';
    remove.setAttribute('aria-label','Remove');
    remove.textContent='×';
    li.appendChild(remove);

    if(list.length===1){
      tile.addEventListener('click', ()=> openFrom(scope, list[0].url));
      remove.addEventListener('click', async ()=>{
        favorites = favorites.filter(x=>x.id!==list[0].id);
        await saveFavs(favorites);
        renderFavs();
      });
    } else {
      const count=document.createElement('span');
      count.className='count';
      count.textContent=list.length;
      tile.appendChild(count);

      const menu=document.createElement('div');
      menu.className='dropdown';
      let closeListener;

      for(const f of list){
        const item=document.createElement('div');
        item.className='dropdown-item';
        const txt=document.createElement('span');
        txt.className='label';
        try{ txt.textContent=f.title || new URL(f.url).pathname.replace(/^\//,'') || '/'; }
        catch{ txt.textContent=f.title || f.url; }
        const rm=document.createElement('button');
        rm.className='drop-remove';
        rm.textContent='×';
        rm.setAttribute('aria-label','Remove');
        item.append(txt,rm);
        item.addEventListener('click',(e)=>{ if(e.target===rm) return; openFrom(scope,f.url); menu.classList.remove('open'); });
        rm.addEventListener('click',async(e)=>{
          e.stopPropagation();
          favorites=favorites.filter(x=>x.id!==f.id);
          await saveFavs(favorites);
          if(closeListener){
            document.removeEventListener('click', closeListener);
            activeDropdownClosers.delete(closeListener);
          }
          renderFavs();
        });
        menu.appendChild(item);
      }
      li.appendChild(menu);

      tile.addEventListener('click',(e)=>{
        e.stopPropagation();
        const isOpen=menu.classList.toggle('open');
        if(isOpen){
          $$('#favorites .dropdown').forEach(d=>{ if(d!==menu) d.classList.remove('open'); });
          closeListener=(ev)=>{
            if(!li.contains(ev.target)){
              menu.classList.remove('open');
              document.removeEventListener('click',closeListener);
              activeDropdownClosers.delete(closeListener);
            }
          };
          document.addEventListener('click',closeListener);
          activeDropdownClosers.add(closeListener);
        }
      });

      remove.addEventListener('click', async ()=>{
        favorites = favorites.filter(x=> x.label !== domain);
        await saveFavs(favorites);
        if(closeListener){
          document.removeEventListener('click', closeListener);
          activeDropdownClosers.delete(closeListener);
        }
        renderFavs();
      });
    }
    wrap.appendChild(li);
  }
}

async function renderSideflows(){
  const wrap = $('#sideflows');
  wrap.innerHTML='';
  wrap.style.display='block';
  wrap.style.textAlign='left';
  wrap.style.color='';
  wrap.style.alignItems='';
  wrap.style.justifyContent='';
  wrap.style.flexDirection='';
  try{
    const win = await chrome.windows.getCurrent();
    const resp = await chrome.runtime.sendMessage({ type:'SP_LIST_LINKED_TABS', windowId: win.id });
    const rows = resp?.tabs || [];
    const globalUrl = resp?.global?.url;
    if(rows.length===0 && !globalUrl){
      // Use your logo.png for the empty state icon
      wrap.innerHTML = `<div style="margin:0 auto 8px; width:36px; height:36px; display:grid; place-items:center; border-radius:10px; border:1px solid var(--border); background:var(--surface); overflow:hidden">
        <img src="logo.png" alt="" width="18" height="18" style="opacity:.9; display:block;" />
      </div>No SideFlows in this window yet.`;
      wrap.style.display='flex';
      wrap.style.flexDirection='column';
      wrap.style.alignItems='center';
      wrap.style.justifyContent='center';
      wrap.style.textAlign='center';
      wrap.style.color='var(--muted)';
      return;
    }

    if(globalUrl){
      const item=document.createElement('div');
      item.style.display='flex';
      item.style.alignItems='center';
      item.style.gap='10px';
      item.style.background='var(--chip)';
      item.style.border='1px solid var(--border)';
      item.style.borderRadius='14px';
      item.style.padding='8px 10px';
      item.style.marginBottom='8px';
      const ico=document.createElement('img');
      ico.src = favIcon(globalUrl) || 'logo.png';
      ico.width = 20;
      ico.height = 20;
      ico.style.borderRadius = '6px';
      ico.onerror = () => { ico.src = 'logo.png'; };
      const meta=document.createElement('div'); meta.style.flex='1'; meta.style.minWidth='0';
      const title=document.createElement('div'); title.style.fontSize='13px'; title.style.color='var(--text)'; title.style.whiteSpace='nowrap'; title.style.overflow='hidden'; title.style.textOverflow='ellipsis'; title.textContent=labelFrom(globalUrl);
      const url=document.createElement('div'); url.style.fontSize='11px'; url.style.color='var(--muted)'; url.style.whiteSpace='nowrap'; url.style.overflow='hidden'; url.style.textOverflow='ellipsis'; url.textContent=globalUrl;
      meta.append(title,url);
      const tag=document.createElement('span'); tag.textContent='Global'; tag.className='btn primary gradient'; tag.style.padding='6px 8px'; tag.style.fontSize='12px'; tag.style.cursor='default'; tag.style.pointerEvents='none';
      const close=document.createElement('button'); close.className='btn danger'; close.style.padding='6px 8px'; close.style.fontSize='12px'; close.textContent='Close';
      close.addEventListener('click', async()=>{ const res = await chrome.runtime.sendMessage({ type:'SP_CLEAR_GLOBAL_AND_CLOSE' }); if(res?.ok) renderSideflows(); });
      item.append(ico,meta,tag,close);
      wrap.appendChild(item);
    }

    rows.forEach(r=>{
      const item=document.createElement('div');
      item.style.display='flex';
      item.style.alignItems='center';
      item.style.gap='10px';
      item.style.background='var(--chip)';
      item.style.border='1px solid var(--border)';
      item.style.borderRadius='14px';
      item.style.padding='8px 10px';
      item.style.marginBottom='8px';

      const icoWrap = document.createElement('div');
      icoWrap.style.display = 'flex';
      icoWrap.style.alignItems = 'center';
      icoWrap.style.gap = '4px';

      const tabIco = document.createElement('img');
      tabIco.src = r.favicon || 'logo.png';
      tabIco.width = 20;
      tabIco.height = 20;
      tabIco.style.borderRadius = '6px';
      tabIco.onerror = () => { tabIco.src = 'logo.png'; };

      const cross = document.createElement('span');
      cross.textContent = '×';
      cross.style.fontSize = '12px';
      cross.style.color = 'var(--muted)';

      const panelIco = document.createElement('img');
      panelIco.src = favIcon(r.url) || 'logo.png';
      panelIco.width = 20;
      panelIco.height = 20;
      panelIco.style.borderRadius = '6px';
      panelIco.onerror = () => { panelIco.src = 'logo.png'; };

      icoWrap.append(tabIco, cross, panelIco);

      const meta=document.createElement('div'); meta.style.flex='1'; meta.style.minWidth='0';
      const title=document.createElement('div'); title.style.fontSize='13px'; title.style.color='var(--text)'; title.style.whiteSpace='nowrap'; title.style.overflow='hidden'; title.style.textOverflow='ellipsis'; title.textContent=r.title||('(Tab '+r.id+')');
      const url=document.createElement('div'); url.style.fontSize='11px'; url.style.color='var(--muted)'; url.style.whiteSpace='nowrap'; url.style.overflow='hidden'; url.style.textOverflow='ellipsis'; url.textContent=r.url;
      meta.append(title,url);
      const go=document.createElement('button'); go.className='btn ghost'; go.style.padding='6px 8px'; go.style.fontSize='12px'; go.textContent='Go';
      const close=document.createElement('button'); close.className='btn danger'; close.style.padding='6px 8px'; close.style.fontSize='12px'; close.textContent='Close';
      go.addEventListener('click', async()=>{ await chrome.runtime.sendMessage({ type:'SP_GOTO_TAB', tabId:r.id, windowId:r.windowId }); });
      close.addEventListener('click', async()=>{ const res = await chrome.runtime.sendMessage({ type:'SP_CLOSE_TAB_PANEL', tabId:r.id }); if(res?.ok) renderSideflows(); });
      item.append(icoWrap,meta,go,close);
      wrap.appendChild(item);
    });
  }catch(e){
    wrap.textContent='Unable to load tabs.';
  }
}

(async function init(){
  const input = $('#urlInput');
  input.focus();
  input.select();
  favorites = await loadFavs();
  renderFavs();
  scope = getScope();
  setScope(scope);
  applyTheme();
  renderSideflows();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY_FAVS]) {
      favorites = changes[KEY_FAVS].newValue || [];
      renderFavs();
    }
  });
  
  $('#themeToggle').addEventListener('click', ()=>{
    theme = theme==='dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, theme);
    applyTheme();
  });

  $$('#scopeSeg button').forEach(btn=> btn.addEventListener('click', ()=> setScope(btn.dataset.value)));

  $('#usePageBtn').addEventListener('click', async ()=>{
    const t = await getActiveTab();
    if(t?.url){
      await openFrom(scope, t.url);
    }
  });

  function doOpen(){
    const u = normalize($('#urlInput').value);
    if(!u) return;
    openFrom(scope, u);
  }
  $('#openBtn').addEventListener('click', doOpen);
  $('#urlInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') doOpen(); });

  $('#closeAll').addEventListener('click', async ()=>{
    try{
      const resp = await chrome.runtime.sendMessage({ type:'SP_CLOSE_ALL' });
      toast(resp?.ok ? 'Closed all panels' : 'Failed to close');
      renderSideflows();
    }catch{
      toast('Failed to close');
    }
  });
})();

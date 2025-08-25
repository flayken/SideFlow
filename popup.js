
// popup.js — user-gesture safe operations
const $ = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));

const KEY_GLOBAL = 'sf:globalUrl';
const TAB_PREFIX = 'sf:tab:'; // session key per tab
const FAVS = 'sf:favs';
const SCOPE = 'sf:scope';

function toast(msg){
  const wrap = $('.toast-wrap');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(6px)'; }, 1600);
  setTimeout(()=> t.remove(), 2100);
}

function toURL(value){
  if(!value) return null;
  const v = value.trim();
  if(!v) return null;
  try { new URL(v); return v; } catch(e){}
  if(/^[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]{2,}(\:\d+)?(\/.*)?$/.test(v)){
    return 'https://' + v;
  }
  return 'https://www.google.com/search?q=' + encodeURIComponent(v);
}

function setScope(val){
  const isGlobal = val === 'global';
  $('#scope-tab').setAttribute('aria-pressed', String(!isGlobal));
  $('#scope-global').setAttribute('aria-pressed', String(isGlobal));
  localStorage.setItem(SCOPE, val);
}

$('#scope-tab').addEventListener('click', ()=> setScope('tab'));
$('#scope-global').addEventListener('click', ()=> setScope('global'));
setScope(localStorage.getItem(SCOPE) || 'tab');

$('#use-current').addEventListener('click', ()=>{
  // Use active tab URL
  chrome.tabs.query({active:true, currentWindow:true}).then(tabs=>{
    if(tabs[0]?.url){ const u = new URL(tabs[0].url); $('#url').value = u.origin; }
  });
});

async function openNow(){
  const input = $('#url').value;
  const norm = toURL(input);
  if(!norm){ toast('Please enter a URL or search.'); $('#url').focus(); return; }
  const scope = localStorage.getItem(SCOPE) || 'tab';
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
  if(!tab){ toast('No active tab.'); return; }

  try{
    if(scope === 'global'){
      await chrome.storage.local.set({[KEY_GLOBAL]: norm});
    }else{
      await chrome.storage.session.set({[TAB_PREFIX + tab.id]: norm});
    }
    // Immediately apply + open on this tab — this is a user gesture (click/Enter)
    await chrome.sidePanel.setOptions({tabId: tab.id, path: norm, enabled: true});
    await chrome.sidePanel.open({tabId: tab.id});
    toast('Opening in side panel…');
    renderSideflows();
  }catch(e){
    const m = chrome.runtime.lastError?.message || String(e.message || e);
    toast(m);
    console.warn('SideFlow open error:', m);
  }
}
$('#open').addEventListener('click', openNow);
$('#url').addEventListener('keydown', (e)=>{ if(e.key==='Enter') openNow(); });

// Favorites
function readFavs(){ try{return JSON.parse(localStorage.getItem(FAVS)||'[]');}catch{ return []; } }
function writeFavs(v){ localStorage.setItem(FAVS, JSON.stringify(v)); }

function faviconFor(u){ try{ const {origin} = new URL(u); return origin + '/favicon.ico'; }catch{ return ''; } }

function nameFromUrl(u){ try{ const url = new URL(u); return url.hostname.replace('www.',''); }catch{ return u; } }

function renderFavs(){
  const wrap = $('#fav-list');
  wrap.innerHTML = '';
  const q = ($('#filter').value || '').trim().toLowerCase();
  const favs = readFavs();
  const vis = favs.filter(f=> !q || f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q));
  if(vis.length===0){
    const e = document.createElement('div'); e.className='empty'; e.textContent='No favorites yet — type a URL and click Save.'; wrap.appendChild(e); return;
  }
  for(const f of vis){
    const row = document.createElement('div'); row.className='rowitem';
    const ico = document.createElement('img'); ico.className='favicon'; ico.src=faviconFor(f.url); ico.alt='';
    const meta = document.createElement('div'); meta.className='meta';
    const name = document.createElement('div'); name.className='name'; name.textContent=f.name;
    const sub = document.createElement('div'); sub.className='sub'; sub.textContent=f.url;
    meta.append(name, sub);
    const acts = document.createElement('div'); acts.className='actions';
    const openTab = document.createElement('button'); openTab.className='btn icon ghost'; openTab.textContent='↗'; openTab.title='Open in this tab';
    openTab.addEventListener('click', ()=>{ $('#url').value = f.url; setScope('tab'); openNow(); });
    const openGlobal = document.createElement('button'); openGlobal.className='btn icon primary'; openGlobal.textContent='🌐'; openGlobal.title='Open as global';
    openGlobal.addEventListener('click', ()=>{ $('#url').value = f.url; setScope('global'); openNow(); });
    const del = document.createElement('button'); del.className='btn icon danger'; del.textContent='✕'; del.title='Remove';
    del.addEventListener('click', ()=>{ writeFavs(readFavs().filter(x=>x.id!==f.id)); renderFavs(); toast('Removed from favorites'); });
    acts.append(openTab, openGlobal, del);
    row.append(ico, meta, acts);
    wrap.appendChild(row);
  }
}
$('#save').addEventListener('click', ()=>{
  const norm = toURL($('#url').value);
  if(!norm){ toast('Please enter a URL.'); return; }
  const favs = readFavs();
  if(favs.some(f=> f.url===norm)){ toast('Already in favorites.'); return; }
  favs.unshift({id: Math.random().toString(36).slice(2), url:norm, name: nameFromUrl(norm)});
  writeFavs(favs); renderFavs(); toast('Saved to favorites');
});
$('#filter').addEventListener('input', renderFavs);

// Disclosures
function bindDisclosure(id, targetSel){
  const d = $(id); const target = $(targetSel);
  const apply = ()=>{ const open = d.getAttribute('aria-expanded')==='true'; target.style.display = open? 'block':'none'; };
  d.addEventListener('click', ()=>{ const open = d.getAttribute('aria-expanded')==='true'; d.setAttribute('aria-expanded', String(!open)); apply(); });
  apply();
}
bindDisclosure('#ds-favs', '#fav-wrap');

// Close all global panels
$('#close-global').addEventListener('click', async ()=>{
  await chrome.storage.local.remove(KEY_GLOBAL);
  // If current tab doesn't have a per-tab mapping, disable it
  const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
  const m = await chrome.storage.session.get(TAB_PREFIX + tab.id);
  if(!m[TAB_PREFIX + tab.id]){
    try{ await chrome.sidePanel.setOptions({tabId: tab.id, enabled:false, path:'fallback.html'});}catch{}
  }
  toast('Cleared global panel.');
});

// Sideflows list (per-tab in this window)
async function renderSideflows(){
  const list = $('#list-sideflows');
  list.innerHTML = '';
  const resp = await chrome.runtime.sendMessage({type:'SF_LIST_WINDOW'}).catch(()=>null);
  const rows = resp?.rows || [];
  if(rows.length===0){
    const e = document.createElement('div'); e.className='empty'; e.textContent='No per-tab SideFlows in this window yet.'; list.appendChild(e); return;
  }
  for(const r of rows){
    const row = document.createElement('div'); row.className='rowitem';
    const ico = document.createElement('div'); ico.className='favicon';
    const meta = document.createElement('div'); meta.className='meta';
    const name = document.createElement('div'); name.className='name'; name.textContent = r.title || r.url;
    const sub = document.createElement('div'); sub.className='sub'; sub.textContent = r.url;
    meta.append(name, sub);
    const acts = document.createElement('div'); acts.className='actions';
    const focusBtn = document.createElement('button'); focusBtn.className='btn icon ghost'; focusBtn.textContent='👁'; focusBtn.title='Go to tab';
    focusBtn.addEventListener('click', async ()=>{ await chrome.tabs.update(r.tabId, {active:true}); });
    const removeBtn = document.createElement('button'); removeBtn.className='btn icon danger'; removeBtn.textContent='✕'; removeBtn.title='Remove mapping';
    removeBtn.addEventListener('click', async ()=>{
      await chrome.storage.session.remove(TAB_PREFIX + r.tabId);
      toast('Removed mapping');
      renderSideflows();
    });
    acts.append(focusBtn, removeBtn);
    row.append(ico, meta, acts);
    list.appendChild(row);
  }
}

// init
renderFavs();
renderSideflows();


// Inject navigation controls for SideFlow side panel
(function () {
  if (window.sideFlowNavLoaded) return; // prevent double inject
  window.sideFlowNavLoaded = true;
  if (self !== top) return;             // only top frame

  const BAR_H = 36;
  const BAR_BG = '#0b0e12';
  const BAR_BORDER = '#22283a';
  const ICON_ON = '#ffffff';
  const ICON_OFF = '#8b93a6';

  function setup() {
    // bar
    const bar = document.createElement('div');
    bar.id = 'sf-nav-bar';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0',
      height: BAR_H + 'px',
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      padding: '4px 8px',
      background: BAR_BG,
      borderBottom: '2px solid ' + BAR_BORDER,
      zIndex: '2147483647',
      color: '#e9eaf1',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    });

    // minimal icon button
    const makeBtn = (svg, title, action) => {
      const b = document.createElement('button');
      b.title = title;
      b.innerHTML = svg;
      Object.assign(b.style, {
        all: 'unset',
        cursor: 'pointer',
        width: '28px',
        height: '28px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '6px',
      });
      b.addEventListener('click', action);
      return b;
    };

    // icons (stroke uses currentColor)
    const icoBack = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>`;
    const icoFwd  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`;
    const icoRef  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v7h-7"/></svg>`;
    const icoFollow = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`;

    const backBtn = makeBtn(icoBack, 'Back', () => history.back());
    const fwdBtn  = makeBtn(icoFwd,  'Forward', () => history.forward());
    const refBtn  = makeBtn(icoRef,  'Refresh', () => location.reload());
    const followBtn = makeBtn(icoFollow, 'Follow', () => {});

    // default colors
    [backBtn, fwdBtn, refBtn, followBtn].forEach(b => {
      b.style.color = ICON_OFF;
      b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.opacity = '0.9'; });
      b.addEventListener('mouseleave', () => { b.style.opacity = '1'; });
      b.addEventListener('mousedown',  () => { if (!b.disabled) b.style.opacity = '0.8'; });
      b.addEventListener('mouseup',    () => { b.style.opacity = '1'; });
    });

    bar.append(backBtn, fwdBtn, refBtn, followBtn);
    document.body.style.marginTop = BAR_H + 'px';
    document.body.prepend(bar);

    // ---- enable/disable logic ----
    let guessedForward = false;

    const setEnabled = (el, on) => {
      el.disabled = !on;
      el.style.color = on ? ICON_ON : ICON_OFF;
      el.style.cursor = on ? 'pointer' : 'default';
      el.style.opacity = '1';
    };

    const hasNavAPI = 'navigation' in window &&
                      (typeof navigation.canGoBack === 'boolean' || 'currentEntry' in navigation);

    function updateButtons() {
      let canBack, canFwd;

      if (hasNavAPI && typeof navigation.canGoBack === 'boolean') {
        canBack = navigation.canGoBack;
        canFwd  = navigation.canGoForward;
      } else {
        // Fallback heuristics
        canBack = (history.length > 1) || document.referrer !== '';
        canFwd  = guessedForward; // becomes true after we go back
      }

      setEnabled(backBtn, canBack);
      setEnabled(fwdBtn,  canFwd);
      setEnabled(refBtn,  true);
      refreshFollow();
    }

    // When we navigate back, we know forward should be available
    backBtn.addEventListener('click', () => {
      guessedForward = true;
      updateButtons();
    });
    // When new entries are pushed, forward is no longer available
    const patchHistory = () => {
      const _push = history.pushState;
      const _replace = history.replaceState;
      history.pushState = function () {
        guessedForward = false;
        updateButtons();
        return _push.apply(this, arguments);
      };
      history.replaceState = function () {
        // replace doesn't change forward availability
        return _replace.apply(this, arguments);
      };
    };
    patchHistory();

    // Listen for SPA and BFCache navigations
    window.addEventListener('popstate', () => {
      // direction unknown; assume forward may exist after a back
      // browser will correct via Navigation API if available
      updateButtons();
    });
    window.addEventListener('pageshow', updateButtons);

    if (hasNavAPI) {
      const navUpdate = () => updateButtons();
      navigation.addEventListener?.('currententrychange', navUpdate);
      navigation.addEventListener?.('navigatesuccess', navUpdate);
    }

    updateButtons();

    // ---- follow logic ----
    async function refreshFollow(){
      try{
        const r = await chrome.runtime.sendMessage({ type:'SP_FOLLOW_INFO' });
        const f = r.follow || { on:false };
        const on = !!f.on;
        followBtn.style.color = on ? ICON_ON : ICON_OFF;
        followBtn.title = on ? 'Unfollow' : 'Follow';
        if(on && f.url !== location.href){
          await chrome.runtime.sendMessage({ type:'SP_FOLLOW_UPDATE_URL', url: location.href });
        }
      }catch{}
    }

    followBtn.addEventListener('click', async ()=>{
      try{
        const info = await chrome.runtime.sendMessage({ type:'SP_FOLLOW_INFO' });
        if(info.follow?.on){
          if(info.replacing){
            const ok = confirm('This tab already had a panel. Unfollow will replace it. Continue?');
            if(!ok) return;
          }
          const r = await chrome.runtime.sendMessage({ type:'SP_FOLLOW_STOP' });
          if(r?.ok){
            followBtn.style.color = ICON_OFF;
            followBtn.title = 'Follow';
          }else if(r?.error){
            alert(r.error);
          }
        }else{
          const state = await chrome.runtime.sendMessage({ type:'SP_GET_STATE' });
          if(state.global?.keep){
            const ok = confirm('Must close global side panel before you can use follow. Close global panels?');
            if(!ok) return;
            await chrome.runtime.sendMessage({ type:'SP_CLEAR_GLOBAL_AND_CLOSE' });
          }
          const r = await chrome.runtime.sendMessage({ type:'SP_FOLLOW_START', url: location.href });
          if(r?.ok){
            followBtn.style.color = ICON_ON;
            followBtn.title = 'Unfollow';
          }else if(r?.error){
            alert(r.error);
          }
        }
      }catch(e){ console.error(e); }
    });

    refreshFollow();

    // keep bar if removed
    const mo = new MutationObserver(()=>{
      if(!document.getElementById('sf-nav-bar')){
        document.body.prepend(bar);
      }
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  }

  function start(){
    if(window.innerWidth <= 600){
      setup();
    }else{
      const onResize = () => {
        if(window.innerWidth <= 600){
          window.removeEventListener('resize', onResize);
          setup();
        }
      };
      window.addEventListener('resize', onResize);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
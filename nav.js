// Inject navigation controls for SideFlow side panel
;(async function () {
  if (window.sideFlowNavLoaded) return; // prevent double inject
  window.sideFlowNavLoaded = true;
  if (self !== top) return;             // only top frame

  // only run inside a side panel surface
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SF_IS_SIDEPANEL' });
    if (!resp?.inSidePanel) return;
  } catch {
    return; // if messaging fails, assume this isn't a panel
  }

  // open a long-lived port to detect when the panel is closed
  // keep a reference so it stays alive
  try {
    window.sfPanelPort = chrome.runtime.connect({ name: 'sf-panel' });
  } catch {}

  const BAR_H = 36;
  const HOTZONE_H = 4; // hover area at top edge to reveal the bar
  const BAR_BG = '#0b0e12';
  const BAR_BORDER = '#22283a';
  const ICON_ON = '#ffffff';
  const ICON_OFF = '#8b93a6';

  const KEY_FAVS = 'sideflow.favorites';
  const KEY_HINT = 'sideflow.seenAutohideHint';

  function normalize(u) {
    try { return new URL(u).toString(); } catch { return u; }
  }
  function labelFrom(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
  }
  async function loadFavs() {
    const r = await chrome.storage.local.get(KEY_FAVS);
    return r[KEY_FAVS] || [];
  }
  async function saveFavs(v) {
    await chrome.storage.local.set({ [KEY_FAVS]: v });
  }

  let favorites = [];
  let favBtn;

  const icoFav = (filled) =>
    filled
      ? makeSvg([{ d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z', fill: 'currentColor', stroke: 'none' }])
      : makeSvg([{ d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }]);

  function updateFavIcon() {
    if (!favBtn) return;
    const u = normalize(location.href);
    const isFav = favorites.some(f => f.url === u);
    favBtn.innerHTML = '';
    favBtn.appendChild(icoFav(isFav));
    favBtn.style.color = isFav ? ICON_ON : ICON_OFF;
    favBtn.title = isFav ? 'Already in Favorites' : 'Add to Favorites';
    favBtn.disabled = isFav;
    favBtn.style.cursor = isFav ? 'default' : 'pointer';
    // If disabled, let clicks pass through to page underneath
    favBtn.style.pointerEvents = isFav ? 'none' : 'auto';
  }

  async function toggleFavorite() {
    const u = normalize(location.href);
    const isFav = favorites.some(f => f.url === u);
    if (isFav) return;
    favorites.unshift({ id: Date.now(), url: u, label: labelFrom(u), title: document.title });
    await saveFavs(favorites);
    updateFavIcon();
  }

  // --- tiny SVG helper (no innerHTML, no '<' in source) ---
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function makeSvg(shapes = []) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const s of shapes) {
      const el = document.createElementNS(SVG_NS, s.tag || 'path');
      for (const [k, v] of Object.entries(s)) {
        if (k === 'tag') continue;
        el.setAttribute(k, String(v));
      }
      svg.appendChild(el);
    }
    return svg;
  }

  // icons
  const icoBack   = () => makeSvg([{ d: 'M15 19l-7-7 7-7' }]);
  const icoFwd    = () => makeSvg([{ d: 'M9 5l7 7-7 7' }]);
  const icoRef    = () => makeSvg([
    { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
    { d: 'M21 3v7h-7' }
  ]);
  const icoChevronDown = () => makeSvg([{ d: 'M6 9l6 6 6-6' }]);

  async function setup() {
    // --- hint strip (always visible; suggests something is at top) ---
    const hintStrip = document.createElement('div');
    Object.assign(hintStrip.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0',
      height: '2px',
      zIndex: '2147483647',
      background: 'linear-gradient(90deg, rgba(76,111,251,.35), rgba(47,181,241,.35), rgba(18,214,200,.35))',
      opacity: '.6',
      transition: 'opacity .15s ease',
      pointerEvents: 'none', // purely visual
    });

    // --- hotzone (reveals the bar on hover) ---
    const hotzone = document.createElement('div');
    Object.assign(hotzone.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0',
      height: HOTZONE_H + 'px',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      background: 'transparent',
    });

    // --- full-width, overlay bar (auto-hidden) ---
    const bar = document.createElement('div');
    bar.id = 'sf-nav-bar';
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0',
      height: BAR_H + 'px',
      display: 'flex',
      alignItems: 'center',
      padding: '4px 8px',
      background: BAR_BG,
      borderBottom: '2px solid ' + BAR_BORDER,
      zIndex: '2147483647',
      color: '#e9eaf1',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      userSelect: 'none',
      // hidden by default
      transform: `translateY(${-BAR_H}px)`,
      opacity: '0',
      transition: 'transform .16s ease, opacity .16s ease',
      // the bar surface itself is click-through
      pointerEvents: 'none',
    });

    // clickable controls container
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      width: '100%',
      pointerEvents: 'auto', // only this section captures clicks
    });

    // minimal icon button
    const makeBtn = (svgFactory, title, action) => {
      const b = document.createElement('button');
      b.title = title;
      const iconNode = svgFactory();
      b.appendChild(iconNode);
      Object.assign(b.style, {
        all: 'unset',
        cursor: 'pointer',
        width: '28px',
        height: '28px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '6px',
        color: ICON_OFF,
        pointerEvents: 'auto',
      });
      b.addEventListener('click', (e) => { e.stopPropagation(); action(); });
      b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.opacity = '0.9'; });
      b.addEventListener('mouseleave', () => { b.style.opacity = '1'; });
      b.addEventListener('mousedown',  () => { if (!b.disabled) b.style.opacity = '0.8'; });
      b.addEventListener('mouseup',    () => { b.style.opacity = '1'; });
      return b;
    };

    const backBtn = makeBtn(icoBack, 'Back', () => history.back());
    const fwdBtn  = makeBtn(icoFwd,  'Forward', () => history.forward());
    const refBtn  = makeBtn(icoRef,  'Refresh', () => location.reload());
    favBtn        = makeBtn(() => icoFav(false), 'Add to Favorites', toggleFavorite);
    // push favorites icon to the far right
    favBtn.style.marginLeft = 'auto';

    controls.append(backBtn, fwdBtn, refBtn, favBtn);
    bar.appendChild(controls);

    // --- small always-visible handle (top-left) ---
    const handle = document.createElement('button');
    handle.id = 'sf-handle';
    handle.setAttribute('aria-label', 'Show Navigation (Alt+S)');
    Object.assign(handle.style, {
      position: 'fixed',
      top: '6px',
      left: '8px',
      height: '24px',
      padding: '0 10px',
      borderRadius: '9999px',
      background: 'rgba(11,14,18,.85)',
      border: '1px solid ' + BAR_BORDER,
      color: '#e9eaf1',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '12px',
      lineHeight: '1',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      boxShadow: '0 4px 12px rgba(0,0,0,.25)',
      userSelect: 'none',
      opacity: '.85',
      backdropFilter: 'blur(2px)',
    });
    const chev = icoChevronDown();
    chev.setAttribute('width','14'); chev.setAttribute('height','14');
    handle.appendChild(chev);
    const hLabel = document.createElement('span');
    hLabel.textContent = 'Navigation';
    handle.appendChild(hLabel);
    handle.addEventListener('mouseenter', () => { handle.style.opacity = '1'; });
    handle.addEventListener('mouseleave', () => { handle.style.opacity = '.85'; });
    handle.addEventListener('click', (e) => { e.stopPropagation(); showBar(); scheduleHide(2500); });

    // Insert visual hint + hotzone + bar + handle (do NOT push the page down)
    document.body.prepend(hintStrip, hotzone, bar, handle);

    favorites = await loadFavs();

    // ---- autohide logic ----
    let hideTimer = null;
    const setHandleActive = (active) => {
      handle.style.transition = 'opacity .12s ease';
      handle.style.opacity = active ? '0' : '.85';
      handle.style.pointerEvents = active ? 'none' : 'auto';
    };
    const showBar = () => {
      clearTimeout(hideTimer);
      bar.style.transform = 'translateY(0)';
      bar.style.opacity = '1';
      setHandleActive(true);
      hintStrip.style.opacity = '0'; // hide strip while bar is visible
    };
    const scheduleHide = (delay = 900) => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        bar.style.transform = `translateY(${-BAR_H}px)`;
        bar.style.opacity = '0';
        setHandleActive(false);
        hintStrip.style.opacity = '.6'; // bring strip back
      }, delay);
    };

    // reveal on hover at very top
    hotzone.addEventListener('mouseenter', () => { hintStrip.style.opacity = '1'; showBar(); });
    // keep visible while hovering the bar
    bar.addEventListener('mouseenter', showBar);
    // hide after leaving the bar
    bar.addEventListener('mouseleave', () => scheduleHide());

    // keyboard toggle: Alt+S (matches your manifest)
    window.addEventListener('keydown', (e) => {
      if ((e.altKey || e.metaKey) && !e.ctrlKey && !e.shiftKey && e.code === 'KeyS') {
        const hidden = bar.style.opacity === '0';
        hidden ? showBar() : scheduleHide(0);
      }
      if (e.key === 'Escape') scheduleHide(0);
    }, { capture: true });

    // ---- enable/disable logic ----
    let guessedForward = false;

    const setEnabled = (el, on) => {
      el.disabled = !on;
      el.style.color = on ? ICON_ON : ICON_OFF;
      el.style.cursor = on ? 'pointer' : 'default';
      el.style.opacity = '1';
      // Disabled buttons are fully click-through to the page
      el.style.pointerEvents = on ? 'auto' : 'none';
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
      updateFavIcon();
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
        const ret = _push.apply(this, arguments);
        updateButtons();
        return ret;
      };
      history.replaceState = function () {
        const ret = _replace.apply(this, arguments);
        updateButtons();
        return ret;
      };
    };
    patchHistory();

    // Listen for SPA and BFCache navigations
    window.addEventListener('popstate', () => { updateButtons(); });
    window.addEventListener('pageshow', updateButtons);

    if (hasNavAPI) {
      const navUpdate = () => updateButtons();
      navigation.addEventListener?.('currententrychange', navUpdate);
      navigation.addEventListener?.('navigatesuccess',   navUpdate);
    }

    updateButtons();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY_FAVS]) {
        favorites = changes[KEY_FAVS].newValue || [];
        updateFavIcon();
      }
    });

    // keep UI if removed
    const mo = new MutationObserver(() => {
      const missingBar = !document.getElementById('sf-nav-bar');
      const missingHot = !document.body.contains(hotzone);
      const missingHint = !document.body.contains(hintStrip);
      const missingHandle = !document.getElementById('sf-handle');
      if (missingHint || missingHot || missingBar || missingHandle) {
        document.body.prepend(hintStrip, hotzone, bar, handle);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // One-time coachmark to teach the affordance
    maybeShowCoachmark();

    // Briefly show so users discover it
    showBar();
    scheduleHide(1400);
  }

  async function maybeShowCoachmark() {
    try {
      const seen = (await chrome.storage.local.get(KEY_HINT))[KEY_HINT];
      if (seen) return;
      const tip = document.createElement('div');
      tip.textContent = 'Hover the top edge or press Alt+S to show Navigation controls';
      Object.assign(tip.style, {
        position: 'fixed',
        left: '50%',
        bottom: '14px',
        transform: 'translateX(-50%)',
        background: 'rgba(11,14,18,.92)',
        color: '#e9eaf1',
        border: '1px solid #22283a',
        borderRadius: '10px',
        padding: '8px 12px',
        fontSize: '12px',
        zIndex: '2147483647',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity .2s ease',
      });
      document.body.appendChild(tip);
      requestAnimationFrame(() => { tip.style.opacity = '1'; });
      setTimeout(() => {
        tip.style.opacity = '0';
        setTimeout(() => tip.remove(), 200);
      }, 3200);
      await chrome.storage.local.set({ [KEY_HINT]: true });
    } catch {}
  }

  async function start() {
    await setup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

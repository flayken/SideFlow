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
  // when the document is destroyed (user closes panel, reloads, etc.)
  // Chrome will automatically disconnect this port, allowing the
  // service worker to react accordingly
  try {
    chrome.runtime.connect({ name: 'sf-panel' });
  } catch {}

  const BAR_H = 36;
  const BAR_BG = '#0b0e12';
  const BAR_BORDER = '#22283a';
  const ICON_ON = '#ffffff';
  const ICON_OFF = '#8b93a6';

  const KEY_FAVS = 'sideflow.favorites';

  function normalize(u) {
    try { return new URL(u).origin; } catch { return u; }
  }
  function labelFrom(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
  }
  async function loadFavs() {
    const r = await chrome.storage.local.get(KEY_FAVS);
    let list = r[KEY_FAVS] || [];
    const seen = new Set();
    list = list
      .map(f => ({ ...f, url: normalize(f.url) }))
      .filter(f => !seen.has(f.url) && seen.add(f.url));
    await saveFavs(list);
    return list;
  }
  async function saveFavs(v) {
    await chrome.storage.local.set({ [KEY_FAVS]: v });
  }

  let favorites = [];
  let favBtn;

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

  const icoBack   = () => makeSvg([{ d: 'M15 19l-7-7 7-7' }]);
  const icoFwd    = () => makeSvg([{ d: 'M9 5l7 7-7 7' }]);
  const icoRef    = () => makeSvg([
    { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
    { d: 'M21 3v7h-7' }
  ]);
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
    favBtn.title = isFav ? 'Remove Favorite' : 'Add to Favorites';
  }

  async function toggleFavorite() {
    const u = normalize(location.href);
    const isFav = favorites.some(f => f.url === u);
    if (isFav) {
      favorites = favorites.filter(f => f.url !== u);
    } else {
      favorites.unshift({ id: Date.now(), url: u, label: labelFrom(u) });
    }
    await saveFavs(favorites);
    updateFavIcon();
  }

  async function setup() {
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
      });
      b.addEventListener('click', action);
      return b;
    };

    const backBtn = makeBtn(icoBack, 'Back', () => history.back());
    const fwdBtn  = makeBtn(icoFwd,  'Forward', () => history.forward());
    const refBtn  = makeBtn(icoRef,  'Refresh', () => location.reload());
    favBtn        = makeBtn(() => icoFav(false), 'Add to Favorites', toggleFavorite);
    favBtn.style.marginLeft = 'auto';

    // default colors
    [backBtn, fwdBtn, refBtn, favBtn].forEach(b => {
      b.style.color = ICON_OFF;
      b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.opacity = '0.9'; });
      b.addEventListener('mouseleave', () => { b.style.opacity = '1'; });
      b.addEventListener('mousedown',  () => { if (!b.disabled) b.style.opacity = '0.8'; });
      b.addEventListener('mouseup',    () => { b.style.opacity = '1'; });
    });

    bar.append(backBtn, fwdBtn, refBtn, favBtn);
    document.body.style.marginTop = BAR_H + 'px';
    document.body.prepend(bar);

    favorites = await loadFavs();

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
    window.addEventListener('popstate', () => {
      updateButtons();
    });
    window.addEventListener('pageshow', updateButtons);

    if (hasNavAPI) {
      const navUpdate = () => updateButtons();
      navigation.addEventListener?.('currententrychange', navUpdate);
      navigation.addEventListener?.('navigatesuccess',    navUpdate);
    }

    updateButtons();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY_FAVS]) {
        const seen = new Set();
        favorites = (changes[KEY_FAVS].newValue || [])
          .map(f => ({ ...f, url: normalize(f.url) }))
          .filter(f => !seen.has(f.url) && seen.add(f.url));
        updateFavIcon();
      }
    });

    // keep bar if removed
    const mo = new MutationObserver(() => {
      if (!document.getElementById('sf-nav-bar')) {
        document.body.prepend(bar);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
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

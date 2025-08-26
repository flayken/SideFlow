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
  const icoBack = () => makeSvg([{ d: 'M15 19l-7-7 7-7' }]);
  const icoFwd  = () => makeSvg([{ d: 'M9 5l7 7-7 7' }]);
  const icoRef  = () => makeSvg([
    { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
    { d: 'M21 3v7h-7' }
  ]);

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

    // default colors
    [backBtn, fwdBtn, refBtn].forEach(b => {
      b.style.color = ICON_OFF;
      b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.opacity = '0.9'; });
      b.addEventListener('mouseleave', () => { b.style.opacity = '1'; });
      b.addEventListener('mousedown',  () => { if (!b.disabled) b.style.opacity = '0.8'; });
      b.addEventListener('mouseup',    () => { b.style.opacity = '1'; });
    });

    bar.append(backBtn, fwdBtn, refBtn);
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
      updateButtons();
    });
    window.addEventListener('pageshow', updateButtons);

    if (hasNavAPI) {
      const navUpdate = () => updateButtons();
      navigation.addEventListener?.('currententrychange', navUpdate);
      navigation.addEventListener?.('navigatesuccess', navUpdate);
    }

    updateButtons();

    // keep bar if removed
    const mo = new MutationObserver(() => {
      if (!document.getElementById('sf-nav-bar')) {
        document.body.prepend(bar);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function start() {
    setup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

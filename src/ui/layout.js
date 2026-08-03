/**
 * Everything that reacts to the shape of the screen: the page/ribbon score
 * mode, the hamburger menu, and the rotate-your-phone hint.
 *
 * Playback never depends on layout, so audio and the beat clock sail through
 * an orientation change; only the score re-renders around them.
 */

const MODES = ['page', 'ribbon'];
const MODE_KEY = 'sh-score-mode';
const PORTRAIT_OK_KEY = 'sh-portrait-ok';
/** Below this, a phone in portrait is too narrow for a four-voice system. */
const SMALL_SCREEN_PX = 500;
/** Settle time before re-rendering the score for a new viewport. */
const RESIZE_SETTLE_MS = 150;

/**
 * @param {object} opts
 * @param {import('../score.js').Score} opts.score
 * @param {ParentNode} [opts.root]
 */
export function createLayout({ score, root = document }) {
  const $ = (sel) => root.querySelector(sel);
  const modeBtn = $('#modeBtn');
  const menuBtn = $('#menuBtn');
  const menuPanel = $('#menuPanel');
  const menuTitle = $('#menuPanel .menu-title');
  const rotateHint = $('#rotateHint');
  let songOpen = false;

  // ---------- page / ribbon ----------
  /** The user's saved choice, else ribbon on a phone held sideways. */
  function preferredMode() {
    const saved = localStorage.getItem(MODE_KEY);
    if (MODES.includes(saved)) return saved;
    const landscapePhone = window.innerHeight < SMALL_SCREEN_PX
      && window.innerWidth > window.innerHeight;
    return landscapePhone ? 'ribbon' : 'page';
  }

  function applyModeUI(mode) {
    modeBtn.querySelector('.ic-ribbon').toggleAttribute('hidden', mode === 'ribbon');
    modeBtn.querySelector('.ic-page').toggleAttribute('hidden', mode !== 'ribbon');
  }

  function setMode(mode, remember) {
    score.setMode(mode); // re-renders if a song is loaded
    applyModeUI(mode);
    if (remember) localStorage.setItem(MODE_KEY, mode);
  }

  modeBtn.addEventListener('click', () => {
    setMode(score.mode === 'ribbon' ? 'page' : 'ribbon', true);
  });

  // ---------- hamburger menu (mobile chrome) ----------
  const closeMenu = () => document.body.classList.remove('menu-open');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('menu-open');
  });
  const onDocumentClick = (e) => {
    if (!document.body.classList.contains('menu-open')) return;
    if (menuPanel.contains(e.target) || menuBtn.contains(e.target)) return;
    closeMenu();
  };
  document.addEventListener('click', onDocumentClick);

  // ---------- rotate hint (small portrait touch screens) ----------
  function updateRotateHint() {
    const small = Math.min(window.innerWidth, window.innerHeight) < SMALL_SCREEN_PX;
    const portrait = window.innerHeight > window.innerWidth;
    const touch = 'ontouchstart' in window;
    const dismissed = sessionStorage.getItem(PORTRAIT_OK_KEY);
    rotateHint.toggleAttribute('hidden', !(songOpen && small && portrait && touch && !dismissed));
  }

  rotateHint.querySelector('button').addEventListener('click', () => {
    sessionStorage.setItem(PORTRAIT_OK_KEY, '1');
    rotateHint.hidden = true;
  });

  // ---------- viewport changes ----------
  // Unless the user explicitly chose a mode, follow the new orientation.
  let resizeTimer = null;
  function onViewportChange() {
    updateRotateHint();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!score.song) return;
      const want = preferredMode();
      if (want !== score.mode) setMode(want, false);
      else if (score.mode === 'ribbon') score.render(score.song); // re-fit the height
      else requestAnimationFrame(() => score.remeasure());
    }, RESIZE_SETTLE_MS);
  }

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

  return {
    /** Choose the mode for a song about to be rendered — set directly, since
     *  setMode() would re-render the song we are leaving. */
    prepareMode() {
      score.mode = preferredMode();
      applyModeUI(score.mode);
    },
    showSong(song) {
      songOpen = true;
      menuTitle.textContent = song.title;
      menuTitle.hidden = false;
      closeMenu();
      updateRotateHint();
    },
    showList() {
      songOpen = false;
      closeMenu();
      updateRotateHint();
    },
    /** Release the document- and window-level handlers. The app lives as long
     *  as the page does and never calls this; tests that re-mount the markup do. */
    destroy() {
      clearTimeout(resizeTimer);
      document.removeEventListener('click', onDocumentClick);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
    },
  };
}

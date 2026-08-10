/**
 * Everything that reacts to the shape of the screen: the page/ribbon score
 * mode, the ribbon's scroll style, the hardware-cutout insets, the hamburger
 * menu, and the rotate-your-phone hint.
 *
 * Playback never depends on layout, so audio and the beat clock sail through
 * an orientation change; only the score re-renders around them.
 */

/**
 * In landscape iOS reports the SAME horizontal safe-area inset on BOTH edges,
 * even though the Dynamic Island / notch is only ever on one of them. Taking
 * env() at face value pushes the floating controls inward on the clear side
 * too. So resolve the cutout to one edge from the rotation and publish
 * --pad-left / --pad-right; CSS and score.js use those, falling back to the
 * raw insets (both edges clear — never overlapped) if this never runs.
 *
 * Angle 90 = device turned counterclockwise, so its top edge — where the
 * camera lives — points LEFT; 270 (-90) points it right. Portrait keeps both
 * (the horizontal insets are 0 there anyway).
 */
export function applyCutoutInsets(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const left = cs.getPropertyValue('--safe-left').trim() || '0px';
  const right = cs.getPropertyValue('--safe-right').trim() || '0px';
  const raw = screen.orientation ? screen.orientation.angle : window.orientation;
  const angle = typeof raw === 'number' ? ((raw % 360) + 360) % 360 : null;
  const cutout = angle === 90 ? 'left' : angle === 270 ? 'right' : null;
  el.style.setProperty('--pad-left', cutout === 'right' ? '0px' : left);
  el.style.setProperty('--pad-right', cutout === 'left' ? '0px' : right);
}

const MODES = ['page', 'ribbon'];
const MODE_KEY = 'sh-score-mode';
/** How the ribbon follows playback. Continuous by default: steady motion is
 *  easier to read along with than a jump at every barline — the snap is kept
 *  for readers who prefer the music to hold still between measures. */
const SCROLL_STYLES = ['smooth', 'snap'];
const SCROLL_KEY = 'sh-ribbon-scroll';
const SCROLL_LABELS = { smooth: 'continuous', snap: 'measure by measure' };
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
  const scrollWrap = $('.scroll-wrap');
  const scrollStyleBtn = $('#scrollStyleBtn');
  let songOpen = false;

  applyCutoutInsets();

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
    // the scroll style only describes the ribbon; page mode has no use for it
    scrollWrap.toggleAttribute('hidden', mode !== 'ribbon');
  }

  // ---------- ribbon scroll style ----------
  function preferredScrollStyle() {
    const saved = localStorage.getItem(SCROLL_KEY);
    return SCROLL_STYLES.includes(saved) ? saved : 'smooth';
  }

  function setScrollStyle(style, remember) {
    score.setScrollStyle(style);
    scrollStyleBtn.textContent = SCROLL_LABELS[style];
    if (remember) localStorage.setItem(SCROLL_KEY, style);
  }

  setScrollStyle(preferredScrollStyle(), false);

  scrollStyleBtn.addEventListener('click', () => {
    setScrollStyle(score.scrollStyle === 'snap' ? 'smooth' : 'snap', true);
  });

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
    applyCutoutInsets(); // before the debounce: the controls must not lag the rotation
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

/** @jest-environment jsdom */

/**
 * Everything that reacts to the shape of the screen.
 *
 * The score mode is the app's biggest phone affordance — ribbon by default in
 * landscape, page everywhere else — and it is easy to break invisibly, because
 * on a desktop dev machine every path returns 'page' anyway.
 */
import { mountApp } from '../../test/appMarkup.js';
import { createLayout } from './layout.js';

/** Enough of a Score for the layout to talk to. */
function fakeScore() {
  return {
    mode: 'page',
    scrollStyle: 'smooth',
    song: null,
    renders: 0,
    remeasures: 0,
    setScrollStyle(style) { this.scrollStyle = style; },
    setMode(mode) { this.mode = mode; if (this.song) this.renders++; },
    render() { this.renders++; },
    remeasure() { this.remeasures++; },
  };
}

const viewport = (width, height) => {
  window.innerWidth = width;
  window.innerHeight = height;
};

const PHONE_LANDSCAPE = [800, 400];
const PHONE_PORTRAIT = [400, 800];
const DESKTOP = [1400, 900];

let score;
let mounted = [];

function mount(size = DESKTOP) {
  viewport(...size);
  mountApp();
  score = fakeScore();
  const layout = createLayout({ score });
  mounted.push(layout);
  return layout;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = '';
  delete window.ontouchstart;
});

afterEach(() => {
  // these modules listen on document/window; a re-mount must not leave the
  // previous instance answering clicks for markup that is gone
  for (const layout of mounted) layout.destroy();
  mounted = [];
});

describe('score mode', () => {
  it('opens a phone held sideways in ribbon mode', () => {
    const layout = mount(PHONE_LANDSCAPE);

    layout.prepareMode();

    expect(score.mode).toBe('ribbon');
    expect(document.querySelector('.ic-page').hasAttribute('hidden')).toBe(false);
  });

  it('opens in page mode on a phone held upright and on a desktop', () => {
    for (const size of [PHONE_PORTRAIT, DESKTOP]) {
      const layout = mount(size);
      layout.prepareMode();
      expect(score.mode).toBe('page');
    }
  });

  it('honors a saved choice over the orientation', () => {
    localStorage.setItem('sh-score-mode', 'page');
    const layout = mount(PHONE_LANDSCAPE);

    layout.prepareMode();

    expect(score.mode).toBe('page');
  });

  it('ignores a junk saved value rather than rendering a mode nobody has', () => {
    localStorage.setItem('sh-score-mode', 'accordion');
    const layout = mount(DESKTOP);

    layout.prepareMode();

    expect(score.mode).toBe('page');
  });

  it('remembers the mode the user picks from the button', () => {
    mount(DESKTOP);

    document.querySelector('#modeBtn').click();

    expect(score.mode).toBe('ribbon');
    expect(localStorage.getItem('sh-score-mode')).toBe('ribbon');
    expect(document.querySelector('.ic-ribbon').hasAttribute('hidden')).toBe(true);

    document.querySelector('#modeBtn').click();

    expect(score.mode).toBe('page');
    expect(localStorage.getItem('sh-score-mode')).toBe('page');
  });

  it('does not set the mode before the song it is about to render', () => {
    // prepareMode() must NOT go through setMode(), which would re-render the
    // song the user is leaving.
    const layout = mount(PHONE_LANDSCAPE);
    score.song = { title: 'previous hymn' };

    layout.prepareMode();

    expect(score.renders).toBe(0);
  });
});

describe('turning the phone mid-song', () => {
  jest.useFakeTimers();

  const rotate = (size) => {
    viewport(...size);
    window.dispatchEvent(new Event('orientationchange'));
    jest.advanceTimersByTime(200);
  };

  it('follows the new orientation into ribbon mode, without saving it', () => {
    mount(PHONE_PORTRAIT);
    score.song = { title: 'open hymn' };

    rotate(PHONE_LANDSCAPE);

    expect(score.mode).toBe('ribbon');
    expect(localStorage.getItem('sh-score-mode')).toBeNull();
  });

  it('leaves a user who picked a mode in that mode', () => {
    localStorage.setItem('sh-score-mode', 'page');
    mount(PHONE_PORTRAIT);
    score.song = { title: 'open hymn' };

    rotate(PHONE_LANDSCAPE);

    expect(score.mode).toBe('page');
  });

  it('re-fits the ribbon to the new viewport height', () => {
    localStorage.setItem('sh-score-mode', 'ribbon');
    mount(PHONE_LANDSCAPE);
    score.mode = 'ribbon';
    score.song = { title: 'open hymn' };

    rotate([700, 380]);

    expect(score.renders).toBe(1);
  });

  it('does nothing at all with no song open', () => {
    mount(PHONE_PORTRAIT);

    rotate(PHONE_LANDSCAPE);

    expect(score.renders).toBe(0);
    expect(score.remeasures).toBe(0);
  });
});

describe('rotate-to-landscape hint', () => {
  const hint = () => document.querySelector('#rotateHint');

  it('asks a phone in portrait to turn, once a song is open', () => {
    window.ontouchstart = null; // a touch screen
    const layout = mount(PHONE_PORTRAIT);

    expect(hint().hidden).toBe(true); // still on the song list

    layout.showSong({ title: 'Amazing Grace' });
    expect(hint().hidden).toBe(false);

    layout.showList();
    expect(hint().hidden).toBe(true);
  });

  it('never bothers a desktop or a landscape phone', () => {
    window.ontouchstart = null;
    for (const size of [DESKTOP, PHONE_LANDSCAPE]) {
      const layout = mount(size);
      layout.showSong({ title: 'Amazing Grace' });
      expect(hint().hidden).toBe(true);
    }
  });

  it('never bothers a small window that has no touch screen', () => {
    const layout = mount(PHONE_PORTRAIT);

    layout.showSong({ title: 'Amazing Grace' });

    expect(hint().hidden).toBe(true);
  });

  it('stays gone for the session once dismissed', () => {
    window.ontouchstart = null;
    const layout = mount(PHONE_PORTRAIT);
    layout.showSong({ title: 'Amazing Grace' });

    hint().querySelector('button').click();
    expect(hint().hidden).toBe(true);

    const next = mount(PHONE_PORTRAIT);
    next.showSong({ title: 'It Is Well' });
    expect(hint().hidden).toBe(true);
  });
});

describe('hamburger menu', () => {
  it('opens on the button and closes on a click outside it', () => {
    mount(PHONE_PORTRAIT);

    document.querySelector('#menuBtn').click();
    expect(document.body.classList.contains('menu-open')).toBe(true);

    document.querySelector('#tempo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.classList.contains('menu-open')).toBe(true); // inside the panel

    document.querySelector('#scoreWrap').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.classList.contains('menu-open')).toBe(false);
  });

  it('closes on the way back to the list, so the next song opens clean', () => {
    const layout = mount(PHONE_PORTRAIT);
    layout.showSong({ title: 'Amazing Grace' });
    document.querySelector('#menuBtn').click();

    layout.showList();

    expect(document.body.classList.contains('menu-open')).toBe(false);
  });

  it('closes when a song opens, so the score is not left behind a panel', () => {
    const layout = mount(PHONE_PORTRAIT);
    document.querySelector('#menuBtn').click();

    layout.showSong({ title: 'Amazing Grace' });

    expect(document.body.classList.contains('menu-open')).toBe(false);
    expect(document.querySelector('#menuPanel .menu-title').textContent).toBe('Amazing Grace');
  });
});

describe('hardware cutout', () => {
  /** iOS reports the notch depth on BOTH landscape edges; the app has to pick. */
  const symmetricInsets = () => {
    document.documentElement.style.setProperty('--safe-left', '59px');
    document.documentElement.style.setProperty('--safe-right', '59px');
  };
  const rotate = (angle) => {
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true, value: { angle },
    });
  };
  const pads = () => [
    document.documentElement.style.getPropertyValue('--pad-left'),
    document.documentElement.style.getPropertyValue('--pad-right'),
  ];

  beforeEach(() => { document.documentElement.removeAttribute('style'); });

  it('keeps the controls off a cutout on the left', () => {
    symmetricInsets();
    rotate(90);

    mount(PHONE_LANDSCAPE);

    expect(pads()).toEqual(['59px', '0px']);
  });

  it('leaves the left edge alone when the cutout is on the right', () => {
    symmetricInsets();
    rotate(270);

    mount(PHONE_LANDSCAPE);

    expect(pads()).toEqual(['0px', '59px']);
  });

  it('accepts the legacy -90', () => {
    symmetricInsets();
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true, value: { angle: -90 },
    });

    mount(PHONE_LANDSCAPE);

    expect(pads()).toEqual(['0px', '59px']);
  });

  it('re-resolves the side on rotation', () => {
    symmetricInsets();
    rotate(90);
    mount(PHONE_LANDSCAPE);

    rotate(270);
    window.dispatchEvent(new Event('orientationchange'));

    expect(pads()).toEqual(['0px', '59px']);
  });

  it('stays clear of both edges when the rotation is unknown', () => {
    symmetricInsets();
    rotate(0);

    mount(PHONE_PORTRAIT);

    expect(pads()).toEqual(['59px', '59px']);
  });
});

describe('ribbon scroll style', () => {
  const btn = () => document.querySelector('#scrollStyleBtn');

  it('follows the music continuously unless the reader says otherwise', () => {
    mount(PHONE_LANDSCAPE);

    expect(score.scrollStyle).toBe('smooth');
    expect(btn().textContent).toBe('continuous');
  });

  it('switches to the measure snap and remembers it', () => {
    mount(PHONE_LANDSCAPE);

    btn().click();

    expect(score.scrollStyle).toBe('snap');
    expect(btn().textContent).toBe('measure by measure');
    expect(localStorage.getItem('sh-ribbon-scroll')).toBe('snap');
  });

  it('opens the next visit on the saved style', () => {
    localStorage.setItem('sh-ribbon-scroll', 'snap');

    mount(PHONE_LANDSCAPE);

    expect(score.scrollStyle).toBe('snap');
    expect(btn().textContent).toBe('measure by measure');
  });

  it('toggles back, and remembers that too', () => {
    localStorage.setItem('sh-ribbon-scroll', 'snap');
    mount(PHONE_LANDSCAPE);

    btn().click();

    expect(score.scrollStyle).toBe('smooth');
    expect(localStorage.getItem('sh-ribbon-scroll')).toBe('smooth');
  });

  it('ignores a garbage saved value', () => {
    localStorage.setItem('sh-ribbon-scroll', 'sideways');

    mount(PHONE_LANDSCAPE);

    expect(score.scrollStyle).toBe('smooth');
  });

  it('is offered in ribbon mode only — page mode never scrolls sideways', () => {
    const layout = mount(PHONE_LANDSCAPE);
    layout.prepareMode();
    expect(document.querySelector('.scroll-wrap').hasAttribute('hidden')).toBe(false);

    document.querySelector('#modeBtn').click();

    expect(score.mode).toBe('page');
    expect(document.querySelector('.scroll-wrap').hasAttribute('hidden')).toBe(true);
  });
});

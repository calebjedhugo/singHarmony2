/** @jest-environment jsdom */

/**
 * The app shell, booted the way the browser boots it.
 *
 * main.js is a module with side effects: importing it wires the real Player,
 * Score and the three UI factories to the real index.html and then routes off
 * `?song=`. Everything it owns is a single line that fails silently — the hymn
 * that never gets fetched, the view that never gets un-hidden, the URL that
 * stops matching the page, the eager piano warm-up nobody notices is gone
 * until the first play tap takes a second. So these boot the shell and read
 * the page, rather than reaching into the modules underneath it.
 */
import { mountApp } from '../test/appMarkup.js';

const SONGS = {
  'amazing-grace': {
    title: 'Amazing Grace',
    slug: 'amazing-grace',
    timeSignature: [3, 4],
    keySignature: 'F',
    tempo: 92,
    voices: [
      { id: 'soprano', notes: Array.from({ length: 6 }, () => ({ pitch: 'C5', length: '1/4' })) },
      { id: 'bass', notes: Array.from({ length: 6 }, () => ({ pitch: 'C3', length: '1/4' })) },
    ],
  },
  'silent-night': {
    title: 'Silent Night',
    slug: 'silent-night',
    timeSignature: [6, 8],
    keySignature: 'Bb',
    tempo: 60,
    voices: [
      { id: 'soprano', notes: Array.from({ length: 6 }, () => ({ pitch: 'D5', length: '1/4' })) },
      { id: 'bass', notes: Array.from({ length: 6 }, () => ({ pitch: 'G3', length: '1/4' })) },
    ],
  },
};

const INDEX = Object.values(SONGS).map((s) => ({
  slug: s.slug, title: s.title, category: null, key: s.keySignature, timeSignature: s.timeSignature,
}));

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });

/** Let the boot's fetch chain (index, then the route's song) run to the end. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => { setTimeout(resolve, 0); });
};

/**
 * Load the page at `url` and run its boot. Returns main.js's own debugging
 * handle, which is the only seam the shell exposes.
 *
 * Each boot leaves its `popstate` listener on the shared window — the shell
 * has no teardown, because in a browser it lives exactly as long as the page.
 * Earlier boots therefore re-route alongside the current one, against the same
 * fetch stub and the same URL, so they reach the same answer. Assert on the
 * page (views, titles, the URL), not on a previous boot's objects.
 */
async function boot({ url = '/', indexFails = false } = {}) {
  window.history.replaceState({}, '', url);
  mountApp();
  global.fetch = jest.fn((path) => {
    if (path === '/songs/index.json') return indexFails ? notFound() : json({ songs: INDEX });
    const slug = path.replace('/songs/', '').replace('.json', '');
    return SONGS[slug] ? json(SONGS[slug]) : notFound();
  });
  jest.resetModules();
  await import('./main.js');
  await settle();
  return window.__sh;
}

const $ = (sel) => document.querySelector(sel);
const showing = () => ({ list: !$('#listView').hidden, song: !$('#songView').hidden });
const listTitles = () => [...document.querySelectorAll('.song-title')].map((el) => el.textContent);

afterEach(() => {
  delete global.fetch;
  window.history.replaceState({}, '', '/');
});

describe('the song list and the way in and out of a hymn', () => {
  it('opens on the list, opens the hymn that was clicked, and comes back', async () => {
    await boot();

    expect(showing()).toEqual({ list: true, song: false });
    expect(listTitles()).toEqual(['Amazing Grace', 'Silent Night']);

    document.querySelectorAll('#songList button')[1].click();
    await settle();

    expect(showing()).toEqual({ list: false, song: true });
    expect($('#songTitle').textContent).toBe('Silent Night');
    expect($('#songMeta').textContent).toBe('Bb · 6/8');
    expect(document.querySelectorAll('#score svg [data-beat]').length).toBeGreaterThan(0);
    expect(location.search).toBe('?song=silent-night');
    expect(document.title).toBe('Silent Night · How to Sing Harmony');

    $('#backBtn').click();

    expect(showing()).toEqual({ list: true, song: false });
    expect(location.search).toBe('');
    expect(document.title).toBe('How to Sing Harmony');
  });

  it('goes back from the menu link too, not just the topbar arrow', async () => {
    // On a phone the topbar is hidden entirely, so #backBtn2 in the hamburger
    // is the ONLY way out of a hymn.
    await boot({ url: '/?song=amazing-grace' });
    expect(showing()).toEqual({ list: false, song: true });

    $('#backBtn2').click();

    expect(showing()).toEqual({ list: true, song: false });
    expect(location.search).toBe('');
  });

  it('opens straight into a bookmarked hymn', async () => {
    await boot({ url: '/?song=amazing-grace' });

    expect(showing()).toEqual({ list: false, song: true });
    expect($('#songTitle').textContent).toBe('Amazing Grace');
    expect($('#songMeta').textContent).toBe('F · 3/4');
    expect(location.search).toBe('?song=amazing-grace'); // the boot route must not re-push
  });

  it('unhides the song view before engraving it', async () => {
    // The ribbon render measures its own probe SVG with getBBox(), which
    // reads 0 inside a display:none subtree and collapses the score to a
    // sliver. Page mode self-heals through the renderer's ResizeObserver;
    // ribbon opts out of it, so a hidden-at-render boot stayed broken. jsdom's
    // getBBox is always 0, so the collapse itself is invisible here — the
    // ORDER is not: the view must already be visible when render() runs.
    window.history.replaceState({}, '', '/?song=amazing-grace');
    mountApp();
    global.fetch = jest.fn((path) => {
      if (path === '/songs/index.json') return json({ songs: INDEX });
      const slug = path.replace('/songs/', '').replace('.json', '');
      return SONGS[slug] ? json(SONGS[slug]) : notFound();
    });
    jest.resetModules();
    const hiddenAtRender = [];
    jest.doMock('./score.js', () => {
      const real = jest.requireActual('./score.js');
      class Score extends real.Score {
        render(song) {
          hiddenAtRender.push(document.querySelector('#songView').hidden);
          return super.render(song);
        }
      }
      return { ...real, Score };
    });
    try {
      await import('./main.js');
      await settle();
    } finally {
      jest.dontMock('./score.js');
    }

    expect(hiddenAtRender).toEqual([false]);
  });

  it('falls back to the list for a slug it cannot read, keeping the link', async () => {
    // A renamed hymn or a dead connection — the alternative is a blank song
    // view. The dead ?song= stays in the address bar on purpose: fetchSong()
    // cannot tell "no such hymn" from "offline", and keeping the link is what
    // makes a reload retry the hymn instead of quietly forgetting it.
    await boot({ url: '/?song=gone-forever' });

    expect(showing()).toEqual({ list: true, song: false });
    expect(listTitles()).toEqual(['Amazing Grace', 'Silent Night']);
    expect(location.search).toBe('?song=gone-forever');
  });

  it('re-routes on the browser Back button without pushing history again', async () => {
    await boot({ url: '/?song=amazing-grace' });

    window.history.pushState({}, '', '/'); // the browser stepping back to the list
    const before = history.length;
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(showing()).toEqual({ list: true, song: false });
    expect(history.length).toBe(before);
  });

  it('says the hymn list would not load instead of showing an empty hymnal', async () => {
    await boot({ indexFails: true });

    expect($('#songList').textContent).toMatch(/could not load/i);
    expect(document.querySelectorAll('.song-item')).toHaveLength(0);
    expect(showing()).toEqual({ list: true, song: false });
  });
});

describe('the shell wiring underneath the views', () => {
  it('leads the playback cursor by 100ms of real time, and only while playing', async () => {
    // The highlight has a 100ms CSS transition; lit at the onset it is still
    // fading in when the note sounds. Paused (a click-to-seek, a scrub) there
    // is nothing to anticipate and the cursor must land exactly on the beat.
    const { player, score } = await boot({ url: '/?song=amazing-grace' });

    player.onTick(2);
    expect(score.lastBeat).toBe(2);

    await player.play();
    const seen = jest.spyOn(score, 'setCursor');
    player.onTick(3);
    const led = seen.mock.calls.at(-1)[0]; // read before pause can tick again
    player.pause();

    // 92bpm → 0.652s per beat, so 100ms is a shade over an eighth of a beat
    expect(led).toBeCloseTo(3 + 0.1 / player.secPerBeat(3), 6);
  });

  it('warms the piano while the reader is still on the list', async () => {
    // The whole ~2ms play-tap latency story is this one call at boot; without
    // it every first tap pays for the pre-render and nothing else fails.
    const { player } = await boot();

    for (let i = 0; i < 1500 && !player.piano; i++) { // poll within the test's own budget
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }

    expect(player.piano).not.toBeNull();
    expect(player.warmed.has('Eb4')).toBe(true);
  }, 20000);
});

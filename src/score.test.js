/** @jest-environment jsdom */

/**
 * Score's measure grid — the app's half of resound-notation's pickup support.
 *
 * gridStart/measureAt mirror the library's lib/measureGrid.js, and four
 * behaviors read them: absolute beat recovery after a render (data-beat is
 * system-relative), click-to-seek quantizing, ribbon follow, and drag-scrub.
 * When these drift from the library, seeks land between beats in every song
 * with a pickup — which is half the hymnal.
 *
 * The grid and the page-mode paths are covered here. Ribbon follow and
 * drag-scrub are NOT: they are pure layout geometry over element bounding
 * boxes, and jsdom reports every box as zero, so a test could only assert
 * against a faked layout. They need a real browser.
 */
import { NotationRenderer } from 'resound-notation';
import { Score } from './score.js';

/** A quarter note on `pitch`, or a quarter rest when pitch is omitted. */
const q = (pitch) => (pitch ? { pitch, length: '1/4' } : { length: '1/4' });

/**
 * 4/4, one beat of pickup, two full measures, then a 3-beat final measure —
 * the shape the converter emits for a hymn like America the Beautiful
 * (pickup + final measure = one full measure).
 */
function pickupSong() {
  const line = (p) => [q(p), q(p), q(p), q(p), q(p), q(p), q(p), q(p), q(p), q(p), q(p), q(p)];
  return {
    title: 'Pickup', slug: 'pickup', timeSignature: [4, 4], keySignature: 'C',
    tempo: 100, pickupBeats: 1,
    voices: [{ id: 'soprano', notes: line('C5') }, { id: 'bass', notes: line('C3') }],
  };
}

/** The same music with no anacrusis: barlines fall on multiples of 4. */
function plainSong() {
  const song = pickupSong();
  delete song.pickupBeats;
  return song;
}

function mount() {
  document.body.innerHTML = '<div id="scoreWrap"><div id="score"></div></div>';
  return document.querySelector('#score');
}

describe('Score measure grid', () => {
  it('puts the pickup in measure 0 and shifts every later measure', () => {
    const score = new Score(mount());
    score.song = pickupSong();

    expect(score.measureBeats).toBe(4);
    expect([0, 1, 2, 3, 4].map((m) => score.gridStart(m))).toEqual([0, 1, 5, 9, 13]);
  });

  it('reduces to plain measures when there is no pickup', () => {
    const score = new Score(mount());
    score.song = plainSong();

    expect([0, 1, 2, 3, 4].map((m) => score.gridStart(m))).toEqual([0, 4, 8, 12, 16]);
  });

  it('reads back the measure a beat belongs to, boundaries opening the measure', () => {
    const score = new Score(mount());
    score.song = pickupSong();

    expect(score.measureAt(0)).toBe(0);
    expect(score.measureAt(0.5)).toBe(0);
    expect(score.measureAt(1)).toBe(1); // the barline opens measure 1
    expect(score.measureAt(4.99)).toBe(1);
    expect(score.measureAt(5)).toBe(2);
    expect(score.measureAt(9)).toBe(3);
  });

  it('round-trips: the start of measure m is in measure m', () => {
    const score = new Score(mount());
    for (const song of [pickupSong(), plainSong()]) {
      score.song = song;
      for (let m = 0; m < 8; m++) {
        expect(score.measureAt(score.gridStart(m))).toBe(m);
      }
    }
  });

  it('handles a half-beat pickup (6/8 songs like The Old Rugged Cross)', () => {
    const score = new Score(mount());
    score.song = { ...pickupSong(), timeSignature: [6, 8], pickupBeats: 0.5 };

    expect(score.measureBeats).toBe(3);
    expect([0, 1, 2, 3].map((m) => score.gridStart(m))).toEqual([0, 0.5, 3.5, 6.5]);
    expect(score.measureAt(0.4)).toBe(0);
    expect(score.measureAt(0.5)).toBe(1);
    expect(score.measureAt(3.6)).toBe(2);
  });
});

describe('Score rendering against the grid', () => {
  it('recovers absolute beats from system-relative data-beat', () => {
    // The renderer restarts data-beat per system, so Score adds the system's
    // start beat back on — through gridStart, or pickup songs come out a
    // measure-minus-a-pickup off on every system after the first.
    const score = new Score(mount());
    score.render(pickupSong());

    const soprano = [...document.querySelectorAll('[data-voice-id="soprano"] [data-abs-beat]')]
      .map((el) => Number(el.dataset.absBeat))
      .sort((a, b) => a - b);

    expect(soprano.length).toBeGreaterThan(0);
    expect(soprano).toEqual([...Array(soprano.length).keys()]); // 0,1,2,… one per quarter
  });

  it('quantizes a click to its measure downbeat, pickup included', () => {
    const seeks = [];
    const score = new Score(mount(), { onSeek: (beat) => seeks.push(beat) });
    score.render(pickupSong());

    const clickBeat = (beat) => {
      const el = [...document.querySelectorAll('[data-abs-beat]')]
        .find((e) => Number(e.dataset.absBeat) === beat);
      expect(el).toBeDefined();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };

    clickBeat(0); // the pickup note itself
    clickBeat(3); // mid measure 1
    clickBeat(6); // mid measure 2
    clickBeat(9); // downbeat of measure 3

    expect(seeks).toEqual([0, 1, 5, 9]);
  });

  it('quantizes to plain barlines when the song has no pickup', () => {
    const seeks = [];
    const score = new Score(mount(), { onSeek: (beat) => seeks.push(beat) });
    score.render(plainSong());

    const el = [...document.querySelectorAll('[data-abs-beat]')]
      .find((e) => Number(e.dataset.absBeat) === 6);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seeks).toEqual([4]);
  });

  it('hands the song pickup through to the renderer', () => {
    const spy = jest.spyOn(NotationRenderer.prototype, 'render');
    const score = new Score(mount());
    score.render(pickupSong());

    expect(spy.mock.calls[0][0].pickupBeats).toBe(1);
    spy.mockRestore();
  });

  it('omits pickupBeats entirely for a song without one', () => {
    // Passing `pickupBeats: undefined` would be indistinguishable here, but
    // not in the library — it validates the key whenever it is present.
    const spy = jest.spyOn(NotationRenderer.prototype, 'render');
    const score = new Score(mount());
    score.render(plainSong());

    expect('pickupBeats' in spy.mock.calls[0][0]).toBe(false);
    spy.mockRestore();
  });

  it('opens a different hymn on all verses, but keeps the pick on a re-render', () => {
    // The verse picker is per hymn: carrying verse 3 into the next song shows
    // a page of empty staves. Mode flips and viewport re-fits re-render the
    // SAME song object, and those must not throw the reader's choice away.
    const score = new Score(mount());
    score.render(pickupSong());
    score.setVerse(1);

    score.render(score.song); // resize / mode flip
    expect(score.verseFilter).toBe(1);

    score.render(pickupSong()); // the next hymn off the list
    expect(score.verseFilter).toBe('all');
  });

  it('leaves the previous hymn\'s cursor and scroll position behind', () => {
    // _autoScroll only moves the page when the cursor enters a system it has
    // not scrolled to yet. Both hymns start on system 0, so a system key that
    // outlives the song opens the new hymn still scrolled to wherever the
    // reader left the old one.
    const scrolled = jest.spyOn(Element.prototype, 'scrollIntoView');
    const score = new Score(mount());

    score.render(pickupSong());
    score.setCursor(0, true);
    expect(scrolled).toHaveBeenCalledTimes(1);

    score.render(pickupSong()); // the next hymn off the list
    expect(score.lastBeat).toBe(-1); // its staves open with no cursor on them

    score.setCursor(0, true); // ...until playback parks on its own first beat
    expect(scrolled).toHaveBeenCalledTimes(2);

    scrolled.mockRestore();
  });

  it('lets the library reject a pickup the voices do not fill', () => {
    // resound-notation VALIDATES pickupBeats, so bad data fails loudly at
    // render rather than engraving a wrong measure.
    const score = new Score(mount());
    const broken = pickupSong();
    broken.voices[0].notes = [{ pitch: 'C5', length: '1/2' }, ...broken.voices[0].notes.slice(2)];

    expect(() => score.render(broken)).toThrow(/pickup/i);
  });
});

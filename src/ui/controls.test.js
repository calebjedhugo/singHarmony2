/** @jest-environment jsdom */

/**
 * The transport row, driven the way a singer drives it: through the real
 * buttons in index.html, against a real Player and a real Score.
 *
 * These are the wires main.js used to hold. Each assertion is a control the
 * app would silently lose if the wire came loose — a play button that no
 * longer swaps to pause, a tempo reset that resets the slider but not the
 * clock, a mute chip that dims the notes without silencing them.
 */
import { mountApp } from '../../test/appMarkup.js';
import { Player } from '../player.js';
import { Score } from '../score.js';
import { createControls } from './controls.js';

const q = (pitch, lyric) => (lyric === undefined ? { pitch, length: '1/4' } : { pitch, length: '1/4', lyric });

/** Eight quarters per voice at 100bpm; the soprano carries `verses` verses. */
function song({ verses = 1, tempo = 100 } = {}) {
  const syllable = (i) => (verses === 1 ? `la${i}` : Array.from({ length: verses }, (_, v) => `v${v + 1}-${i}`));
  return {
    title: 'Test Hymn',
    slug: 'test-hymn',
    timeSignature: [4, 4],
    keySignature: 'C',
    tempo,
    voices: [
      { id: 'soprano', notes: Array.from({ length: 8 }, (_, i) => q('C5', syllable(i))) },
      { id: 'bass', notes: Array.from({ length: 8 }, () => q('C3')) },
    ],
  };
}

let player;
let score;
let controls;

function open(data = song()) {
  mountApp();
  player = new Player();
  score = new Score(document.querySelector('#score'));
  controls = createControls({ player, score });
  player.load(data);
  score.render(data);
  controls.showSong(data);
  return data;
}

const click = (sel) => document.querySelector(sel).click();
const isHidden = (sel) => document.querySelector(sel).hasAttribute('hidden');
const pressSpace = (target = document.body) => {
  const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => {
  // the keydown listener lives on document; a re-mount must not leave the
  // previous instance answering the space bar for a player that is gone
  if (controls) controls.destroy();
});

describe('play control', () => {
  it('starts the music and turns the button into a pause button', async () => {
    open();

    expect(isHidden('.ic-pause')).toBe(true);
    click('#playBtn');
    await new Promise((resolve) => setTimeout(resolve, 0)); // let ensurePiano settle

    expect(player.playing).toBe(true);
    expect(isHidden('.ic-play')).toBe(true);
    expect(isHidden('.ic-pause')).toBe(false);
    expect(document.querySelector('#playBtn').classList.contains('is-playing')).toBe(true);
  });

  it('spins on the button while the piano is still rendering, then plays', async () => {
    // The piano is warmed at page load, but a tap can beat it there; play()
    // waits for that init, and the button has to show the wait.
    open();
    let ready;
    jest.spyOn(player, 'play').mockReturnValue(new Promise((resolve) => { ready = resolve; }));

    click('#playBtn');

    expect(isHidden('.ic-loading')).toBe(false);
    expect(isHidden('.ic-play')).toBe(true);
    expect(isHidden('.ic-pause')).toBe(true);
    expect(document.querySelector('#playBtn').getAttribute('aria-busy')).toBe('true');

    ready();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isHidden('.ic-loading')).toBe(true);
    expect(isHidden('.ic-pause')).toBe(false);
    expect(document.querySelector('#playBtn').getAttribute('aria-busy')).toBe('false');
  });

  it('ignores further taps while the piano is still rendering', async () => {
    open();
    let ready;
    jest.spyOn(player, 'play').mockReturnValue(new Promise((resolve) => { ready = resolve; }));

    click('#playBtn');
    click('#playBtn'); // an impatient second tap
    pressSpace();

    expect(player.play).toHaveBeenCalledTimes(1);

    ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isHidden('.ic-pause')).toBe(false); // one play, not two
  });

  it('stops spinning if the piano never comes up', async () => {
    open();
    jest.spyOn(player, 'play').mockRejectedValue(new Error('no AudioContext'));

    click('#playBtn');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(isHidden('.ic-loading')).toBe(true);
    expect(isHidden('.ic-play')).toBe(false); // usable again, not stuck
  });


  it('goes back to a play button when the song ends', () => {
    open();
    controls.showSong(song()); // playing UI starts clean

    player.onEnd();

    expect(isHidden('.ic-play')).toBe(false);
    expect(isHidden('.ic-pause')).toBe(true);
  });

  it('plays and pauses from the space bar', async () => {
    open();

    expect(pressSpace().defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(player.playing).toBe(true);

    pressSpace();
    expect(player.playing).toBe(false);
  });

  it('leaves the space bar alone in the search box and on the song list', async () => {
    open();
    const typing = pressSpace(document.querySelector('#search'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(typing.defaultPrevented).toBe(false);
    expect(player.playing).toBe(false);

    controls.hideSong(); // back to the list
    expect(pressSpace().defaultPrevented).toBe(false);
    expect(player.playing).toBe(false);
  });

  it('stops the music on the way back to the list', async () => {
    open();
    click('#playBtn');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(player.playing).toBe(true);

    controls.hideSong();

    expect(player.playing).toBe(false);
    expect(isHidden('.ic-pause')).toBe(true);
  });
});

describe('tempo control', () => {
  it('opens on the song tempo and drives the clock from the slider', () => {
    open(song({ tempo: 96 }));

    expect(document.querySelector('#tempo').value).toBe('96');
    expect(document.querySelector('#tempoVal').textContent).toBe('96');
    expect(player.bpm).toBe(96);

    const slider = document.querySelector('#tempo');
    slider.value = '150';
    slider.dispatchEvent(new Event('input'));

    expect(player.bpm).toBe(150);
    expect(document.querySelector('#tempoVal').textContent).toBe('150');
  });

  it('puts the slider AND the clock back on the song tempo', () => {
    open(song({ tempo: 96 }));
    const slider = document.querySelector('#tempo');
    slider.value = '150';
    slider.dispatchEvent(new Event('input'));

    click('#tempoReset');

    expect(player.bpm).toBe(96);
    expect(slider.value).toBe('96');
    expect(document.querySelector('#tempoVal').textContent).toBe('96');
  });
});

describe('A-B loop control', () => {
  it('lights each end as it is set and tints the looped notes', () => {
    open();

    player.seek(2);
    click('#loopA');
    expect(document.querySelector('#loopA').classList.contains('loop-set')).toBe(true);
    expect(isHidden('#loopClear')).toBe(false);
    expect(document.querySelectorAll('#score .in-loop')).toHaveLength(0); // no range yet

    player.seek(6);
    click('#loopB');

    expect(player.looping).toBe(true);
    expect(document.querySelector('#loopB').classList.contains('loop-set')).toBe(true);
    expect(document.querySelectorAll('#score .in-loop').length).toBeGreaterThan(0);
  });

  it('rewinds to A when B is set, so the loop is audible immediately', () => {
    open();

    player.seek(2);
    click('#loopA');
    player.seek(6);
    click('#loopB');

    expect(player.beat).toBe(2);
  });

  it('leaves both buttons dark, and playback put, when B lands at the top', () => {
    // Tapping B at the very top of the hymn cannot make a loop. The A button
    // must not light for one the singer never set, the ✕ must stay hidden, and
    // the cursor must not be flung at a loop start that does not exist — this
    // hymn opens on a rest, so beat 0 is not even where the music starts.
    const withLeadIn = song();
    for (const voice of withLeadIn.voices) voice.notes[0] = { length: '1/4' };
    open(withLeadIn);

    player.seek(player.firstNoteBeat());
    expect(player.beat).toBe(1); // parked on the first sounding note

    click('#loopB');

    expect(player.looping).toBe(false);
    expect(player.loopStart).toBeNull();
    expect(document.querySelector('#loopA').classList.contains('loop-set')).toBe(false);
    expect(document.querySelector('#loopB').classList.contains('loop-set')).toBe(false);
    expect(isHidden('#loopClear')).toBe(true);
    expect(player.beat).toBe(1); // still on the music, not on the silent lead-in
  });

  it('clears both ends and the tint', () => {
    open();
    player.seek(2);
    click('#loopA');
    player.seek(6);
    click('#loopB');

    click('#loopClear');

    expect([player.loopStart, player.loopEnd]).toEqual([null, null]);
    expect(document.querySelector('#loopA').classList.contains('loop-set')).toBe(false);
    expect(isHidden('#loopClear')).toBe(true);
    expect(document.querySelectorAll('#score .in-loop')).toHaveLength(0);
  });

  it('opens the next hymn with the loop buttons dark', () => {
    open();
    player.seek(2);
    click('#loopA');

    const next = song();
    player.load(next);
    controls.showSong(next);

    expect(document.querySelector('#loopA').classList.contains('loop-set')).toBe(false);
    expect(isHidden('#loopClear')).toBe(true);
  });
});

describe('voice chips', () => {
  it.each(['soprano', 'alto', 'tenor', 'bass'])('mutes %s in the audio and dims it on the page', (voiceId) => {
    // Every voice, not just one: controls.js keeps its own list of voice ids
    // and score.js keeps another. A chip whose id drifts from the score's
    // still looks and toggles fine — it just stops silencing anything.
    open();
    const chip = document.querySelector(`.chip-${voiceId}`);
    const score$ = document.querySelector('#score');

    chip.click();

    expect(player.muted.has(voiceId)).toBe(true);
    expect(chip.classList.contains('chip-on')).toBe(false);
    expect(score$.classList.contains(`mute-${voiceId}`)).toBe(true);

    chip.click();

    expect(player.muted.has(voiceId)).toBe(false);
    expect(chip.classList.contains('chip-on')).toBe(true);
    expect(score$.classList.contains(`mute-${voiceId}`)).toBe(false);
  });

  it('offers all four parts, each labelled for the mobile initials', () => {
    open();
    const chips = [...document.querySelectorAll('#voiceChips .chip')];

    expect(chips.map((c) => c.querySelector('.chip-label').textContent))
      .toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
    expect(chips.map((c) => c.dataset.initial)).toEqual(['S', 'A', 'T', 'B']);
  });
});

describe('verse picker', () => {
  it('stays hidden for a single-verse hymn', () => {
    open(song({ verses: 1 }));

    expect(isHidden('#verseChips')).toBe(true);
    expect(document.querySelectorAll('.verse-chip')).toHaveLength(0);
  });

  it('offers all-verses plus one chip per verse', () => {
    open(song({ verses: 3 }));

    expect(isHidden('#verseChips')).toBe(false);
    expect([...document.querySelectorAll('.verse-chip')].map((c) => c.textContent))
      .toEqual(['All verses', '1', '2', '3']);
    expect(document.querySelector('.verse-chip').classList.contains('verse-on')).toBe(true);
  });

  it('shows only the chosen verse, and only one chip stays lit', () => {
    open(song({ verses: 3 }));
    const [, , second] = document.querySelectorAll('.verse-chip');

    second.click();

    expect(score.verseFilter).toBe(1);
    expect([...document.querySelectorAll('.verse-chip')].map((c) => c.classList.contains('verse-on')))
      .toEqual([false, false, true, false]);
    expect(document.querySelector('#score').textContent).toContain('v2-0');
    expect(document.querySelector('#score').textContent).not.toContain('v1-0');
  });

  it('opens the next hymn back on all verses', () => {
    // The pick belongs to one hymn. Carried into the next it would print a
    // page of empty staves under a chip nobody chose — and the next hymn may
    // not even have that many verses.
    open(song({ verses: 3 }));
    document.querySelectorAll('.verse-chip')[2].click(); // verse 2 only

    const next = song({ verses: 3 });
    player.load(next);
    score.render(next);
    controls.showSong(next);

    expect(score.verseFilter).toBe('all');
    expect(document.querySelector('.verse-chip').classList.contains('verse-on')).toBe(true);
    const printed = document.querySelector('#score').textContent;
    expect(printed).toContain('v1-0');
    expect(printed).toContain('v2-0');
  });

  it('rebuilds the picker for the next hymn', () => {
    open(song({ verses: 3 }));

    const next = song({ verses: 1 });
    player.load(next);
    score.render(next);
    controls.showSong(next);

    expect(isHidden('#verseChips')).toBe(true);
  });
});

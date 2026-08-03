/** @jest-environment jsdom */

/**
 * Player is a thin adapter over resound-sound's Sequencer — the schema
 * interpretation lives in the library and is tested there. What is app policy,
 * and therefore tested here: where playback parks, how the two A-B loop
 * buttons repair an inverted range, and that the pieces main.js and score.js
 * read (muted set, bpm, secPerBeat) stay wired to the sequencer.
 *
 * Nothing here starts audio: play() would construct a Piano, which needs an
 * AudioContext jsdom does not have.
 */
import { Player } from './player.js';

const q = (pitch) => ({ pitch, length: '1/4' });

/** 8 quarter beats per voice, tempo 120 (one beat = 0.5s). */
function song(extra = {}) {
  const line = (p) => Array.from({ length: 8 }, () => q(p));
  return {
    title: 'Test', slug: 'test', timeSignature: [4, 4], keySignature: 'C', tempo: 120,
    voices: [{ id: 'soprano', notes: line('C5') }, { id: 'bass', notes: line('C3') }],
    ...extra,
  };
}

describe('Player state after load', () => {
  it('takes tempo and length from the song', () => {
    const player = new Player();
    player.load(song());

    expect(player.bpm).toBe(120);
    expect(player.totalBeats).toBe(8);
    expect(player.playing).toBe(false);
  });

  it('parks on the first sounding note, not on leading rests', () => {
    const player = new Player();
    player.load(song({
      voices: [{ id: 'soprano', notes: [{ length: '1/2' }, q('C5'), q('D5')] }],
    }));

    expect(player.firstNoteBeat()).toBe(2);
    expect(player.beat).toBe(2);
  });

  it('clamps a seek to the song', () => {
    const player = new Player();
    player.load(song());

    player.seek(-3);
    expect(player.beat).toBe(0);
    player.seek(99);
    expect(player.beat).toBe(8);
  });

  it('reports the tick position through onTick so the cursor can follow', () => {
    const player = new Player();
    const ticks = [];
    player.onTick = (beat) => ticks.push(beat);
    player.load(song());
    player.seek(3);

    expect(ticks).toEqual([3]);
  });
});

describe('Player tempo', () => {
  it('feeds the bpm setter straight through to the clock', () => {
    const player = new Player();
    player.load(song());

    expect(player.secPerBeat(0)).toBeCloseTo(0.5, 6);
    player.bpm = 60;
    expect(player.bpm).toBe(60);
    expect(player.secPerBeat(0)).toBeCloseTo(1, 6);
  });

  it('applies the song tempoMap, so rits stretch the cursor lead too', () => {
    const player = new Player();
    player.load(song({ tempoMap: [{ beat: 4, multiplier: 0.5 }] }));

    expect(player.secPerBeat(0)).toBeCloseTo(0.5, 6);
    expect(player.secPerBeat(4)).toBeCloseTo(1, 6); // half speed from beat 4
  });
});

describe('Player mute', () => {
  it('toggles a voice and reports whether it now sounds', () => {
    const player = new Player();
    player.load(song());

    expect(player.toggleMute('bass')).toBe(false);
    expect(player.muted.has('bass')).toBe(true);
    expect(player.toggleMute('bass')).toBe(true);
    expect(player.muted.has('bass')).toBe(false);
  });

  it('exposes the live muted set score.setMuted() tints from', () => {
    const player = new Player();
    player.load(song());
    player.toggleMute('soprano');

    expect(player.muted).toBeInstanceOf(Set);
    expect([...player.muted]).toEqual(['soprano']);
  });
});

describe('Player A-B loop', () => {
  it('sets each end from wherever playback sits', () => {
    const player = new Player();
    player.load(song());

    player.seek(2);
    player.setLoopStart();
    player.seek(6);
    player.setLoopEnd();

    expect([player.loopStart, player.loopEnd]).toEqual([2, 6]);
    expect(player.looping).toBe(true);
  });

  it('repairs the range when B is set before A', () => {
    // Tapping B first should give a usable loop from the top, not a dead one.
    const player = new Player();
    player.load(song());

    player.seek(4);
    player.setLoopEnd();

    expect(player.loopStart).toBe(player.firstNoteBeat());
    expect(player.loopEnd).toBe(4);
    expect(player.looping).toBe(true);
  });

  it('drops a stale B when A is moved past it', () => {
    const player = new Player();
    player.load(song());

    player.seek(2);
    player.setLoopStart();
    player.seek(5);
    player.setLoopEnd();
    player.seek(7);
    player.setLoopStart(); // A now beyond the old B

    expect(player.loopStart).toBe(7);
    expect(player.loopEnd).toBeNull();
    expect(player.looping).toBe(false);
  });

  it('refuses a degenerate loop at the very start', () => {
    const player = new Player();
    player.load(song());

    player.seek(0);
    player.setLoopEnd(); // B at the first note, no A yet

    expect(player.looping).toBe(false);
    expect(player.loopEnd).toBeNull();
  });

  it('clears on demand and on the next song', () => {
    const player = new Player();
    player.load(song());
    player.seek(1);
    player.setLoopStart();
    player.seek(5);
    player.setLoopEnd();

    player.clearLoop();
    expect([player.loopStart, player.loopEnd, player.looping]).toEqual([null, null, false]);

    player.seek(1);
    player.setLoopStart();
    player.seek(5);
    player.setLoopEnd();
    player.load(song()); // a different hymn must not inherit the loop
    expect([player.loopStart, player.loopEnd, player.looping]).toEqual([null, null, false]);
  });

  it('rewinds to the loop start while looping, else to the first note', () => {
    const player = new Player();
    player.load(song({
      voices: [{ id: 'soprano', notes: [{ length: '1/4' }, q('C5'), q('D5'), q('E5')] }],
    }));

    player.seek(3);
    player.rewind();
    expect(player.beat).toBe(1); // the first sounding note, not beat 0

    player.seek(1);
    player.setLoopStart();
    player.seek(3);
    player.setLoopEnd();
    player.seek(2);
    player.rewind();
    expect(player.beat).toBe(1);
  });
});

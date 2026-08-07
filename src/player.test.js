/** @jest-environment jsdom */

/**
 * Player is a thin adapter over resound-sound's Sequencer — the schema
 * interpretation lives in the library and is tested there. What is app policy,
 * and therefore tested here: where playback parks, when the piano gets built
 * and warmed, how the two A-B loop buttons repair an inverted range, and that
 * the pieces main.js and score.js read (muted set, bpm, secPerBeat) stay wired
 * to the sequencer.
 *
 * Audio runs against the Web Audio mocks in test/audioMocks.js — the real
 * Piano, through a stubbed AudioContext.
 */
import { getInstrument } from 'resound-sound';
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

describe('Player piano handling', () => {
  afterEach(() => jest.useRealTimers());

  // Some tests below hand the Player a recording instrument through
  // `player.piano` — the same public seam main.js assigns its eagerly
  // initialized Piano to. That is injection through the app's own API, not a
  // mocked-out internal: the first test exercises the real Piano end to end
  // against the mocked AudioContext.

  it('builds a piano on the first play and warms the song it loaded', async () => {
    // main.js normally hands over an eagerly-initialized piano; when that
    // path is unavailable the Player must still come up inside the gesture.
    const player = new Player();
    player.load(song());
    expect(player.piano).toBeNull();

    await player.play();

    expect(player.piano).not.toBeNull();
    expect([...player.warmed].sort()).toEqual(['C3', 'C5']);
    expect(player.playing).toBe(true);

    player.pause();
    expect(player.playing).toBe(false);
  });

  it('keeps the piano main.js gave it, warming only pitches it has not seen', async () => {
    const player = new Player();
    player.load(song());
    const eager = { warm: jest.fn().mockResolvedValue(undefined), startNote: jest.fn(), stopAll: jest.fn() };
    player.piano = eager;
    player.warmed.add('C5'); // main.js marks the full chromatic range warmed

    await player.play();
    player.pause();

    expect(eager.warm).toHaveBeenCalledTimes(1);
    // C5 was already warm; the song's pitches jump the catalog-warm queue
    expect(eager.warm).toHaveBeenCalledWith(['C3'], { front: true });
    expect(player.piano).toBe(eager);
  });

  it('warms ahead only once a piano exists, so opening a song is cheap', () => {
    const player = new Player();
    player.load(song());

    expect(() => player.warmAhead()).not.toThrow(); // no piano yet: no-op
    expect(player.warmed.size).toBe(0);

    const eager = { warm: jest.fn().mockResolvedValue(undefined), startNote: jest.fn(), stopAll: jest.fn() };
    player.piano = eager;
    player.warmAhead();

    expect(eager.warm).toHaveBeenCalledWith(['C5', 'C3'], { front: true });
  });

  it('swallows a failed warm-ahead instead of rejecting into the page', async () => {
    // Nothing awaits warmAhead() — main.js fires it on every song open. A
    // rejection escaping it is an unhandled one, and it costs nothing anyway:
    // play() warms again inside the gesture and reports failure there.
    const player = new Player();
    player.load(song());
    player.piano = {
      warm: jest.fn().mockRejectedValue(new Error('OfflineAudioContext died')),
      startNote: jest.fn(),
      stopAll: jest.fn(),
    };

    await expect(player.warmAhead()).resolves.toBeUndefined();
    expect(player.piano.warm).toHaveBeenCalled();
  });

  it('warms the whole catalog range up front, in flats as well as sharps', async () => {
    // The page-load warm-up covers C2-B5 so no hymn has anything left to
    // render at the play tap. Song data spells accidentals as flats, so a
    // range marked only in sharps would re-render half the black keys.
    const player = new Player();

    await player.warmUp();

    expect(player.piano).not.toBeNull();
    expect(player.warmed.has('Eb4')).toBe(true);
    expect(player.warmed.has('D#4')).toBe(true);
    expect(player.warmed.has('C2') && player.warmed.has('B5')).toBe(true);
  });

  it('takes over the warming piano when the tap beats the warm-up', async () => {
    // A play tap while warmUp() is still rendering must wait for THAT init and
    // use its piano. Building a second one here would throw away every warmed
    // buffer and pay for the whole pre-render again, inside the gesture.
    const player = new Player();
    player.load(song());
    const warming = player.warmUp();
    // warmUp() adopts the registry's instance synchronously, so even a tap
    // that lands immediately warms THAT piano instead of building a second one.
    expect(player.piano).toBe(getInstrument('sing-harmony'));

    await player.play();
    await warming;

    expect(player.piano).toBe(getInstrument('sing-harmony'));
    player.pause();
  });

  it('adopts a song that was opened while it was still warming', async () => {
    // Opening a hymn calls warmAhead(), which no-ops until a piano exists;
    // the warm-up has to pick that song up when it finishes, or the first tap
    // pays for the whole hymn.
    const player = new Player();
    player.load(song());

    await player.warmUp();

    expect(player.seq.instrument).toBe(player.piano);
  });

  it('sounds the loaded voices as the clock crosses their onsets', async () => {
    jest.useFakeTimers();
    const player = new Player();
    player.load(song());
    const piano = { warm: jest.fn().mockResolvedValue(undefined), startNote: jest.fn(), stopAll: jest.fn() };
    player.piano = piano;

    await player.play();
    expect(piano.startNote).toHaveBeenCalledTimes(2); // beat 0: soprano + bass

    jest.advanceTimersByTime(600); // past beat 1 at 120bpm
    player.pause();

    expect(piano.startNote.mock.calls.length).toBeGreaterThan(2);
    // two voices singing → the two-part dynamic; 500ms is a quarter at 120bpm
    expect(piano.startNote).toHaveBeenLastCalledWith(expect.any(String), 500, 0.8);
    expect(piano.stopAll).toHaveBeenCalled();
  });

  it('drops the dynamic as voices are muted', async () => {
    jest.useFakeTimers();
    const player = new Player();
    player.load(song());
    const piano = { warm: jest.fn().mockResolvedValue(undefined), startNote: jest.fn(), stopAll: jest.fn() };
    player.piano = piano;
    player.toggleMute('bass');

    await player.play();
    player.pause();

    // one voice left singing: the solo dynamic, and the muted voice is silent
    expect(piano.startNote).toHaveBeenCalledTimes(1);
    expect(piano.startNote).toHaveBeenCalledWith('C5', 500, 0.95);
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

  it('refuses a degenerate loop at the very start, leaving NEITHER end set', () => {
    // Repairing A to the top of the hymn and then rejecting the range used to
    // leave A behind: the A button lit for a loop that does not exist, and the
    // ✕ offered to clear it.
    const player = new Player();
    player.load(song());

    player.seek(0);
    player.setLoopEnd(); // B at the first note, no A yet

    expect(player.looping).toBe(false);
    expect(player.loopEnd).toBeNull();
    expect(player.loopStart).toBeNull();
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

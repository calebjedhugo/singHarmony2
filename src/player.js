/**
 * Playback: a thin adapter over resound-sound's Sequencer.
 *
 * The library reads the song's voice arrays AS THEY ARE — the same objects
 * handed to resound-notation's render(). Nothing here interprets note data
 * (no tie merging, no dotted math, no beat clock); if playback needs to
 * understand the schema better, that belongs in resound-sound.
 *
 * What is left here is app policy: which piano to use and when to warm it,
 * the choir dynamic, and the A-B loop's two-button behavior.
 */
import {
  Piano, Sequencer, getInstrument, initInstruments, instrumentReady,
} from 'resound-sound';

// Dynamic scales with how many voices sing: solo part loud, full choir soft.
const VELOCITY_BY_ACTIVE = [0.95, 0.8, 0.65, 0.5];
// Piano velocity layers, ascending.
const VELOCITY_LAYERS = VELOCITY_BY_ACTIVE.slice().reverse();
// Beats the cursor keeps running after the last onset, so the final chord
// rings under a moving cursor instead of stopping dead on it.
const TAIL_BEATS = 2;
const PIANO_ID = 'sing-harmony';

// Every hymn's pitches live inside C2-B5, so warming that range up front
// covers the whole catalog before a song is even opened.
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_OF = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
const CHROMATIC_RANGE = [2, 3, 4, 5].flatMap((oct) => PITCH_CLASSES.map((pc) => pc + oct));

/** Both spellings of a sharp pitch — song data is written in flats. */
const spellings = (pitch) => {
  const m = /^([A-G]#)(\d)$/.exec(pitch);
  return m ? [pitch, FLAT_OF[m[1]] + m[2]] : [pitch];
};

export class Player {
  constructor() {
    this.piano = null; // set by warmUp(), or built lazily on the first play
    this.warmed = new Set();
    this.song = null;
    this.onTick = null; // (beat) => void
    this.onEnd = null;
    this._a = null; // loop start / end, in notated beats
    this._b = null;

    this.seq = new Sequencer({
      tailBeats: TAIL_BEATS,
      velocity: ({ activeVoices }) => VELOCITY_BY_ACTIVE[Math.max(0, activeVoices - 1)],
    });
    this.seq.onTick = (beat) => { if (this.onTick) this.onTick(beat); };
    this.seq.onEnd = () => { if (this.onEnd) this.onEnd(); };
  }

  load(song) {
    this.song = song;
    this.seq.load(song);
    this.clearLoop(); // a different hymn never inherits the last one's loop
  }

  get playing() { return this.seq.playing; }

  get beat() { return this.seq.beat; }

  get muted() { return this.seq.muted; }

  get totalBeats() { return this.seq.totalBeats; }

  get bpm() { return this.seq.tempo; }

  set bpm(value) { this.seq.setTempo(value); }

  firstNoteBeat() { return this.seq.startBeat; }

  secPerBeat(beat) { return this.seq.secondsPerBeat(beat); }

  /**
   * Build the shared piano at page load and pre-render the whole catalog's
   * range while the user is still on the song list, so the first play tap is
   * instant. Warming runs in an OfflineAudioContext (no gesture needed); the
   * library arms its own one-time gesture listener for live output. Failure is
   * not fatal — play() falls back to building the piano inside the tap.
   */
  async warmUp() {
    try {
      const ready = initInstruments({
        piano: { id: PIANO_ID, layers: VELOCITY_LAYERS, pitches: CHROMATIC_RANGE },
      });
      // The instance registers synchronously; take it NOW so a play tap only
      // waits for its own song's pitches (queued ahead of the catalog warm)
      // instead of the full-range pre-render.
      this.piano = getInstrument(PIANO_ID) || (await ready).piano;
      if (this.song) this.warmAhead(); // a song opened while we were warming
      await ready; // only now is the whole catalog cheap
      for (const p of CHROMATIC_RANGE) for (const s of spellings(p)) this.warmed.add(s);
    } catch { /* lazy path: ensurePiano() builds one on the first play */ }
  }

  async ensurePiano() {
    if (!this.piano) {
      // The tap can land while warmUp() is still rendering. Wait for that
      // init and take ITS piano — building a second one here would throw away
      // the warm buffers and pay for the whole pre-render again.
      this.piano = await instrumentReady(PIANO_ID)
        // nothing was ever initialized (warmUp unavailable): construct inside
        // the gesture so the AudioContext starts running
        || new Piano(PIANO_ID, { layers: VELOCITY_LAYERS });
    }
    this.seq.instrument = this.piano;
    const need = this.seq.pitches().filter((p) => !this.warmed.has(p));
    if (need.length) {
      // Jump the queue: the catalog warm can hum along behind this song.
      await this.piano.warm(need, { front: true });
      need.forEach((p) => this.warmed.add(p));
    }
  }

  /**
   * Fire-and-forget warm of the loaded song — call when the piano already
   * exists (eager init path), so play() finds everything cached. A failure is
   * swallowed on purpose: nobody is waiting on it, play() will retry inside
   * the gesture, and an escaping rejection would be an unhandled one. The
   * promise is returned so a caller that does care can wait.
   */
  warmAhead() {
    if (!this.piano || !this.song) return Promise.resolve();
    return this.ensurePiano().catch(() => {});
  }

  async play() {
    await this.ensurePiano();
    this.seq.play();
  }

  pause() { this.seq.pause(); }

  seek(beat) { this.seq.seek(beat); }

  rewind() { this.seq.seek(this.looping ? this._a : this.firstNoteBeat()); }

  toggleMute(voiceId) { return this.seq.toggleMute(voiceId); }

  // ---------- A-B loop ----------
  // A and B are set from wherever playback currently sits; setting one that
  // would invert the range repairs the other rather than refusing.

  get loopStart() { return this._a; }

  get loopEnd() { return this._b; }

  get looping() { return this.seq.looping; }

  setLoopStart() {
    this._a = this.seq.beat;
    if (this._b !== null && this._b <= this._a) this._b = null;
    this._syncLoop();
  }

  setLoopEnd() {
    const b = this.seq.beat;
    // B before A repairs the range by pulling A back to the top of the hymn.
    const a = this._a !== null && this._a < b ? this._a : this.firstNoteBeat();
    // ...but B at or before the top leaves no passage at all. Drop BOTH ends:
    // keeping the repaired A would light the A button nobody pressed and offer
    // the ✕ for a loop that does not exist.
    if (b <= a) {
      this.clearLoop();
      return;
    }
    this._a = a;
    this._b = b;
    this._syncLoop();
  }

  clearLoop() {
    this._a = null;
    this._b = null;
    this._syncLoop();
  }

  _syncLoop() {
    if (this._a !== null && this._b !== null) this.seq.setLoop(this._a, this._b);
    else this.seq.clearLoop();
  }
}

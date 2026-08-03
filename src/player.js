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
import { Piano, Sequencer } from 'resound-sound';

// Dynamic scales with how many voices sing: solo part loud, full choir soft.
const VELOCITY_BY_ACTIVE = [0.95, 0.8, 0.65, 0.5];
// Piano velocity layers (ascending) — must match what main.js passes to initInstruments.
export const VELOCITY_LAYERS = VELOCITY_BY_ACTIVE.slice().reverse();
// Beats the cursor keeps running after the last onset, so the final chord
// rings under a moving cursor instead of stopping dead on it.
const TAIL_BEATS = 2;

export class Player {
  constructor() {
    this.piano = null; // set by main.js's eager init, or created on first play
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
    this._a = null;
    this._b = null;
    this.seq.load(song);
  }

  get playing() { return this.seq.playing; }

  get beat() { return this.seq.beat; }

  get muted() { return this.seq.muted; }

  get totalBeats() { return this.seq.totalBeats; }

  get bpm() { return this.seq.tempo; }

  set bpm(value) { this.seq.setTempo(value); }

  firstNoteBeat() { return this.seq.startBeat; }

  secPerBeat(beat) { return this.seq.secondsPerBeat(beat); }

  async ensurePiano() {
    if (!this.piano) {
      // fallback path (eager initInstruments unavailable/failed): construct
      // inside the user gesture so the AudioContext starts running
      this.piano = new Piano('sing-harmony', { layers: VELOCITY_LAYERS });
    }
    this.seq.instrument = this.piano;
    const need = this.seq.pitches().filter((p) => !this.warmed.has(p));
    if (need.length) {
      await this.piano.warm(need);
      need.forEach((p) => this.warmed.add(p));
    }
  }

  /** Fire-and-forget warm of the loaded song — call when the piano already
   *  exists (eager init path), so play() finds everything cached. */
  warmAhead() {
    if (this.piano && this.song) this.ensurePiano();
  }

  async play() {
    await this.ensurePiano();
    this.seq.play();
  }

  pause() { this.seq.pause(); }

  stop() { this.seq.stop(); }

  seek(beat) { this.seq.seek(beat); }

  rewind() { this.seq.seek(this.looping ? this._a : this.seq.startBeat); }

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
    this._b = this.seq.beat;
    if (this._a === null || this._b <= this._a) this._a = this.seq.startBeat;
    if (this._b <= this._a) this._b = null;
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

/**
 * Playback engine: drives resound-sound's Piano from song JSON.
 *
 * All positions are in notated quarter-note beats — the same timeline as
 * resound-notation's data-beat attributes. Tied notes are merged into single
 * sounding events. Tempo is user-set BPM scaled by the song's tempoMap
 * multipliers (rits/accels).
 */
import { Piano } from 'resound-sound';

const VOICE_IDS = ['soprano', 'alto', 'tenor', 'bass'];
// Dynamic scales with how many voices sing: solo part loud, full choir soft.
const VELOCITY_BY_ACTIVE = [0.95, 0.8, 0.65, 0.5];
// Piano velocity layers (ascending) — must match what main.js passes to initInstruments.
export const VELOCITY_LAYERS = VELOCITY_BY_ACTIVE.slice().reverse();
const TICK_MS = 25;

function beatsOf(note) {
  const [num, den] = note.length.split('/').map(Number);
  return (num / den) * 4 * (note.dotted ? 1.5 : 1);
}

export class Player {
  constructor() {
    this.piano = null; // created lazily inside a user gesture
    this.warmed = new Set();
    this.song = null;
    this.events = [];       // {beat, durBeats, pitch, voice} sorted by beat
    this.totalBeats = 0;
    this.playing = false;
    this.beat = 0;
    this.muted = new Set();
    this.bpm = 100;
    this.loopStart = null;
    this.loopEnd = null;
    this.onTick = null;     // (beat) => void
    this.onEnd = null;
    this._timer = null;
    this._lastNow = 0;
  }

  load(song) {
    this.stop();
    this.song = song;
    this.bpm = song.tempo;
    this.events = [];
    this.totalBeats = 0;
    for (let vi = 0; vi < song.voices.length; vi++) {
      const voice = song.voices[vi];
      let beat = 0;
      let open = null; // accumulating tied note
      for (const n of voice.notes) {
        const dur = beatsOf(n);
        if (n.pitch) {
          if (n.tie === 'stop' || n.tie === 'continue') {
            if (open) open.durBeats += dur;
            else this.events.push(open = { beat, durBeats: dur, pitch: n.pitch, voice: voice.id });
            if (n.tie === 'stop') open = null;
          } else {
            const ev = { beat, durBeats: dur, pitch: n.pitch, voice: voice.id };
            this.events.push(ev);
            open = n.tie === 'start' ? ev : null;
          }
        } else {
          open = null;
        }
        beat += dur;
      }
      this.totalBeats = Math.max(this.totalBeats, beat);
    }
    this.events.sort((a, b) => a.beat - b.beat);
    this.beat = this.firstNoteBeat();
  }

  firstNoteBeat() {
    return this.events.length ? this.events[0].beat : 0;
  }

  uniquePitches() {
    return [...new Set(this.events.map((e) => e.pitch))];
  }

  async ensurePiano() {
    if (!this.piano) {
      // fallback path (library without initInstruments): construct lazily
      // inside the user gesture so the AudioContext starts running
      this.piano = new Piano('sing-harmony', { layers: VELOCITY_LAYERS });
    }
    const need = this.uniquePitches().filter((p) => !this.warmed.has(p));
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

  tempoMultiplier(beat) {
    let mult = 1;
    for (const t of this.song.tempoMap || []) {
      if (beat >= t.beat) mult = t.multiplier;
      else break;
    }
    return mult;
  }

  secPerBeat(beat) {
    return 60 / (this.bpm * this.tempoMultiplier(beat));
  }

  velocity() {
    const active = VOICE_IDS.filter((v) => !this.muted.has(v)).length;
    return VELOCITY_BY_ACTIVE[Math.max(0, active - 1)];
  }

  toggleMute(voiceId) {
    if (this.muted.has(voiceId)) this.muted.delete(voiceId);
    else this.muted.add(voiceId);
    return !this.muted.has(voiceId);
  }

  seek(beat) {
    this.beat = Math.max(0, Math.min(beat, this.totalBeats));
    if (this.onTick) this.onTick(this.beat);
  }

  rewind() {
    this.seek(this.looping ? this.loopStart : this.firstNoteBeat());
  }

  get looping() {
    return this.loopStart !== null && this.loopEnd !== null && this.loopEnd > this.loopStart;
  }

  setLoopStart() { this.loopStart = this.beat; }
  setLoopEnd() { this.loopEnd = this.beat; }
  clearLoop() { this.loopStart = null; this.loopEnd = null; }

  async play() {
    if (this.playing) return;
    await this.ensurePiano();
    if (this.looping && (this.beat < this.loopStart || this.beat >= this.loopEnd - 1e-9)) {
      this.beat = this.loopStart;
    } else if (this.beat >= this.totalBeats) {
      this.beat = this.firstNoteBeat();
    }
    this.playing = true;
    this._lastNow = performance.now();
    this._fired = new Set();
    // fire anything starting exactly at the current beat
    this._tick();
  }

  pause() {
    this.playing = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    if (this.piano) this.piano.stopAll(0.08);
  }

  stop() {
    this.pause();
    this.beat = this.song ? this.firstNoteBeat() : 0;
    if (this.onTick && this.song) this.onTick(this.beat);
  }

  _tick() {
    if (!this.playing) return;
    const now = performance.now();
    const dt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    const from = this.beat;
    let to = from + dt / this.secPerBeat(from);
    // loop wrap: play up to the loop end, then jump back to the loop start
    const wrapping = this.looping && from < this.loopEnd && to >= this.loopEnd;
    const fireUntil = wrapping ? this.loopEnd : to;
    for (const ev of this.events) {
      if (ev.beat >= fireUntil) break;
      if (ev.beat < from) continue;
      if (this.muted.has(ev.voice)) continue;
      const durMs = ev.durBeats * this.secPerBeat(ev.beat) * 1000;
      this.piano.startNote(ev.pitch, durMs, this.velocity());
    }
    if (wrapping) to = this.loopStart;
    this.beat = to;
    if (this.onTick) this.onTick(this.beat);
    if (this.beat >= this.totalBeats + 2) {
      this.playing = false;
      this.beat = this.firstNoteBeat();
      if (this.onEnd) this.onEnd();
      return;
    }
    this._timer = setTimeout(() => this._tick(), TICK_MS);
  }
}

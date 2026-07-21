/**
 * Score view: wraps resound-notation's NotationRenderer for the 4-voice open
 * score (one staff per part, bracketed), and layers on:
 *   - staff part labels (S A T B) on each system
 *   - a playback cursor driven by data-beat/data-voice-id attributes
 *   - click-to-seek on any note or rest
 *   - per-voice mute tinting (via CSS classes on the container)
 *
 * The renderer replaces its SVG on responsive reflow, so all decoration is
 * re-applied through a MutationObserver.
 */
import { NotationRenderer } from 'resound-notation';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PART_LABELS = { soprano: 'S', alto: 'A', tenor: 'T', bass: 'B' };

function transposePitch(pitch, octaves) {
  if (!octaves) return pitch;
  return pitch.replace(/(\d)$/, (d) => String(Number(d) + octaves));
}

export class Score {
  constructor(container, { onSeek } = {}) {
    this.container = container;
    this.onSeek = onSeek;
    this.renderer = null;
    this.song = null;
    this.noteIndex = new Map(); // voiceId -> sorted [{el, beat, dur}]
    this.activeEls = [];
    this.lastBeat = -1;
    this._observer = new MutationObserver(() => this._decorate());
    container.addEventListener('click', (e) => this._handleClick(e));
  }

  render(song) {
    this.song = song;
    const data = {
      timeSignature: song.timeSignature,
      keySignature: song.keySignature,
      voices: song.voices.map((v) => ({
        id: v.id,
        clef: v.clef,
        notes: v.notes.map((n) => (n.pitch
          ? { ...n, pitch: transposePitch(n.pitch, v.displayOctave) }
          : n)),
      })),
      staffGroups: [{ type: 'bracket', voiceIds: song.voices.map((v) => v.id) }],
    };
    this._observer.disconnect();
    if (!this.renderer) this.renderer = new NotationRenderer({ container: this.container });
    this.renderer.render(data);
    this._decorate();
    this._observer.observe(this.container, { childList: true, subtree: false });
  }

  destroy() {
    this._observer.disconnect();
    if (this.renderer) { this.renderer.clear(); this.renderer = null; }
    this.noteIndex.clear();
    this.activeEls = [];
  }

  /** Rebuild note index + part labels after every (re)render. */
  _decorate() {
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    this.noteIndex.clear();
    this.activeEls = [];
    // data-beat is SYSTEM-RELATIVE (the renderer slices voices per system and
    // restarts its beat counter), so recover the absolute beat from the
    // group's data-start-measure.
    const [num, den] = this.song.timeSignature;
    const measureBeats = num * (4 / den);
    for (const group of svg.querySelectorAll('[data-voice-id]')) {
      const voiceId = group.getAttribute('data-voice-id');
      const startMeasure = Number(group.getAttribute('data-start-measure') || 0);
      const systemStartBeat = startMeasure * measureBeats;
      if (!this.noteIndex.has(voiceId)) this.noteIndex.set(voiceId, []);
      const list = this.noteIndex.get(voiceId);
      for (const el of group.querySelectorAll('[data-beat]')) {
        const beat = systemStartBeat + Number(el.getAttribute('data-beat'));
        el.dataset.absBeat = String(beat);
        list.push({ el, beat });
      }
    }
    for (const list of this.noteIndex.values()) list.sort((a, b) => a.beat - b.beat);
    this._addPartLabels(svg);
    this._applyLoopRange();
    if (this.lastBeat >= 0) this.setCursor(this.lastBeat, true);
  }

  _addPartLabels(svg) {
    const seen = new Set();
    for (const group of svg.querySelectorAll('[data-voice-id][data-system-index]')) {
      const voiceId = group.getAttribute('data-voice-id');
      const sys = group.getAttribute('data-system-index');
      const key = `${voiceId}:${sys}`;
      if (seen.has(key) || !PART_LABELS[voiceId]) continue;
      seen.add(key);
      const staffLine = group.querySelector('.staff-line, line, path');
      if (!staffLine) continue;
      let bbox;
      try { bbox = group.getBBox(); } catch { continue; }
      const label = document.createElementNS(SVG_NS, 'text');
      label.textContent = PART_LABELS[voiceId];
      // sized in SVG user units — the staff itself is ~40 units tall
      const fontSize = Math.max(24, Math.min(40, bbox.height * 0.8));
      label.setAttribute('x', String(bbox.x - 32));
      label.setAttribute('y', String(bbox.y + bbox.height / 2 + fontSize * 0.35));
      label.setAttribute('class', `part-label part-${voiceId}`);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', String(fontSize));
      group.appendChild(label);
    }
  }

  _handleClick(e) {
    const el = e.target.closest('[data-beat]');
    if (!el || !this.onSeek) return;
    this.onSeek(Number(el.dataset.absBeat ?? el.getAttribute('data-beat')));
  }

  setMuted(mutedSet) {
    for (const id of Object.keys(PART_LABELS)) {
      this.container.classList.toggle(`mute-${id}`, mutedSet.has(id));
    }
  }

  /** Highlight the notes sounding at `beat` and auto-scroll to them. */
  setCursor(beat, force = false) {
    if (!force && Math.abs(beat - this.lastBeat) < 1e-9) return;
    this.lastBeat = beat;
    for (const el of this.activeEls) el.classList.remove('sh-active');
    this.activeEls = [];
    let scrollTarget = null;
    for (const list of this.noteIndex.values()) {
      // last element with beat <= current
      let lo = 0; let hi = list.length - 1; let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].beat <= beat + 1e-9) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (idx >= 0) {
        const el = list[idx].el;
        el.classList.add('sh-active');
        this.activeEls.push(el);
        if (!scrollTarget) scrollTarget = el;
      }
    }
    if (scrollTarget) this._autoScroll(scrollTarget);
  }

  /** Tint the notes inside the A-B loop range (pass nulls to clear). */
  setLoopRange(start, end) {
    this._loopStart = start;
    this._loopEnd = end;
    this._applyLoopRange();
  }

  _applyLoopRange() {
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    for (const el of svg.querySelectorAll('.in-loop')) el.classList.remove('in-loop');
    const active = this._loopStart != null && this._loopEnd != null;
    this.container.classList.toggle('has-loop', active);
    if (!active) return;
    for (const list of this.noteIndex.values()) {
      for (const { el, beat } of list) {
        if (beat >= this._loopStart - 1e-9 && beat < this._loopEnd - 1e-9) el.classList.add('in-loop');
      }
    }
  }

  clearCursor() {
    for (const el of this.activeEls) el.classList.remove('sh-active');
    this.activeEls = [];
    this.lastBeat = -1;
  }

  _autoScroll(el) {
    // Scroll only when the cursor enters a different system, and only if that
    // system isn't already fully visible — keeps the score rock-steady.
    const system = el.closest('[data-system-index]');
    const systemKey = system && system.getAttribute('data-system-index');
    if (systemKey === this._lastSystemKey) return;
    this._lastSystemKey = systemKey;
    if (!system) return;
    const rect = system.getBoundingClientRect();
    const wrap = this.container.closest('#scoreWrap') || this.container;
    const wrapRect = wrap.getBoundingClientRect();
    if (rect.top < wrapRect.top + 10 || rect.bottom > wrapRect.bottom - 10) {
      system.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

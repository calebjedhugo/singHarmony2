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

export class Score {
  constructor(container, { onSeek, onScrub } = {}) {
    this.container = container;
    this.onSeek = onSeek;
    this.onScrub = onScrub;
    this.renderer = null;
    this.song = null;
    this.verseFilter = 'all'; // 'all' | 0-based verse index
    this.mode = 'page'; // 'page' | 'ribbon'
    this._userScrollUntil = 0;
    const wrap = container.closest('#scoreWrap') || container;
    for (const evt of ['wheel', 'touchmove']) {
      wrap.addEventListener(evt, () => { this._userScrollUntil = performance.now() + 2500; }, { passive: true });
    }
    // Drag-scrub (ribbon): when the USER scrolls the ribbon, snap the playback
    // position to the measure nearest the left edge once the scroll settles.
    wrap.addEventListener('scroll', () => {
      if (this.mode !== 'ribbon' || this._tweening) return;
      if (performance.now() >= this._userScrollUntil) return; // programmatic
      clearTimeout(this._scrubTimer);
      this._scrubTimer = setTimeout(() => this._scrubSeek(wrap), 250);
    }, { passive: true });
    this.noteIndex = new Map(); // voiceId -> sorted [{el, beat, dur}]
    this.activeEls = [];
    this.lastBeat = -1;
    this._observer = new MutationObserver(() => this._decorate());
    container.addEventListener('click', (e) => this._handleClick(e));
  }

  /** 'page' = vertical systems (hymnal page); 'ribbon' = one long horizontal system. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.song) this.render(this.song);
  }

  render(song) {
    this.song = song;
    // Close score: S+A share the treble staff, T+B the bass staff — everyone
    // at true pitch (no tenor 8va; it reads from the bass clef as in hymnals).
    const STAFF_MAP = {
      soprano: { staff: 'upper', clef: 'treble' },
      alto: { staff: 'upper', clef: 'treble' },
      tenor: { staff: 'lower', clef: 'bass' },
      bass: { staff: 'lower', clef: 'bass' },
    };
    const data = {
      timeSignature: song.timeSignature,
      keySignature: song.keySignature,
      voices: song.voices.map((v) => ({
        id: v.id,
        staff: STAFF_MAP[v.id]?.staff,
        clef: STAFF_MAP[v.id]?.clef ?? v.clef,
        // verse filtering applies only to the soprano's verse stack; other
        // voices' lyric lines (e.g. the It Is Well bass echo) sing every verse
        notes: this.verseFilter === 'all' || v.id !== 'soprano' ? v.notes : v.notes.map((n) => {
          if (!Array.isArray(n.lyric)) {
            // bare string = verse 1; other verses show nothing
            return this.verseFilter === 0 || n.lyric === undefined ? n : { ...n, lyric: undefined };
          }
          const syl = n.lyric[this.verseFilter];
          return { ...n, lyric: syl || undefined };
        }),
      })),
      staffGroups: [{ type: 'brace', voiceIds: song.voices.map((v) => v.id) }],
    };
    this._observer.disconnect();
    this.container.classList.toggle('ribbon', this.mode === 'ribbon');
    const wrapEl = this.container.closest('#scoreWrap');
    if (wrapEl) wrapEl.classList.toggle('ribbon-view', this.mode === 'ribbon');
    if (this.mode === 'ribbon') {
      // One long system: render at an effectively-infinite width, measure the
      // natural content extent, then re-render tight so the viewBox hugs it.
      if (this.renderer) { this.renderer.clear(); }
      this.renderer = new NotationRenderer({ container: this.container, width: 200000 });
      this.renderer.render(data);
      const natural = this._contentRightEdge();
      this.renderer.clear();
      this.renderer = new NotationRenderer({ container: this.container, width: natural + 80 });
      this.renderer.render(data);
    } else {
      if (this.renderer) { this.renderer.clear(); }
      this.renderer = new NotationRenderer({ container: this.container });
      this.renderer.render(data);
    }
    this._decorate();
    this._observer.observe(this.container, { childList: true, subtree: false });
  }

  /** Rightmost extent of staff furniture in the current SVG (internal units). */
  _contentRightEdge() {
    const svg = this.container.querySelector('svg');
    let right = 1000;
    if (!svg) return right;
    for (const g of svg.querySelectorAll('.staff[data-staff-id], [data-voice-id]')) {
      try {
        const bb = g.getBBox();
        right = Math.max(right, bb.x + bb.width);
      } catch { /* detached */ }
    }
    return right;
  }

  setVerse(filter) {
    this.verseFilter = filter;
    if (this.song) this.render(this.song);
  }

  /** Highest verse count carried by any note (0 = no lyrics). */
  verseCount() {
    let max = 0;
    if (!this.song) return 0;
    for (const n of this.song.voices[0].notes) {
      if (Array.isArray(n.lyric)) max = Math.max(max, n.lyric.length);
      else if (n.lyric) max = Math.max(max, 1);
    }
    return max;
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
    // Anchor positions (content-relative px) for ribbon follow + click-to-measure.
    this._anchors = [];
    this._lastMeasure = -1;
    const scoreRect = this.container.getBoundingClientRect();
    for (const group of svg.querySelectorAll('[data-voice-id="soprano"][data-system-index]')) {
      const sys = Number(group.getAttribute('data-system-index'));
      const startMeasure = Number(group.getAttribute('data-start-measure') || 0);
      const [tn, td] = this.song.timeSignature;
      const sysStartBeat = startMeasure * tn * (4 / td);
      for (const el of group.querySelectorAll('[data-beat]')) {
        const r = el.getBoundingClientRect();
        this._anchors.push({
          beat: sysStartBeat + Number(el.getAttribute('data-beat')),
          x: r.left + r.width / 2 - scoreRect.left,
          y: r.top + r.height / 2 - scoreRect.top,
          sys,
        });
      }
    }
    this._anchors.sort((a, b) => a.beat - b.beat);
    // (no per-staff part labels in close score — the colored chips are the legend)
    this._applyLoopRange();
    if (this.lastBeat >= 0) this.setCursor(this.lastBeat, true);
  }

  /** Interpolated content-relative x for a beat (ribbon follow). */
  _xForBeat(beat) {
    const a = this._anchors;
    if (!a || !a.length) return 0;
    if (beat <= a[0].beat) return a[0].x;
    for (let i = 0; i < a.length - 1; i++) {
      if (beat < a[i + 1].beat) {
        const t = (beat - a[i].beat) / (a[i + 1].beat - a[i].beat);
        return a[i].x + t * (a[i + 1].x - a[i].x);
      }
    }
    return a[a.length - 1].x;
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

  /** Click anywhere in a measure → playback jumps to that measure's beat 1. */
  _handleClick(e) {
    if (!this.onSeek || !this.song || !this._anchors || !this._anchors.length) return;
    const [num, den] = this.song.timeSignature;
    const measureBeats = num * (4 / den);
    let beat;
    const el = e.target.closest('[data-beat]');
    if (el && el.dataset.absBeat !== undefined) {
      beat = Number(el.dataset.absBeat);
    } else {
      // empty-space click: nearest system by y, then last anchor left of the click
      const rect = this.container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      let sys = null;
      let bestDy = Infinity;
      for (const a of this._anchors) {
        const dy = Math.abs(a.y - cy);
        if (dy < bestDy) { bestDy = dy; sys = a.sys; }
      }
      if (sys === null || bestDy > 400) return; // not on a system
      const inSys = this._anchors.filter((a) => a.sys === sys);
      const before = inSys.filter((a) => a.x <= cx);
      beat = (before.length ? before[before.length - 1] : inSys[0]).beat;
    }
    const measureStart = Math.floor(beat / measureBeats + 1e-6) * measureBeats;
    this._lastMeasure = -1; // let the ribbon flick re-align to the new measure
    this.onSeek(measureStart);
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
    if (this.mode === 'ribbon') this._followRibbon(beat);
    else if (scrollTarget) this._autoScroll(scrollTarget);
  }

  _followRibbon(beat) {
    if (performance.now() < this._userScrollUntil) return;
    // Measure-snap: hold still within a measure, then flick the newly-reached
    // measure flush to the left edge at each barline.
    const [num, den] = this.song.timeSignature;
    const measureBeats = num * (4 / den);
    const measure = Math.floor(beat / measureBeats + 1e-6);
    if (measure === this._lastMeasure) return;
    this._lastMeasure = measure;
    const wrap = this.container.closest('#scoreWrap') || this.container;
    const target = Math.max(0, this._xForBeat(measure * measureBeats) - 30);
    this._flickTo(wrap, target);
  }

  /** Ease-out scroll tween. setTimeout-driven — native smooth scrollTo is
   *  unreliable across engines, and rAF stalls in unfocused tabs. */
  _flickTo(wrap, target, ms = 380) {
    if (this._flickTimer) clearTimeout(this._flickTimer);
    const from = wrap.scrollLeft;
    const delta = target - from;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    this._tweening = true;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      wrap.scrollLeft = from + delta * (1 - (1 - t) ** 3);
      if (t < 1) this._flickTimer = setTimeout(step, 16);
      else this._tweening = false;
    };
    step();
  }

  /** Snap the playback position to the measure nearest the ribbon's left edge. */
  _scrubSeek(wrap) {
    if (!this.song || !this.onScrub) return;
    const [num, den] = this.song.timeSignature;
    const measureBeats = num * (4 / den);
    const anchors = this._anchors;
    if (!anchors || !anchors.length) return;
    const lastBeat = anchors[anchors.length - 1].beat;
    const edge = wrap.scrollLeft + 30;
    let best = 0;
    let bestDist = Infinity;
    for (let m = 0; m * measureBeats <= lastBeat + 1e-6; m++) {
      const d = Math.abs(this._xForBeat(m * measureBeats) - edge);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    this._lastMeasure = best;          // no immediate flick-back
    this._userScrollUntil = 0;         // resume auto-follow from here
    this.onScrub(best * measureBeats);
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

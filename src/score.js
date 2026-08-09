/**
 * Score view: wraps resound-notation's NotationRenderer for the four-voice
 * close score (S+A on the treble staff, T+B on the bass staff, braced), and
 * layers on:
 *   - a playback cursor driven by data-beat/data-voice-id attributes
 *   - click-to-seek, quantized to the measure
 *   - ribbon mode: one long system that follows playback measure by measure,
 *     and drag-scrub back the other way
 *   - per-voice mute tinting and A-B loop tinting (CSS classes)
 *
 * The renderer replaces its SVG on responsive reflow, so all decoration is
 * re-applied through a MutationObserver.
 */
import { NotationRenderer } from 'resound-notation';

// Close score: S+A share the treble staff, T+B the bass staff — everyone at
// true pitch (no tenor 8va; it reads from the bass clef as in hymnals). This is
// also the app's list of voices: songs carry exactly these four.
const STAFF_MAP = {
  soprano: { staff: 'upper', clef: 'treble' },
  alto: { staff: 'upper', clef: 'treble' },
  tenor: { staff: 'lower', clef: 'bass' },
  bass: { staff: 'lower', clef: 'bass' },
};
const VOICE_IDS = Object.keys(STAFF_MAP);

/** Float slop for beat comparisons (beats are small, exact rationals). */
const BEAT_EPS = 1e-6;

/** Ribbon auto-follow stands down for this long after the user scrolls. */
const USER_SCROLL_GRACE_MS = 2500;
/** ...and a scroll that settles for this long is read as a drag-scrub. */
const SCRUB_SETTLE_MS = 250;
/** Ease-out duration of the measure-to-measure ribbon flick. */
const FLICK_MS = 380;
/** A click further than this (px) from any system is not a seek. */
const CLICK_SYSTEM_REACH = 400;
/** Where the playing measure's OPENING BARLINE sits (everything the measure
 *  owns is engraved right of it): clear of the floating SATB buttons on
 *  mobile (prior music stays visible around them), modest margin elsewhere.
 *  Mobile ribbon gets matching content padding-left so measure 1 starts
 *  clear of the buttons too. */
const EDGE_PX = { mobile: 56, desktop: 30 };
const MOBILE_QUERY = '(max-width: 700px), (max-height: 500px)';

/** Ribbon fit (see render()): engrave once at a width no system can fill, so
 *  the music lays out as one line; then re-engrave to its measured extent plus
 *  a right margin. Short hymns — and any SVG that won't report a bounding box
 *  — fall back to the minimum width. */
const RIBBON_PROBE_WIDTH = 200000;
const RIBBON_RIGHT_MARGIN = 80;
const RIBBON_MIN_WIDTH = 1000;

/** Index of the last entry at or before `beat` (-1 if none). List is sorted. */
function lastAtOrBefore(list, beat) {
  let lo = 0;
  let hi = list.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].beat <= beat + BEAT_EPS) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return idx;
}

/**
 * The soprano's notes with only `verse` (0-based) showing — other voices'
 * lyric lines (e.g. the It Is Well bass echo) sing every verse and are passed
 * through untouched by the caller.
 */
function filterVerse(notes, verse) {
  return notes.map((n) => {
    if (!Array.isArray(n.lyric)) {
      // bare string = verse 1; from any other verse it shows nothing
      return verse === 0 || n.lyric === undefined ? n : { ...n, lyric: undefined };
    }
    return { ...n, lyric: n.lyric[verse] || undefined };
  });
}

export class Score {
  constructor(container, { onSeek, onScrub } = {}) {
    this.container = container;
    this.wrap = container.closest('#scoreWrap') || container;
    this.onSeek = onSeek;
    this.onScrub = onScrub;
    this.renderer = null;
    this.song = null;
    this.verseFilter = 'all'; // 'all' | 0-based verse index
    this.mode = 'page'; // 'page' | 'ribbon'
    this.noteIndex = new Map(); // voiceId -> sorted [{el, beat}]
    this.activeEls = [];
    this.lastBeat = -1;
    this._anchors = []; // sorted [{beat, x, y, sys}] — soprano onsets, content px
    this._userScrollUntil = 0;
    for (const evt of ['wheel', 'touchmove']) {
      this.wrap.addEventListener(evt, () => {
        this._userScrollUntil = performance.now() + USER_SCROLL_GRACE_MS;
      }, { passive: true });
    }
    // Drag-scrub (ribbon): when the USER scrolls the ribbon, snap the playback
    // position to the measure nearest the left edge once the scroll settles.
    this.wrap.addEventListener('scroll', () => {
      if (this.mode !== 'ribbon' || this._tweening) return;
      if (performance.now() >= this._userScrollUntil) return; // programmatic
      clearTimeout(this._scrubTimer);
      this._scrubTimer = setTimeout(() => this._scrubSeek(), SCRUB_SETTLE_MS);
    }, { passive: true });
    this._observer = new MutationObserver(() => this._decorate());
    container.addEventListener('click', (e) => this._handleClick(e));
  }

  // ---------- measure grid ----------
  // Mirrors resound-notation's lib/measureGrid.js: with a pickup of p beats,
  // measure 0 is the SHORT anacrusis [0, p) and measure m >= 1 starts at
  // p + (m-1)*L. Without a pickup it reduces to m*L. Everything that maps
  // beats to measures — cursor follow, click-to-seek, drag-scrub, system
  // start beats — goes through these two.

  /** Beats in a full measure. */
  get measureBeats() {
    const [num, den] = this.song.timeSignature;
    return num * (4 / den);
  }

  get pickupBeats() { return this.song.pickupBeats || 0; }

  /** First beat of measure `m` (the pickup counts as measure 0). */
  gridStart(m) {
    const p = this.pickupBeats;
    if (!p) return m * this.measureBeats;
    return m === 0 ? 0 : p + (m - 1) * this.measureBeats;
  }

  /** Index of the measure containing `beat`. */
  measureAt(beat) {
    const p = this.pickupBeats;
    if (!p) return Math.floor(beat / this.measureBeats + BEAT_EPS);
    if (beat < p - BEAT_EPS) return 0;
    return 1 + Math.floor((beat - p) / this.measureBeats + BEAT_EPS);
  }

  // ---------- rendering ----------

  /** 'page' = vertical systems (hymnal page); 'ribbon' = one long horizontal system. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.song) this.render(this.song);
  }

  setVerse(filter) {
    this.verseFilter = filter;
    if (this.song) this.render(this.song);
  }

  render(song) {
    // Verse pick, cursor and scroll position all belong to ONE hymn. Opening a
    // different one starts them over; re-rendering the hymn already on screen
    // (verse pick, mode flip, resize) must keep every one of them.
    if (song !== this.song) {
      this.verseFilter = 'all';
      this.lastBeat = -1; // don't light the old hymn's beat on the new staves
      this._lastSystemKey = null; // ...or leave the page scrolled where it was
    }
    this.song = song;
    const data = this._renderData(song);
    this._observer.disconnect();
    const ribbon = this.mode === 'ribbon';
    this.container.classList.toggle('ribbon', ribbon);
    this.wrap.classList.toggle('ribbon-view', ribbon);
    if (ribbon) {
      // One long system: render at an effectively-infinite width, measure the
      // natural content extent, then re-render tight so the viewBox hugs it.
      this._engrave(data, RIBBON_PROBE_WIDTH);
      this._engrave(data, this._contentRightEdge() + RIBBON_RIGHT_MARGIN);
    } else {
      this._engrave(data);
    }
    this._decorate();
    this._observer.observe(this.container, { childList: true, subtree: false });
  }

  /** Re-measure after a viewport change — anchor positions are layout-dependent. */
  remeasure() { this._decorate(); }

  /** The song as resound-notation wants it: staff assignment + verse filter. */
  _renderData(song) {
    const showAllVerses = this.verseFilter === 'all';
    return {
      timeSignature: song.timeSignature,
      keySignature: song.keySignature,
      // a pickup is a real short first measure, not rest padding
      ...(song.pickupBeats ? { pickupBeats: song.pickupBeats } : {}),
      // The close score assigns staff and clef itself; the song file's own
      // `clef`/`displayOctave` are inert converter leftovers and stay unread.
      voices: song.voices.map((v) => ({
        id: v.id,
        ...STAFF_MAP[v.id],
        // verse filtering applies only to the soprano's verse stack
        notes: showAllVerses || v.id !== 'soprano' ? v.notes : filterVerse(v.notes, this.verseFilter),
      })),
      staffGroups: [{ type: 'brace', voiceIds: song.voices.map((v) => v.id) }],
    };
  }

  /**
   * Replace the SVG with a fresh render. Given no explicit width the renderer
   * attaches its own ResizeObserver and re-renders responsively (which is what
   * the MutationObserver above is for); the ribbon passes a width and so opts
   * out, which is why layout.js re-renders it by hand on a viewport change.
   */
  _engrave(data, width) {
    if (this.renderer) this.renderer.clear();
    this.renderer = new NotationRenderer({
      container: this.container,
      ...(width ? { width } : {}),
    });
    this.renderer.render(data);
  }

  /** Rightmost extent of staff furniture in the current SVG (internal units). */
  _contentRightEdge() {
    const svg = this.container.querySelector('svg');
    let right = RIBBON_MIN_WIDTH;
    if (!svg) return right;
    for (const g of svg.querySelectorAll('.staff[data-staff-id], [data-voice-id]')) {
      try {
        const bb = g.getBBox();
        right = Math.max(right, bb.x + bb.width);
      } catch { /* detached */ }
    }
    return right;
  }

  /** Highest verse count carried by any soprano note (0 = no lyrics). */
  verseCount() {
    if (!this.song) return 0;
    const melody = this.song.voices.find((v) => v.id === 'soprano') || this.song.voices[0];
    let max = 0;
    for (const n of melody.notes) {
      if (Array.isArray(n.lyric)) max = Math.max(max, n.lyric.length);
      else if (n.lyric) max = Math.max(max, 1);
    }
    return max;
  }

  /** Rebuild the beat index and layout anchors after every (re)render. */
  _decorate() {
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    this.noteIndex.clear();
    this.activeEls = [];
    // data-beat is SYSTEM-RELATIVE (the renderer slices voices per system and
    // restarts its beat counter), so recover the absolute beat from the
    // group's data-start-measure.
    for (const group of svg.querySelectorAll('[data-voice-id]')) {
      const voiceId = group.getAttribute('data-voice-id');
      const systemStartBeat = this.gridStart(Number(group.getAttribute('data-start-measure') || 0));
      if (!this.noteIndex.has(voiceId)) this.noteIndex.set(voiceId, []);
      const list = this.noteIndex.get(voiceId);
      for (const el of group.querySelectorAll('[data-beat]')) {
        const beat = systemStartBeat + Number(el.getAttribute('data-beat'));
        el.dataset.absBeat = String(beat);
        list.push({ el, beat });
      }
    }
    for (const list of this.noteIndex.values()) list.sort((a, b) => a.beat - b.beat);
    this._measureAnchors(svg);
    this._applyLoopRange();
    if (this.lastBeat >= 0) this.setCursor(this.lastBeat, true);
  }

  /** Anchor positions (content-relative px) for ribbon follow + click-to-measure. */
  _measureAnchors(svg) {
    this._anchors = [];
    this._barlineXs = [];
    this._lastMeasure = -1;
    const scoreRect = this.container.getBoundingClientRect();
    for (const group of svg.querySelectorAll('[data-voice-id="soprano"][data-system-index]')) {
      const sys = Number(group.getAttribute('data-system-index'));
      for (const el of group.querySelectorAll('[data-beat]')) {
        const r = el.getBoundingClientRect();
        this._anchors.push({
          // absBeat was stamped by the indexing pass above; recovering the
          // absolute beat a second time here is how the two drift apart.
          beat: Number(el.dataset.absBeat),
          x: r.left + r.width / 2 - scoreRect.left,
          y: r.top + r.height / 2 - scoreRect.top,
          sys,
        });
      }
    }
    this._anchors.sort((a, b) => a.beat - b.beat);
    // Barline positions: the ribbon flick aligns a measure's OPENING barline
    // at the edge, since everything the measure owns — accidentals, wrong-side
    // noteheads, its first syllable — is engraved right of that barline. Note
    // anchors alone can't bound it: accidentals live in the staff group, not
    // the note's data-beat group, so note boxes miss them.
    for (const el of svg.querySelectorAll('.bar-line, .shared-bar-line')) {
      const r = el.getBoundingClientRect();
      this._barlineXs.push(r.left - scoreRect.left);
    }
    this._barlineXs.sort((a, b) => a - b);
  }

  /** Content-relative x of `measure`'s opening barline (its true left bound);
   *  falls back to the first-onset anchor when no barline is left of it. */
  _measureStartX(measure) {
    const noteX = this._xForBeat(this.gridStart(measure));
    let best = null;
    for (const x of this._barlineXs) {
      if (x < noteX - 1 && (best === null || x > best)) best = x;
    }
    return best === null ? noteX : best;
  }

  /** Interpolated content-relative x for a beat (ribbon follow). */
  _xForBeat(beat) {
    const a = this._anchors;
    if (!a.length) return 0;
    const i = lastAtOrBefore(a, beat);
    if (i < 0) return a[0].x;
    if (i === a.length - 1) return a[i].x;
    const span = a[i + 1].beat - a[i].beat;
    if (span <= 0) return a[i].x;
    return a[i].x + ((beat - a[i].beat) / span) * (a[i + 1].x - a[i].x);
  }

  // ---------- interaction ----------

  /** Click anywhere in a measure → playback jumps to that measure's beat 1. */
  _handleClick(e) {
    if (!this.onSeek || !this.song || !this._anchors.length) return;
    const el = e.target.closest('[data-beat]');
    const beat = el && el.dataset.absBeat !== undefined
      ? Number(el.dataset.absBeat)
      : this._beatNearPoint(e);
    if (beat === null) return;
    this._lastMeasure = -1; // let the ribbon flick re-align to the new measure
    this.onSeek(this.gridStart(this.measureAt(beat)));
  }

  /** Empty-space click: nearest system by y, then the last anchor left of it. */
  _beatNearPoint(e) {
    const rect = this.container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    let sys = null;
    let bestDy = Infinity;
    for (const a of this._anchors) {
      const dy = Math.abs(a.y - cy);
      if (dy < bestDy) { bestDy = dy; sys = a.sys; }
    }
    if (sys === null || bestDy > CLICK_SYSTEM_REACH) return null; // not on a system
    const inSys = this._anchors.filter((a) => a.sys === sys);
    const before = inSys.filter((a) => a.x <= cx);
    return (before.length ? before[before.length - 1] : inSys[0]).beat;
  }

  setMuted(mutedSet) {
    for (const id of VOICE_IDS) {
      this.container.classList.toggle(`mute-${id}`, mutedSet.has(id));
    }
  }

  /** Highlight the notes sounding at `beat` and auto-scroll to them. */
  setCursor(beat, force = false) {
    if (!force && Math.abs(beat - this.lastBeat) < BEAT_EPS) return;
    this.lastBeat = beat;
    for (const el of this.activeEls) el.classList.remove('sh-active');
    this.activeEls = [];
    let scrollTarget = null;
    for (const list of this.noteIndex.values()) {
      const idx = lastAtOrBefore(list, beat);
      if (idx < 0) continue;
      const { el } = list[idx];
      el.classList.add('sh-active');
      this.activeEls.push(el);
      if (!scrollTarget) scrollTarget = el;
    }
    if (this.mode === 'ribbon') this._followRibbon(beat);
    else if (scrollTarget) this._autoScroll(scrollTarget);
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
        if (beat >= this._loopStart - BEAT_EPS && beat < this._loopEnd - BEAT_EPS) {
          el.classList.add('in-loop');
        }
      }
    }
  }

  // ---------- scrolling ----------

  _followRibbon(beat) {
    if (performance.now() < this._userScrollUntil) return;
    // Measure-snap: hold still within a measure, then flick the newly-reached
    // measure flush to the left edge at each barline. Measure 0 scrolls all
    // the way home instead — opening a hymn (or rewinding it) should show the
    // clef and key signature, not start on bare noteheads.
    const measure = this.measureAt(beat);
    if (measure === this._lastMeasure) return;
    this._lastMeasure = measure;
    this._flickTo(measure === 0
      ? 0
      : Math.max(0, this._measureStartX(measure) - this._scrollEdge()));
  }

  _scrollEdge() {
    return window.matchMedia(MOBILE_QUERY).matches ? EDGE_PX.mobile : EDGE_PX.desktop;
  }

  /** Ease-out scroll tween. setTimeout-driven — native smooth scrollTo is
   *  unreliable across engines, and rAF stalls in unfocused tabs. */
  _flickTo(target, ms = FLICK_MS) {
    if (this._flickTimer) clearTimeout(this._flickTimer);
    // Whatever was mid-flight is cancelled above, so the flag has to come down
    // here and not in step(): the short-circuit below returns without ever
    // scheduling a step, and a stuck `_tweening` mutes drag-scrub for good.
    this._tweening = false;
    const from = this.wrap.scrollLeft;
    const delta = target - from;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    this._tweening = true;
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      this.wrap.scrollLeft = from + delta * (1 - (1 - t) ** 3);
      if (t < 1) this._flickTimer = setTimeout(step, 16);
      else this._tweening = false;
    };
    step();
  }

  /** Snap the playback position to the measure nearest the ribbon's left edge. */
  _scrubSeek() {
    if (!this.song || !this.onScrub || !this._anchors.length) return;
    const lastBeat = this._anchors[this._anchors.length - 1].beat;
    const edge = this.wrap.scrollLeft + this._scrollEdge();
    let best = 0;
    let bestDist = Infinity;
    for (let m = 0; this.gridStart(m) <= lastBeat + BEAT_EPS; m++) {
      const d = Math.abs(this._xForBeat(this.gridStart(m)) - edge);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    this._lastMeasure = best; // no immediate flick-back
    this._userScrollUntil = 0; // resume auto-follow from here
    this.onScrub(this.gridStart(best));
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
    const wrapRect = this.wrap.getBoundingClientRect();
    if (rect.top < wrapRect.top + 10 || rect.bottom > wrapRect.bottom - 10) {
      system.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

#!/usr/bin/env node
/**
 * Convert the legacy sing-harmony parallel-array song data into per-song JSON
 * in the shared resound schema (consumed by both resound-notation and
 * resound-sound).
 *
 * Legacy model (see calebhugo-com/sing-harmony-public):
 *   - 10 parallel arrays indexed [frame][songColumn]
 *   - each frame advances by `resolution` quarter-note beats
 *   - a non-empty note string marks an onset; its rhythm value = duration in frames
 *   - songData.subsPerMeasure is UNRELIABLE (e.g. Amazing Grace says 8, is 6),
 *     so meter is inferred by scoring candidate measure lengths
 *
 * Output model (public/songs/<slug>.json):
 *   { title, slug, category, tempo, timeSignature, keySignature, pickupBeats,
 *     tempoMap: [{beat, multiplier}],
 *     voices: [{ id, clef, displayOctave, notes: [ {pitch,length,dotted?,tie?} | {length,dotted?} ] }] }
 *   - pitch is TRUE (sounding) pitch; the app transposes tenor +1 octave for display
 *   - all beats are notated quarter-note units matching resound-notation's data-beat
 *   - tempo is notated-quarter BPM (compound meters converted)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const LEGACY = '/Users/calebhugo/Development/personal dev work.nosync/calebhugo-com/sing-harmony-public';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'songs');

// ---------- load legacy data ----------
const ctx = {};
vm.createContext(ctx);
for (const f of [
  'data/sopranoNotes.js', 'data/altoNotes.js', 'data/tenorNotes.js', 'data/bassNotes.js',
  'data/sopranoRhythm.js', 'data/altoRhythm.js', 'data/tenorRhythm.js', 'data/bassRhythm.js',
  'data/tempoChanges.js', 'data/songData.js', 'hymnSlugMap.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(LEGACY, f), 'utf8'), ctx);
}

// Song order + categories come from the DOM span order in index.html.
const html = fs.readFileSync(path.join(LEGACY, 'index.html'), 'utf8');
const songSpans = [...html.matchAll(/<span class="songLabels (\w+)" id="([^"]+)">([\s\S]*?)<br>/g)]
  .map((m) => ({ category: m[1], key: m[2], display: m[3].replace(/\s+/g, ' ').trim() }));
if (songSpans.length !== 74) throw new Error(`expected 74 song spans, got ${songSpans.length}`);

const CATEGORY_LABEL = {
  christmasSongs: 'Christmas',
  easterSongs: 'Easter',
  americanSongs: 'American',
  purchasedSongs: null,
  moreSongs: null,
};

const VOICES = [
  { id: 'soprano', notes: ctx.sopranoNotes, rhythm: ctx.sopranoRhythm, clef: 'treble', displayOctave: 0 },
  { id: 'alto', notes: ctx.altoNotes, rhythm: ctx.altoRhythm, clef: 'treble', displayOctave: 0 },
  { id: 'tenor', notes: ctx.tenorNotes, rhythm: ctx.tenorRhythm, clef: 'treble', displayOctave: 1 },
  { id: 'bass', notes: ctx.bassNotes, rhythm: ctx.bassRhythm, clef: 'bass', displayOctave: 0 },
];

// ---------- helpers ----------

// Notated length of one legacy subdivision, as a fraction of a whole note,
// chosen so compound meters render without tuplets.
function subUnitFor(resolution) {
  if (Math.abs(resolution - 0.5) < 1e-6) return 8;      // sub = eighth
  if (Math.abs(resolution - 0.25) < 1e-6) return 16;    // sub = sixteenth
  if (Math.abs(resolution - 1.0) < 1e-6) return 4;      // sub = quarter
  if (Math.abs(resolution - 1 / 3) < 1e-3) return 8;    // compound: sub = eighth in X/8
  if (Math.abs(resolution - 1 / 6) < 1e-3) return 16;   // compound: sub = sixteenth in X/8-ish
  throw new Error(`unhandled resolution ${resolution}`);
}

// Meter candidates (in subs per measure) per resolution.
function meterCandidates(resolution, legacyValue) {
  let cands;
  if (Math.abs(resolution - 0.5) < 1e-6) cands = [4, 6, 8, 12];
  else if (Math.abs(resolution - 0.25) < 1e-6) cands = [6, 8, 12, 16, 24];
  else if (Math.abs(resolution - 1.0) < 1e-6) cands = [2, 3, 4];
  else if (Math.abs(resolution - 1 / 3) < 1e-3) cands = [6, 9, 12];
  else cands = [6, 12, 18];
  if (legacyValue && !cands.includes(legacyValue)) cands.push(legacyValue);
  return cands;
}

function timeSignatureFor(resolution, subsPerMeasure) {
  const subUnit = subUnitFor(resolution);
  const isCompound = Math.abs(resolution - 1 / 3) < 1e-3 || Math.abs(resolution - 1 / 6) < 1e-3;
  if (isCompound) {
    // measure = subsPerMeasure subs; express in eighths
    const eighths = (subsPerMeasure * 8) / subUnit;
    return [eighths, 8];
  }
  const quarters = (subsPerMeasure * 4) / subUnit;
  if (Number.isInteger(quarters)) return [quarters, 4];
  return [(subsPerMeasure * 8) / subUnit, 8]; // e.g. 6 sixteenths -> 3/8
}

// Standard notated values in subs, largest first: plain + dotted 1/1..1/32.
function durationVocab(subUnit) {
  const vocab = [];
  for (const den of [1, 2, 4, 8, 16, 32]) {
    const plain = subUnit / den;
    const dotted = plain * 1.5;
    if (Number.isInteger(dotted) && dotted >= 1) vocab.push({ subs: dotted, length: `1/${den}`, dotted: true });
    if (Number.isInteger(plain) && plain >= 1) vocab.push({ subs: plain, length: `1/${den}`, dotted: false });
  }
  vocab.sort((a, b) => b.subs - a.subs);
  return vocab;
}

// Decompose a duration (in subs) into notated values, greedy largest-first.
function decompose(subs, vocab) {
  const out = [];
  let rem = subs;
  while (rem > 0) {
    const v = vocab.find((x) => x.subs <= rem);
    if (!v) throw new Error(`cannot decompose ${subs} subs`);
    out.push(v);
    rem -= v.subs;
  }
  return out;
}

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parsePitch(p) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p);
  if (!m) return null;
  const [, letter, acc, oct] = m;
  const pc = (LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  const midi = LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12 * (Number(oct) + 1);
  return { letter, acc: acc || '', oct: Number(oct), pc, midi };
}

// Key signatures: name -> altered letters (sharps or flats)
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const KEYS = [
  { name: 'C', sharps: 0 }, { name: 'G', sharps: 1 }, { name: 'D', sharps: 2 },
  { name: 'A', sharps: 3 }, { name: 'E', sharps: 4 }, { name: 'B', sharps: 5 },
  { name: 'F#', sharps: 6 },
  { name: 'F', sharps: -1 }, { name: 'Bb', sharps: -2 }, { name: 'Eb', sharps: -3 },
  { name: 'Ab', sharps: -4 }, { name: 'Db', sharps: -5 }, { name: 'Gb', sharps: -6 },
];
function keyAlterations(key) {
  const map = {};
  if (key.sharps > 0) for (let i = 0; i < key.sharps; i++) map[SHARP_ORDER[i]] = '#';
  if (key.sharps < 0) for (let i = 0; i < -key.sharps; i++) map[FLAT_ORDER[i]] = 'b';
  return map;
}
function tonicPc(key) {
  // major tonic pitch class
  const base = { C: 0, G: 7, D: 2, A: 9, E: 4, B: 11, 'F#': 6, F: 5, Bb: 10, Eb: 3, Ab: 8, Db: 1, Gb: 6 };
  return base[key.name];
}

function inferKey(events, finalBassPitch) {
  // events: [{pitch, durSubs}]
  let best = null;
  const finalPc = finalBassPitch ? parsePitch(finalBassPitch)?.pc : null;
  for (const key of KEYS) {
    const alt = keyAlterations(key);
    let cost = 0;
    for (const e of events) {
      const p = parsePitch(e.pitch);
      if (!p) continue;
      const expected = alt[p.letter] || '';
      if (p.acc !== expected) cost += e.durSubs;
    }
    // strong prior: hymns end on the tonic in the bass (major or relative minor)
    const relMinorPc = (tonicPc(key) + 9) % 12;
    if (finalPc !== null && finalPc !== tonicPc(key) && finalPc !== relMinorPc) cost += 1000;
    if (!best || cost < best.cost || (cost === best.cost && Math.abs(key.sharps) < Math.abs(best.key.sharps))) {
      best = { key, cost };
    }
  }
  return best.key.name;
}

// Hand-pinned meters/pickups (in unscaled subs) where the data quirks defeat
// inference — values checked against standard hymnals.
const METER_OVERRIDES = {
  'angels-we-have-heard-on-high': { M: 8, p: 0 },        // 4/4
  'the-lord-bless-you-and-keep-you': { M: 16, p: 0 },    // 4/4, real cross-bar ties
  'the-old-rugged-cross': { M: 6, p: 1 },                // 6/8, eighth pickup
  'o-holy-night': { M: 12, p: 0 },                       // 12/8
};

// ---------- conversion ----------
fs.mkdirSync(OUT, { recursive: true });
const index = [];
const report = [];

for (let s = 0; s < songSpans.length; s++) {
  const span = songSpans[s];
  const slug = ctx.hymnSlugMap[span.key];
  const warnings = [];
  if (!slug) { report.push({ title: span.key, error: 'no slug' }); continue; }

  const resolution = ctx.songData.resolution[s];
  const legacyTempo = ctx.songData.tempo[s];
  const pickupQuarters = ctx.songData.pickups[s];
  const legacySubs = ctx.songData.subsPerMeasure[s];
  const subUnit = subUnitFor(resolution);
  const vocab = durationVocab(subUnit);
  const nFrames = ctx.sopranoNotes.length;

  // 1. Extract per-voice onset events (in frames)
  const voiceEvents = VOICES.map((v) => {
    const events = [];
    for (let f = 0; f < nFrames; f++) {
      const note = v.notes[f]?.[s];
      if (note) {
        const r = v.rhythm[f]?.[s] || 1;
        events.push({ frame: f, durSubs: r, pitch: note });
      }
    }
    // truncate overlaps (next onset before current ends)
    for (let i = 0; i < events.length - 1; i++) {
      const gap = events[i + 1].frame - events[i].frame;
      if (events[i].durSubs > gap) {
        warnings.push(`${v.id} overlap truncated at frame ${events[i].frame}`);
        events[i].durSubs = gap;
      }
    }
    return events;
  });

  const allEvents = voiceEvents.flat();
  if (!allEvents.length) { report.push({ title: span.display, error: 'no notes' }); continue; }
  const f0 = Math.min(...allEvents.map((e) => e.frame));
  for (const e of allEvents) e.subOff = e.frame - f0;

  const isInt = (x) => Math.abs(x - Math.round(x)) < 5e-3;
  const k = [1, 2, 4].find((f) => allEvents.every((e) => isInt(e.durSubs * f)));
  if (!k) { report.push({ title: span.display, error: 'grid not normalizable' }); continue; }
  const lastEnd = Math.max(...allEvents.map((e) => e.subOff + e.durSubs));

  // Legacy pickup values are sloppy (0.999, half-subs, full measures), so the
  // pickup is inferred alongside the meter and the legacy value is only a prior.
  const legacyPickupSubs = pickupQuarters / resolution;

  // Final note of each voice is often an out-of-meter hold — exclude it from
  // meter scoring.
  const finalOffsets = new Set(voiceEvents.filter((ev) => ev.length)
    .map((ev) => ev[ev.length - 1].frame - f0));

  // 2. Infer meter + pickup: for each (M, p) candidate, barlines sit at
  //    subOff = p + n*M. Score by notes crossing barlines (bad) and long notes
  //    starting on downbeats (good), with legacy values as tie-break priors.
  const candidates = meterCandidates(resolution, legacySubs);
  const perM = new Map();
  for (const M of candidates) {
    let bestP = null;
    for (let p = 0; p < M; p++) {
      let crossings = 0;
      for (const e of allEvents) {
        if (finalOffsets.has(e.subOff)) continue;
        if (e.durSubs > M) continue; // fermata-style hold, not meter evidence
        const pos = ((e.subOff - p) % M + M) % M;
        if (pos + e.durSubs > M) crossings++;
      }
      const near = (a, b) => Math.abs(a - b) < 5e-3;
      let score = crossings;
      if (near(legacyPickupSubs % M, p) || near(legacyPickupSubs % M, M) && p === 0) score -= 0.5;
      else if (p === Math.round(legacyPickupSubs) % M) score -= 0.25;
      if (!bestP || score < bestP.score) bestP = { p, score, crossings };
    }
    perM.set(M, bestP);
  }
  // Trust the legacy meter when it fits cleanly; otherwise pick the meter with
  // the fewest barline crossings (smaller measure on ties).
  let best;
  if (perM.has(legacySubs) && perM.get(legacySubs).crossings === 0) {
    best = { M: legacySubs, ...perM.get(legacySubs) };
  } else {
    for (const M of [...candidates].sort((a, b) => a - b)) {
      const cand = { M, ...perM.get(M) };
      if (!best || cand.crossings < best.crossings) best = cand;
    }
  }
  if (METER_OVERRIDES[slug]) {
    best = { ...METER_OVERRIDES[slug], crossings: -1 };
    warnings.push('meter pinned by override');
  }
  const M0 = best.M;
  const pickupSubs = best.p;
  if (!METER_OVERRIDES[slug]) {
    if (M0 !== legacySubs) warnings.push(`meter inferred ${M0} subs/measure (legacy said ${legacySubs}), crossings=${best.crossings}`);
    if (Math.abs((legacyPickupSubs % M0) - pickupSubs) > 5e-3) warnings.push(`pickup inferred ${pickupSubs} subs (legacy said ${legacyPickupSubs.toFixed(3)})`);
  }
  const timeSignature = timeSignatureFor(resolution, M0);

  // Scale onto the integer grid: one legacy frame = k scaled subs.
  const subUnitScaled = subUnit * k;
  if (subUnitScaled > 32) { report.push({ title: span.display, error: `grid too fine (subUnit ${subUnitScaled})` }); continue; }
  const M = M0 * k;
  const vocabScaled = durationVocab(subUnitScaled);

  // 3. Build the shared timeline. Notation beat 0 = start of the padded first
  //    measure. padSubs of rest precede the pickup.
  const padSubs = pickupSubs > 0 ? (M0 - pickupSubs) * k : 0;
  const totalSubs = padSubs + Math.round(lastEnd * k);
  const tailPad = (M - (totalSubs % M)) % M;
  const subQuarters = 4 / subUnitScaled; // notated quarter-beats per scaled sub
  const tempo = Math.round(legacyTempo * (4 / subUnit) / resolution);

  // 4. Per-voice notated streams
  const voices = VOICES.map((v, vi) => {
    const events = voiceEvents[vi];
    const stream = []; // {startSub, durSubs, pitch|null}
    let cursor = 0;
    const pushRest = (from, to) => { if (to > from) stream.push({ startSub: from, durSubs: to - from, pitch: null }); };
    for (const e of events) {
      const start = padSubs + Math.round((e.frame - f0) * k);
      pushRest(cursor, start);
      const dur = Math.round(e.durSubs * k);
      stream.push({ startSub: start, durSubs: dur, pitch: e.pitch });
      cursor = start + dur;
    }
    pushRest(cursor, totalSubs + tailPad);

    // split at barlines + decompose into notated values
    const notes = [];
    for (const ev of stream) {
      let start = ev.startSub;
      let rem = ev.durSubs;
      const pieces = [];
      while (rem > 0) {
        const posInMeasure = start % M;
        const inMeasure = Math.min(rem, M - posInMeasure);
        for (const d of decompose(inMeasure, vocabScaled)) pieces.push(d);
        start += inMeasure;
        rem -= inMeasure;
      }
      pieces.forEach((d, i) => {
        const n = { length: d.length };
        if (d.dotted) n.dotted = true;
        if (ev.pitch) {
          n.pitch = ev.pitch;
          if (pieces.length > 1) n.tie = i === 0 ? 'start' : i === pieces.length - 1 ? 'stop' : 'continue';
        }
        notes.push(n);
      });
    }
    return { id: v.id, clef: v.clef, displayOctave: v.displayOctave, notes };
  });

  // 4b. Merge verse-1 lyrics (lyrics/<slug>.json: syllables aligned to soprano
  //     onsets — pitched notes that don't continue a tie; null = melisma)
  const lyricsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lyrics', `${slug}.json`);
  if (fs.existsSync(lyricsPath)) {
    const lyricData = JSON.parse(fs.readFileSync(lyricsPath, 'utf8'));
    // accept {syllables: [...]} (verse 1 only) or {verses: [[...], ...]}
    const verses = lyricData.verses || (lyricData.syllables ? [lyricData.syllables] : []);
    const soprano = voices[0];
    const slots = soprano.notes.filter((n) => n.pitch && n.tie !== 'continue' && n.tie !== 'stop');
    const good = verses.filter((v) => {
      if (v.length === slots.length) return true;
      warnings.push(`lyrics verse skipped: ${v.length} syllables vs ${slots.length} slots`);
      return false;
    });
    if (good.length) {
      let si = 0;
      for (const n of soprano.notes) {
        if (n.pitch && n.tie !== 'continue' && n.tie !== 'stop') {
          const i = si++;
          const perVerse = good.map((v) => v[i] ?? null);
          if (perVerse.some(Boolean)) {
            n.lyric = good.length === 1 ? (perVerse[0] || undefined) : perVerse;
          }
        }
      }
    }
  }

  // 5. Key inference (use all voices, weighted by duration; anchored by final bass note)
  const bassEvents = voiceEvents[3];
  const finalBass = bassEvents.length ? bassEvents[bassEvents.length - 1].pitch : null;
  const keySignature = inferKey(allEvents, finalBass);

  // 6. Tempo map (rits/accels) in notated beats
  const tempoMap = [];
  let lastMult = 1;
  for (let f = f0; f < lastEnd; f++) {
    const mult = ctx.tempoChanges[f]?.[s] ?? 1;
    if (mult !== lastMult) {
      tempoMap.push({ beat: (padSubs + (f - f0) * k) * subQuarters, multiplier: mult });
      lastMult = mult;
    }
  }

  // 7. Validation
  const audioRange = { min: 'C2', max: 'B5' };
  for (const e of allEvents) {
    const p = parsePitch(e.pitch);
    if (!p) warnings.push(`unparseable pitch ${e.pitch}`);
    else if (p.midi < 36 || p.midi > 83) warnings.push(`pitch ${e.pitch} outside piano range ${audioRange.min}-${audioRange.max}`);
  }
  for (const v of voices) {
    const total = v.notes.reduce((sum, n) => {
      const [num, den] = n.length.split('/').map(Number);
      return sum + (num / den) * (n.dotted ? 1.5 : 1) * subUnitScaled;
    }, 0);
    if (Math.abs(total - (totalSubs + tailPad)) > 1e-6) warnings.push(`${v.id} sums ${total} subs, expected ${totalSubs + tailPad}`);
  }

  const song = {
    title: span.display,
    slug,
    category: CATEGORY_LABEL[span.category] || null,
    tempo,
    timeSignature,
    keySignature,
    pickupBeats: pickupSubs * k * subQuarters,
    tempoMap,
    voices,
  };
  fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(song));
  index.push({
    slug, title: span.display, category: song.category,
    key: keySignature, timeSignature, tempo,
  });
  report.push({ title: span.display, meter: `${timeSignature[0]}/${timeSignature[1]}`, key: keySignature, warnings });
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ songs: index }));

// ---------- report ----------
let warnCount = 0;
for (const r of report) {
  if (r.error) { console.log(`ERROR  ${r.title}: ${r.error}`); warnCount++; continue; }
  const w = r.warnings.length ? `  [${r.warnings.join('; ')}]` : '';
  if (r.warnings.length) warnCount++;
  console.log(`${r.warnings.length ? 'WARN ' : 'ok   '} ${r.title.padEnd(40)} ${r.meter.padEnd(5)} ${r.key.padEnd(2)}${w}`);
}
console.log(`\n${report.length} songs, ${warnCount} with warnings`);

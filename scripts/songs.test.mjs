/**
 * The song-data contract, checked against every file in public/songs/.
 *
 * The songs are the app's content, and per README's "Adding songs" they are
 * WRITTEN BY HAND from here on (scripts/convert.mjs was the one-time import
 * from the legacy app, which will never produce another song). Hand-authored
 * four-voice JSON is exactly where these invariants get broken: a pickup the
 * voices don't fill, a note that overruns its measure, a tie with no stop, a
 * verse one syllable short.
 *
 * Everything asserted here is something a consumer depends on:
 * resound-notation THROWS on a pickup its voices do not fill exactly, renders
 * a wrong measure for any element that straddles a barline, and resound-sound
 * merges tie chains by pitch within a voice. src/songs.render.test.js puts
 * the same files through those consumers for real; this file states the rules
 * in one place and points at the offending song when one breaks.
 */
import fs from 'node:fs';
import path from 'node:path';

// jest runs from rootDir; import.meta is unavailable once babel-jest
// transpiles this file to CJS.
const ROOT = process.cwd();
const SONGS_DIR = path.join(ROOT, 'public', 'songs');
const LYRICS_DIR = path.join(ROOT, 'lyrics');
const EPS = 1e-6;

const slugs = fs.readdirSync(SONGS_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const load = (slug) => JSON.parse(fs.readFileSync(path.join(SONGS_DIR, `${slug}.json`), 'utf8'));

/** Sounding beats of one element; chords take their first length-bearing member. */
function elementBeats(element) {
  const note = Array.isArray(element) ? element.find((n) => n && n.length) : element;
  if (!note || !note.length) return 0;
  const [num, den] = note.length.split('/').map(Number);
  return (num / den) * 4 * (note.dotted ? 1.5 : 1);
}

const measureBeats = (song) => song.timeSignature[0] * (4 / song.timeSignature[1]);

/** The first barline strictly after `beat`, on the pickup-shifted grid. */
function nextBarline(beat, song) {
  const L = measureBeats(song);
  const p = song.pickupBeats || 0;
  if (beat < p - EPS) return p;
  return p + (Math.floor((beat - p) / L + EPS) + 1) * L;
}

/** Onsets that carry a lyric syllable: pitched notes that don't continue a tie. */
const slotCount = (notes) => notes.filter(
  (n) => !Array.isArray(n) && n.pitch && n.tie !== 'continue' && n.tie !== 'stop'
).length;

describe('song library', () => {
  // No song count is pinned here on purpose: adding a hymn is the expected
  // way this directory changes, and a test that fails on a legitimate
  // addition would just train people to ignore it.

  it('lists exactly the songs on disk in the index', () => {
    // The index is maintained BY HAND alongside each new song file (README:
    // "Adding songs"), so a song present but unlisted — or listed but
    // missing — is the likeliest mistake, and the app shows neither.
    const index = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, 'index.json'), 'utf8'));
    expect(index.songs.map((s) => s.slug).sort()).toEqual(slugs);
  });

  it('advertises the number of hymns it actually ships', () => {
    // index.html's footer is hand-written copy. No count is pinned to a literal
    // anywhere in this file on purpose, but the page and the catalog must agree
    // — otherwise the 75th hymn arrives and the site still promises 74.
    const index = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, 'index.json'), 'utf8'));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const claimed = /(\d+)\s+hymns/.exec(html);

    expect(claimed).not.toBeNull();
    expect(Number(claimed[1])).toBe(index.songs.length);
  });

  it('describes each song in the index the way the song file does', () => {
    // The list page reads title/key/meter/tempo from the index, the song page
    // from the file; a typo in one shows a hymn that changes key when opened.
    const index = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, 'index.json'), 'utf8'));
    const mismatches = [];
    for (const entry of index.songs) {
      const song = load(entry.slug);
      if (entry.title !== song.title) mismatches.push(`${entry.slug}: title`);
      if (entry.key !== song.keySignature) mismatches.push(`${entry.slug}: key`);
      if (entry.tempo !== song.tempo) mismatches.push(`${entry.slug}: tempo`);
      if (String(entry.timeSignature) !== String(song.timeSignature)) mismatches.push(`${entry.slug}: timeSignature`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe.each(slugs)('%s', (slug) => {
  const song = load(slug);
  const L = measureBeats(song);
  const pickup = song.pickupBeats || 0;

  it('carries the fields the app and both libraries read', () => {
    expect(typeof song.title).toBe('string');
    expect(song.slug).toBe(slug);
    expect(song.tempo).toBeGreaterThan(0);
    expect(song.timeSignature).toHaveLength(2);
    expect(typeof song.keySignature).toBe('string');
    expect(song.voices.map((v) => v.id)).toEqual(['soprano', 'alto', 'tenor', 'bass']);
  });

  it('gives every voice the same length', () => {
    const totals = song.voices.map((v) => v.notes.reduce((sum, n) => sum + elementBeats(n), 0));
    for (const total of totals) expect(total).toBeCloseTo(totals[0], 6);
  });

  it('uses only notated durations, with pitches inside the piano range', () => {
    const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    for (const voice of song.voices) {
      for (const note of voice.notes) {
        expect(Array.isArray(note)).toBe(false); // no chords in a 4-voice open score
        expect(note.length).toMatch(/^1\/(1|2|4|8|16|32)$/);
        if (!note.pitch) continue;
        const m = /^([A-G])(b|#)?(\d)$/.exec(note.pitch);
        expect(m).not.toBeNull();
        const midi = (Number(m[3]) + 1) * 12 + NAMES[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
        expect(midi).toBeGreaterThanOrEqual(36); // C2
        expect(midi).toBeLessThanOrEqual(83); // B5
      }
    }
  });

  it('keeps every note and rest inside one measure', () => {
    // resound-notation slices voices by measure; an element crossing a barline
    // is drawn in the wrong one. The converter splits and ties instead.
    const straddles = [];
    for (const voice of song.voices) {
      let beat = 0;
      for (const note of voice.notes) {
        const beats = elementBeats(note);
        if (beats > 0 && beat + beats > nextBarline(beat, song) + EPS) {
          straddles.push(`${voice.id} ${note.length} at beat ${beat} crosses ${nextBarline(beat, song)}`);
        }
        beat += beats;
      }
    }
    expect(straddles).toEqual([]);
  });

  it('forms well-shaped tie chains within a voice', () => {
    const problems = [];
    for (const voice of song.voices) {
      let open = null;
      voice.notes.forEach((note, i) => {
        const where = `${voice.id}[${i}]`;
        if (!note.pitch && note.tie) problems.push(`${where}: rest carries tie ${note.tie}`);
        if (note.tie === 'start') {
          if (open) problems.push(`${where}: tie start while ${open} is still open`);
          open = note.pitch;
        } else if (note.tie === 'continue' || note.tie === 'stop') {
          if (open !== note.pitch) problems.push(`${where}: ${note.tie} on ${note.pitch} with ${open || 'nothing'} open`);
          if (note.tie === 'stop') open = null;
        } else if (open) {
          problems.push(`${where}: ${open} tie never stopped`);
          open = null;
        }
      });
      if (open) problems.push(`${voice.id}: tie on ${open} still open at the end`);
    }
    expect(problems).toEqual([]);
  });

  if (pickup) {
    it('declares a pickup shorter than a measure that every voice fills exactly', () => {
      // resound-notation validates all of this and THROWS at render otherwise.
      expect(pickup).toBeGreaterThan(0);
      expect(pickup).toBeLessThan(L);
      const problems = [];
      for (const voice of song.voices) {
        let beat = 0;
        for (const note of voice.notes) {
          const beats = elementBeats(note);
          if (beats <= 0) continue;
          if (beat < pickup - EPS && beat + beats > pickup + EPS) {
            problems.push(`${voice.id}: element spanning ${beat}-${beat + beats} crosses the pickup`);
          }
          beat += beats;
          if (beat >= pickup - EPS) break;
        }
        if (beat < pickup - EPS) problems.push(`${voice.id}: content ends at ${beat}, short of the pickup`);
      }
      expect(problems).toEqual([]);
    });

    it('starts on sounding music, not on rest padding', () => {
      // The anacrusis used to be padded out to a full measure with leading
      // rests. It is a real short measure 0 now.
      expect(song.voices.some((v) => v.notes[0] && v.notes[0].pitch)).toBe(true);
    });

    it('ends on a short final measure (pickup + final = one measure)', () => {
      // The hymnal convention, checked against the original engravings.
      // jesus-paid-it-all is the known exception: its legacy final note runs
      // a beat long, so its last measure comes out full.
      const total = song.voices[0].notes.reduce((sum, n) => sum + elementBeats(n), 0);
      const final = ((total - pickup) % L + L) % L;
      const expected = slug === 'jesus-paid-it-all' ? 0 : L - pickup;
      expect(final).toBeCloseTo(expected, 6);
    });
  }

  const lyricsPath = path.join(LYRICS_DIR, `${slug}.json`);
  if (fs.existsSync(lyricsPath)) {
    it('lands every lyric verse on the soprano syllable slots', () => {
      // Slot drift is silent: the converter skips a mismatched verse with a
      // warning, and the hymn quietly loses a verse in the app.
      const data = JSON.parse(fs.readFileSync(lyricsPath, 'utf8'));
      const verses = data.verses || (data.syllables ? [data.syllables] : []);
      const slots = slotCount(song.voices[0].notes);
      for (const verse of verses) expect(verse).toHaveLength(slots);

      const carried = song.voices[0].notes.filter((n) => n.lyric !== undefined).length;
      if (verses.length) expect(carried).toBeGreaterThan(0);

      for (const [voiceId, entries] of Object.entries(data.voiceLyrics || {})) {
        const voice = song.voices.find((v) => v.id === voiceId);
        expect(voice).toBeDefined();
        expect(entries).toHaveLength(slotCount(voice.notes));
      }
    });
  }
});

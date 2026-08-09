/** @jest-environment jsdom */

/**
 * Multi-key rewrites, through the real libraries and the real consumers.
 *
 * The 74 shipped songs are canonical: the original key must hand back the
 * original object, byte-identical and unmutated. Every other key is derived —
 * deterministically — with the melody transposed and the inner parts
 * rewritten around it, pinned to the original progression, and it must
 * survive the same two oracles every shipped song passes: the notation
 * renderer and resound-sound's timeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTimeline } from 'resound-sound';
import { validateScore } from 'resound-harmony';
import { Score } from './score.js';
import { rekeySong, canonicalAnalysis, songMode, KEYS } from './rekey.js';

const load = (slug) => JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'public', 'songs', `${slug}.json`), 'utf8'),
);

const voiceBeats = (voice) => voice.notes.reduce((sum, n) => {
  const [num, den] = n.length.split('/').map(Number);
  return sum + (num / den) * 4 * (n.dotted ? 1.5 : 1);
}, 0);

describe('rekeySong', () => {
  const song = load('amazing-grace'); // G major, 3/4, pickup, five verses

  test('the original key IS the canonical object, untouched', async () => {
    const before = JSON.stringify(song);
    expect(await rekeySong(song, 'G')).toBe(song);
    await rekeySong(song, 'A');
    expect(JSON.stringify(song)).toBe(before); // rewrites never mutate it
  });

  test('a rewrite transposes the melody, keeps lyrics, rewrites the parts', async () => {
    const inA = await rekeySong(song, 'A');
    expect(inA.keySignature).toBe('A');
    expect(inA.rekeyedFrom).toBe('G');
    expect(inA.title).toBe(song.title);
    const soprano = inA.voices.find((v) => v.id === 'soprano');
    const origSoprano = song.voices.find((v) => v.id === 'soprano');
    expect(soprano.notes[0].pitch).toBe('E4'); // D4 up a step
    expect(soprano.notes.map((n) => n.lyric)).toEqual(origSoprano.notes.map((n) => n.lyric));
    expect(inA.voices.map((v) => v.id)).toEqual(['soprano', 'alto', 'tenor', 'bass']);
  });

  test('rewrites are deterministic (and cached: same object back)', async () => {
    expect(await rekeySong(song, 'A')).toBe(await rekeySong(song, 'A'));
    // Same data under two different slugs defeats both caches, forcing two
    // independent computations — this is the every-device guarantee: a group
    // singing from separate phones must see the SAME score. There is no
    // randomness anywhere in resound-harmony; this test is the tripwire in
    // case any ever sneaks in.
    const a = await rekeySong({ ...load('amazing-grace'), slug: 'det-check-1' }, 'Bb');
    const b = await rekeySong({ ...load('amazing-grace'), slug: 'det-check-2' }, 'Bb');
    expect(JSON.stringify(a.voices)).toBe(JSON.stringify(b.voices));
    expect(JSON.stringify(a.voices)).toContain('"Bb'); // sanity: actually in Bb
  });

  test('rewrites keep the canonical progression and clean part writing', async () => {
    const { analysis } = await canonicalAnalysis(song);
    const inA = await rekeySong(song, 'A');
    const byId = Object.fromEntries(inA.voices.map((v) => [v.id, v]));
    const { violations } = validateScore({
      soprano: byId.soprano.notes, alto: byId.alto.notes,
      tenor: byId.tenor.notes, bass: byId.bass.notes,
    });
    expect(violations).toEqual([]);
    const rewritten = (await canonicalAnalysis({ ...inA, slug: 'amazing-grace-in-a' })).analysis;
    const kept = rewritten.filter((a, i) => analysis[i] && a.symbol === analysis[i].symbol).length;
    expect(kept / analysis.length).toBeGreaterThan(0.85);
  });

  test.each(['A', 'Eb'])('the rewrite in %s passes the same oracles as shipped songs', async (target) => {
    const rekeyed = await rekeySong(song, target);

    document.body.innerHTML = '<div id="scoreWrap"><div id="score"></div></div>';
    const score = new Score(document.querySelector('#score'));
    expect(() => score.render(rekeyed)).not.toThrow();
    expect(document.querySelectorAll('#score svg [data-beat]').length).toBeGreaterThan(0);

    const { events, totalBeats } = buildTimeline(rekeyed);
    expect(totalBeats).toBeCloseTo(Math.max(...rekeyed.voices.map(voiceBeats)), 6);
    expect(events[0].beat).toBeLessThan(rekeyed.pickupBeats || 3);
  });

  test('a minor hymn stays minor in the new key', async () => {
    const minor = load('what-child-is-this'); // E minor behind a G signature
    expect(await songMode(minor)).toBe('minor');
    const inA = await rekeySong(minor, 'A'); // F# minor behind an A signature
    const bass = inA.voices.find((v) => v.id === 'bass');
    const last = [...bass.notes].reverse().find((n) => n.pitch);
    expect(last.pitch.startsWith('F#')).toBe(true);
  });

  test('every REWRITTEN key produces a clean score for a pickup hymn', async () => {
    // The original key is exempt by design: it returns the hand-curated
    // hymnal score verbatim, which pre-dates (and outranks) our rulebook.
    for (const target of KEYS.filter((k) => k !== song.keySignature)) {
      const rekeyed = await rekeySong(song, target);
      const byId = Object.fromEntries(rekeyed.voices.map((v) => [v.id, v]));
      const { violations } = validateScore({
        soprano: byId.soprano.notes, alto: byId.alto.notes,
        tenor: byId.tenor.notes, bass: byId.bass.notes,
      });
      expect({ target, violations }).toEqual({ target, violations: [] });
    }
  });
});

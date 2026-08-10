/**
 * Multi-key support: transpose the melody, regenerate alto/tenor/bass with
 * resound-harmony, pinned to the ORIGINAL hymn's chord progression.
 *
 * The 74 shipped songs are canonical: rekeySong(song, originalKey) returns
 * the very same object, untouched. Every other key is derived from it at
 * runtime — deterministically, so "Amazing Grace in A" is the same score
 * today, tomorrow, and on every device (a part you practiced yesterday must
 * not re-voice itself overnight). All musical interpretation lives in
 * resound-harmony (governing principle: no app-side translation layer);
 * this module only composes library calls and caches results.
 */

// resound-harmony is the largest dependency after the renderer, and nothing
// on the list page or the default-key song page needs it — only a key change
// (and the wheel's major/minor labels) do. Loading it on demand keeps it out
// of the boot bundle; main.js prefetches it during idle so the first key tap
// doesn't pay the network hop.
let harmonyModule = null;
let harmonyLoading = null;

/** Fetch the resound-harmony chunk (memoized). Safe to call early to prefetch. */
export function loadHarmony() {
  // Subpath imports, not the package barrel: a namespace import of the
  // barrel keeps every export alive in the chunk (embellish, leadsheet, …),
  // while importing only the three modules the app calls lets Rollup drop
  // the rest.
  harmonyLoading ??= Promise.all([
    import('resound-harmony/harmonize'),
    import('resound-harmony/analyze'),
    import('resound-harmony/transpose'),
  ]).then(([{ harmonize }, { analyzeScore }, { transposeNotes }]) => {
    harmonyModule = { harmonize, analyzeScore, transposeNotes };
    return harmonyModule;
  });
  return harmonyLoading;
}

/** The twelve key signatures, circle-of-fifths order, app spellings. */
export const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

/** Relative-minor display names, for hymns whose signature hides a minor key. */
export const RELATIVE_MINOR = {
  C: 'Am', G: 'Em', D: 'Bm', A: 'F#m', E: 'C#m', B: 'G#m',
  'F#': 'D#m', Db: 'Bbm', Ab: 'Fm', Eb: 'Cm', Bb: 'Gm', F: 'Dm',
};

// Registers that get another try when the standard chorale ranges leave a
// transposed melody nowhere to put its inner voices.
const WIDE_RANGES = {
  alto: ['F3', 'E5'],
  tenor: ['Bb2', 'A4'],
  bass: ['D2', 'D4'],
};

const analysisCache = new Map(); // slug -> { key, analysis }
const rekeyCache = new Map(); // `${slug}|${target}` -> song object

const voicesById = (song) => Object.fromEntries(song.voices.map((v) => [v.id, v]));

/**
 * Roman-numeral analysis of the canonical harmonization (cached per song).
 * Sync core — requires the chunk loaded; external callers use the async
 * export below.
 */
function analysisFor(song) {
  let cached = analysisCache.get(song.slug);
  if (!cached) {
    const byId = voicesById(song);
    // Not four-part (test fixtures, future one-off songs): nothing to pin to.
    if (!byId.soprano || !byId.alto || !byId.tenor || !byId.bass) return null;
    cached = harmonyModule.analyzeScore(
      { soprano: byId.soprano.notes, alto: byId.alto.notes, tenor: byId.tenor.notes, bass: byId.bass.notes },
      { key: song.keySignature, timeSignature: song.timeSignature, pickupBeats: song.pickupBeats || 0 },
    );
    analysisCache.set(song.slug, cached);
  }
  return cached;
}

/** Roman-numeral analysis of the canonical harmonization (cached per song). */
export async function canonicalAnalysis(song) {
  await loadHarmony();
  return analysisFor(song);
}

/** 'major' or 'minor', as the canonical harmonization reads. */
export async function songMode(song) {
  await loadHarmony();
  return analysisFor(song)?.key.mode || 'major';
}

/**
 * The song in another key. Same object back for the original key; otherwise
 * a new song object (the canonical one is never mutated) with the melody
 * transposed and the other parts rewritten around it. Async only for the
 * chunk load — the rewrite itself is synchronous and deterministic.
 */
export async function rekeySong(song, target) {
  if (target === song.keySignature) return song;
  const cacheKey = `${song.slug}|${target}`;
  let rekeyed = rekeyCache.get(cacheKey);
  if (rekeyed) return rekeyed;

  const { transposeNotes, harmonize } = await loadHarmony();
  const byId = voicesById(song);
  const analysis = analysisFor(song)?.analysis; // undefined = no pin
  const melody = transposeNotes(byId.soprano.notes, song.keySignature, target);
  const opts = {
    key: target,
    timeSignature: song.timeSignature,
    pickupBeats: song.pickupBeats || 0,
    progression: analysis,
    // Each generated voice mirrors ITS OWN original's rhythm (rests and the
    // antiphonal refrain echos included); echo runs come through as the
    // transposed originals, carrying their bass-staff lyrics.
    voiceTemplates: { alto: byId.alto.notes, tenor: byId.tenor.notes, bass: byId.bass.notes },
    templatesFromKey: song.keySignature,
    // Fallback homorhythm if templates are ever absent (not four-part).
    matchMelodyRhythm: true,
  };
  let result;
  try {
    result = harmonize(melody, opts);
  } catch {
    // Extreme registers: widen the chorale ranges before giving up.
    result = harmonize(melody, { ...opts, ranges: WIDE_RANGES });
  }

  rekeyed = {
    ...song,
    keySignature: target,
    rekeyedFrom: song.keySignature,
    voices: [
      { ...byId.soprano, notes: melody },
      result.alto,
      result.tenor,
      result.bass,
    ],
  };
  rekeyCache.set(cacheKey, rekeyed);
  return rekeyed;
}

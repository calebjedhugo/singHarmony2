# singHarmony2

Rewrite of the sing-harmony hymn app on resound-notation + resound-sound.
Live at https://sing-harmony-beta.calebhugo.com (Pi port 8101).

**All three resound deps are local `file:` links** (../resound-harmony,
../resound-notation, ../resound-sound) pending npm publishes of: two-voices-per-staff, multi-verse
lyrics, lyric spacing/baseline/size, tie flattening (notation) and
initInstruments eager init + instrumentReady (sound). After publishing, switch package.json back
to registry versions. Remember `npm run build` in each lib repo before an app
build — Vite bundles from their dist/.

Key UX: page/ribbon score modes (ribbon = one long system, measure-snap
horizontal scroll; default on phone landscape), verse picker, A-B loop,
per-voice mute, eager piano warm-up at page load (~2ms play-tap latency) with
a spinner on the play button for a tap that beats it there.

## Commands

```bash
npm run dev                  # Vite dev server
npm test                     # jest (jsdom), 806 tests
npm run build                # build to dist/
./deploy.sh                  # build + rsync dist/ to the Pi
npm run convert              # ONE-TIME legacy import — see below before running
```

**Run `npm test` after touching `public/songs/`, `lyrics/`, or either resound
library.** Songs are hand-written from here on (README: "Adding songs"), and
hand-authored four-voice JSON is where the schema gets broken — a pickup the
voices don't fill, a note overrunning its measure, a verse a syllable short.
`src/songs.render.test.js` puts every song through the REAL consumers (Score →
NotationRenderer, and resound-sound's `buildTimeline`), so the libraries judge
the data; it is also what tells you a library bump broke the catalog.
`scripts/songs.test.mjs` states the same rules directly and names the offending
song. Keep both: the renderer throws on a bad pickup, but resound-sound plays
it silently, so only the timeline assertions catch audio drifting from the
page. `src/score.test.js` covers the measure grid and the per-hymn verse
filter; `src/player.test.js` the adapter's loop/mute/warm-up policy;
`src/catalog.test.js` the two fetches' error behavior; `src/ui/*.test.js` the
controls and `src/main.test.js` the shell around them (routing, the two ways
back, the cursor lead, the boot warm-up) — all driven through the real buttons
in `index.html`, because the tests mount that file's body (see
`test/appMarkup.js`), so renaming an id fails a test instead of silently
unwiring a control. `main.test.js` boots the real module, so it is also what
catches a broken `?song=` route. Playback and engraving behavior itself
belongs to the libraries' own suites. Song data, `Score` and `Player` are the
real classes everywhere. What is faked is the environment jest cannot provide —
Web Audio (`test/audioMocks.js`), `scrollIntoView` (`test/domShims.js`), the CSS
import (`test/styleStub.js`) and `fetch` (per test) — plus what a test has to
hold still to observe: `layout.test.js` drives a `fakeScore()` because it tests
the mode DECISION, `controls.test.js` stubs `player.play()` to hold the promise
open and watch the button spin, and `player.test.js` hands the Player a
recording piano to assert on velocities. NOT covered anywhere: ribbon follow
and drag-scrub, which are layout geometry over bounding boxes that jsdom
reports as all-zero. They need a real browser.

**`npm run convert` is finished work, not a build step.** It imported the 74
hymns from the legacy app's parallel arrays; that app is done and will never
produce another song. Keep it only as the migration record and as the way to
RESHAPE all 74 at once if the schema changes (that is what regenerated them
for pickup measures on 2026-08-03). Re-running it rewrites `index.json` from
the legacy song list, so **any hand-added hymn would be dropped from the
index** — check for songs outside the legacy 74 first.

## Architecture

**GOVERNING PRINCIPLE (Caleb, 2026-07-21): the SAME untransformed note arrays
feed both resound-notation's render() and resound-sound's Sequencer. NO
app-side translation layer may interpret the data.** Honored since 2026-08-03:
tie merging, dotted math and the multi-voice beat clock now live in
resound-sound (`Sequencer` / `buildTimeline`, `src/SPEC-schema-playback.md`);
src/player.js is a thin adapter holding only app policy (which piano, when to
warm, the choir dynamic, A-B loop buttons). Never add data interpretation back
to the app; extend the libraries instead. The one array the app ever rewrites
is `score.js`'s `filterVerse()`, which is not an exception: it hides lyric
strings for the verse picker and touches no pitch, length, tie or beat, so both
consumers still read the same music. Anything that changes WHAT SOUNDS belongs
in the libraries.

- **Song JSON** (`public/songs/*.json`): shared resound schema. Pitches are TRUE
  sounding pitch (`C4` scientific). (Each voice also carries a `clef` and a
  `displayOctave` from the converter. Both are genuinely inert: `score.js`
  assigns staff and clef from its own STAFF_MAP and never falls back to the
  file's.) All timing in notated quarter-note beats —
  identical to resound-notation's `data-beat` values. `tempo` is notated-quarter
  BPM (compound meters already converted). `tempoMap` = rit/accel multipliers.
  `pickupBeats` is a REAL short measure 0 (the notation lib validates that every
  voice fills it exactly) — beat 0 is the first sounding beat, never a padded
  barline. 37 of the 74 songs have one.
- **Converter** (`scripts/convert.mjs`): reads the legacy parallel arrays from
  `calebhugo-com/sing-harmony-public/`. Legacy `subsPerMeasure`/`pickups` are
  UNRELIABLE — meter+pickup are inferred by scoring barline crossings, with
  `METER_OVERRIDES` pinning the few songs inference can't settle. Key signatures
  inferred from accidental usage + final bass note (relative minor allowed).
- **Playback** (`src/player.js`): adapter over resound-sound's `Sequencer` —
  hands it the song object untouched and exposes the app's controls. Velocity
  policy (by unmuted-voice count: 1→0.95 … 4→0.5, matching the Piano's velocity
  layers) is passed as a callback; `tailBeats: 2` keeps the cursor moving under
  the final chord. `warmUp()` owns the eager path: it builds the shared piano
  at page load and pre-renders C2–B5 (both spellings — song data is in flats)
  while the user is still on the list, so the play tap has nothing to render.
  `warmUp()` adopts the registry's instance synchronously (`getInstrument`),
  so a tap that beats the pre-render warms only ITS song's pitches, passed
  `{ front: true }` to jump the catalog-warm queue — never construct a second
  piano in `ensurePiano()`, or the gesture pays for the whole pre-render again
  with the warm buffers sitting right there. The short wait for the song's own
  pitches is what the play button's spinner shows. (The pre-render itself runs
  through Piano's bounded pool — 4 offline renders at a time — because
  launching all 192 at once OOM-crashed small phones.)
- **Score** (`src/score.js`): close score — S+A on the treble staff, T+B on the
  bass staff, braced, everyone at true pitch (no tenor 8va). NotationRenderer
  re-creates its SVG on responsive reflow, so ALL decoration (cursor index,
  anchors, loop tint) re-applies via MutationObserver. Voice coloring is pure
  CSS on `[data-voice-id]`. `gridStart(m)` / `measureAt(beat)` mirror
  resound-notation's `measureGrid` (pickup = measure 0) and are THE source for
  every beat↔measure mapping: ribbon follow, click-to-seek, drag-scrub, system
  start beats. `render()` owns per-hymn state: a NEW song object resets the
  verse filter, the cursor beat and the last-scrolled system, while re-rendering
  the SAME one (verse pick, mode flip, resize) keeps all three. No caller has to
  remember to clear them — and none should, since a re-render must not throw
  away the reader's verse pick or jump the page mid-playback.
- **UI** (`src/main.js` + `src/ui/`): `main.js` is the shell — it owns the two
  views, `?song=slug` routing, and the boot sequence (warm the piano, fetch the
  catalog, then route). The policy it holds is small and all of it is about
  those two jobs: the 100ms cursor lead (the highlight has a 100ms CSS
  transition), the per-song `warmAhead()`, and keeping a dead `?song=` in the
  address bar so a reload retries it. It owns no controls. Those live in three
  factories that each take the player and/or score and wire one region of
  `index.html`: `ui/songList.js` (list + search), `ui/controls.js` (transport,
  tempo, A-B loop, verse picker, SATB chips), `ui/layout.js` (page/ribbon mode,
  orientation, hamburger, rotate hint). `catalog.js` is the only place that
  fetches. Keep app policy in these modules and data interpretation out of all
  of them.

## Multi-key (rekey)

**The 74 shipped songs are CANONICAL.** They were curated by hand from public
domain literature; nothing regenerates or rewrites them, and the original key
always shows the original file verbatim (`rekeySong(song, originalKey) ===
song`). Every other key is derived at runtime: melody transposed
(`transposeNotes`), alto/tenor/bass rewritten by resound-harmony, **pinned to
the original progression** (`analyzeScore` of the canonical four parts →
`harmonize({ progression })`). This honors the governing principle — all
musical interpretation lives in resound-harmony; `src/rekey.js` only composes
library calls and caches.

- **Deterministic by design** (decision, 2026-08-07): the same key always
  yields the same score. Singers practicing a part must not have it re-voice
  itself between sessions — and a GROUP singing from separate phones must
  all see the same music, so determinism must hold ACROSS devices, not just
  within one. There is NO randomness anywhere in resound-harmony or this
  app (no Math.random, no time-seeded anything; audited 2026-08-08), so no
  seed is needed: identical build → identical score on every instance. The
  determinism test in `rekey.test.js` recomputes under two cache-defeating
  slugs and is the tripwire if randomness ever sneaks in. The in-memory
  cache is just speed. A resound-harmony version bump MAY change rewrites —
  that's a release note, not a bug — but within a deployed build, output is
  stable everywhere.
- **Key picker** = circle of fifths (`src/ui/keyWheel.js`, opened from the
  key chip in the song header). Twelve 30° donut wedges — finger-sized on
  phones. Minor hymns label the wheel with relative minors (Em, not G).
  Original key = dashed ring; current = filled.
- Rewrites in extreme registers retry once with widened ranges
  (`WIDE_RANGES` in rekey.js) before giving up; `changeKey()` in main.js
  stays on the current key if the engine throws.
- `src/rekey.test.js` is the gate: originals unmutated, rewrites through the
  same two oracles as shipped songs (NotationRenderer + buildTimeline),
  clean `validateScore`, progression ≥85% kept, all 12 wheel keys valid.
  **The canonical files are exempt from validateScore by design** — hymnal
  part writing predates (and outranks) the package's rulebook.
- Rekeys are TEMPLATE-BASED (2026-08-08): each generated voice mirrors its
  own ORIGINAL's attack pattern (rests included — antiphonal refrains
  survive), and passages where the original is melodic rather than harmonic
  (texted echo phrases, off-grid runs, T/B unison spans) come through as the
  TRANSPOSED originals with their lyrics. Bass-staff lyric lines (It Is
  Well, Wonderful Grace of Jesus) therefore survive rekeying. Chord changes
  under held melody notes (analyzer sub-slots) regenerate correctly too.
  Rekeyed antiphonal songs may carry validateScore flags inside template
  spans — that content mirrors the canonical original, which is exempt from
  the rulebook by design.

## Lyrics pipeline

- `lyrics/<slug>.json`: `{"slug", "verses": [[...], ...]}` — one inner array per
  verse, one entry per soprano "slot" (pitched note, tie ∉ {continue, stop});
  string = syllable (trailing hyphen if word continues), null = melisma.
  Optional keys:
  - `"splits"`: `[{slot, lengths: ["1/4","1/4"], voices: [...]}]` — divides a
    long note into same-pitch untied notes (matched by beat in each listed
    voice) so later verses can carry an extra syllable where verse 1 sings a
    melisma. Image-verified per song (Holy Holy Holy, The Old Rugged Cross).
  - `"voiceLyrics"`: `{"bass": [entries]}` — single per-voice text line aligned
    to THAT voice's slots (the It Is Well tenor/bass echo). Data-correct
    encoding; never fake simultaneous text as an extra verse.
- Converter validates every verse length against the slot count; mismatches are
  skipped with a warning, never forced.
- Provenance: aligned by Sonnet agents from the legacy lyric pages + rhythm
  data (NOT images — image reading is the expensive path). Spot-audits against
  the original engraved PNGs (`calebhugo-com/sing-harmony-public/Music/<Title>/`)
  validated the method (Amazing Grace: 175/175 syllable placements correct).
  Known content notes: capitalization/punctuation is modern sentence-case, not
  the engraving's verse-initial-only style — deliberate.

## Gotchas

- The score is the hymnal's CLOSE score (two voices per staff), which needs
  resound-notation's two-voices-per-staff support — one of the local-only
  features listed at the top. Reverting to a published version without it
  breaks the layout, not just the build.
- Pickup songs end on a SHORT final measure (pickup + final = one full measure,
  checked against the engravings) and get NO filler rests. `jesus-paid-it-all`
  is the one song whose legacy final note runs a beat long, so its last measure
  renders full instead of short — data quirk, flagged not guessed.
- SVG elements don't implement the `hidden` IDL property — use
  `toggleAttribute('hidden', …)`.
- `window.__sh = {player, score}` is exposed for browser-console debugging.
- Both resound libs are ESM-only npm packages by the same author; local repos
  live in `../resound-notation` and `../resound-sound`.

## Deploy (infra details)

nginx vhost `sing-harmony-beta.calebhugo.com` on Pi `127.0.0.1:8101`, webroot
`/var/www/sing-harmony-beta.calebhugo.com/`, ingress in
`/home/chugo/.cloudflared/calebhugo-tunnel.yml`, DNS via
`cloudflared tunnel route dns calebhugo sing-harmony-beta.calebhugo.com`.
Standard static-site security headers; no unsafe-inline needed (Vite bundles).

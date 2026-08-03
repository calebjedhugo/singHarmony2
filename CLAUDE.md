# singHarmony2

Rewrite of the sing-harmony hymn app on resound-notation + resound-sound.
Live at https://sing-harmony-beta.calebhugo.com (Pi port 8101).

**Both resound deps are local `file:` links** (../resound-notation,
../resound-sound) pending npm publishes of: two-voices-per-staff, multi-verse
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
npm test                     # jest (jsdom), 788 tests
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
page. `src/score.test.js` covers the measure grid; `src/player.test.js` the
adapter's loop/mute/warm-up policy; `src/ui/*.test.js` the controls, driven
through the real buttons in `index.html` (the tests mount that file's body —
see `test/appMarkup.js` — so renaming an id fails a test instead of silently
unwiring a control). Playback and engraving behavior itself belongs to the
libraries' own suites.

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
to the app; extend the libraries instead.

- **Song JSON** (`public/songs/*.json`): shared resound schema. Pitches are TRUE
  sounding pitch (`C4` scientific). (Each voice also carries a `clef` and a
  `displayOctave` from the converter; the close score assigns both itself, so
  they are inert legacy fields.) All timing in notated quarter-note beats —
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
  A tap that beats it there waits on resound-sound's `instrumentReady()` and
  takes THAT init's piano — never construct a second one in `ensurePiano()`,
  or the gesture pays for the whole pre-render again with the warm buffers
  sitting right there. The wait is what the play button's spinner shows.
- **Score** (`src/score.js`): close score — S+A on the treble staff, T+B on the
  bass staff, braced, everyone at true pitch (no tenor 8va). NotationRenderer
  re-creates its SVG on responsive reflow, so ALL decoration (cursor index,
  anchors, loop tint) re-applies via MutationObserver. Voice coloring is pure
  CSS on `[data-voice-id]`. `gridStart(m)` / `measureAt(beat)` mirror
  resound-notation's `measureGrid` (pickup = measure 0) and are THE source for
  every beat↔measure mapping: ribbon follow, click-to-seek, drag-scrub, system
  start beats.
- **UI** (`src/main.js` + `src/ui/`): `main.js` is the shell — it owns the two
  views, `?song=slug` routing, and nothing else. The controls live in three
  factories that each take the player and/or score and wire one region of
  `index.html`: `ui/songList.js` (list + search), `ui/controls.js` (transport,
  tempo, A-B loop, verse picker, SATB chips), `ui/layout.js` (page/ribbon mode,
  orientation, hamburger, rotate hint). `catalog.js` is the only place that
  fetches. Keep app policy in these modules and data interpretation out of all
  of them.

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

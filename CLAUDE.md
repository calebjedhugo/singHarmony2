# singHarmony2

Rewrite of the sing-harmony hymn app on resound-notation + resound-sound.
Live at https://sing-harmony-beta.calebhugo.com (Pi port 8101).

**Both resound deps are local `file:` links** (../resound-notation,
../resound-sound) pending npm publishes of: two-voices-per-staff, multi-verse
lyrics, lyric spacing/baseline/size, tie flattening (notation) and
initInstruments eager init (sound). After publishing, switch package.json back
to registry versions. Remember `npm run build` in each lib repo before an app
build — Vite bundles from their dist/.

Key UX: page/ribbon score modes (ribbon = one long system, measure-snap
horizontal scroll; default on phone landscape), verse picker, A-B loop,
per-voice mute, eager piano warm-up at page load (~2ms play-tap latency).

## Commands

```bash
npm run dev                  # Vite dev server
npm test                     # jest (jsdom), 586 tests — RUN AFTER npm run convert
npm run build                # build to dist/
npm run convert              # regenerate public/songs/ from legacy data
./deploy.sh                  # build + rsync dist/ to the Pi
```

**IMPORTANT: `npm run convert` rewrites all 74 songs at once — always follow it
with `npm test`.** `scripts/songs.test.mjs` asserts the data contract both
libraries depend on (voice lengths agree, nothing straddles a barline, pickups
are filled exactly and start on real music, tie chains are well-formed, lyric
verses match the soprano slot count). It is the only automatic check that a
converter change didn't quietly break a hymn. `src/score.test.js` covers the
measure grid against a real render; `src/player.test.js` covers the adapter's
loop/mute/tempo policy. Playback and engraving behavior itself belongs to the
libraries' own suites.

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
  sounding pitch (`C4` scientific); the app transposes tenor +1 octave for
  display only (`displayOctave`). All timing in notated quarter-note beats —
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
  the final chord.
- **Score** (`src/score.js`): NotationRenderer re-creates its SVG on responsive
  reflow, so ALL decoration (labels, cursor index, mute classes) re-applies via
  MutationObserver. Voice coloring is pure CSS on `[data-voice-id]`.
  `gridStart(m)` / `measureAt(beat)` mirror resound-notation's `measureGrid`
  (pickup = measure 0) and are THE source for every beat↔measure mapping:
  ribbon follow, click-to-seek, drag-scrub, system start beats.

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

- resound-notation renders ONE VOICE PER STAFF (no shared-staff SATB). The
  4-staff open score is deliberate.
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

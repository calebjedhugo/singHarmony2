# singHarmony2

Rewrite of the sing-harmony hymn app on resound-notation + resound-sound.
Live at https://sing-harmony-beta.calebhugo.com (Pi port 8101).

## Commands

```bash
npm run dev                  # Vite dev server
npm run build                # build to dist/
npm run convert              # regenerate public/songs/ from legacy data
./deploy.sh                  # build + rsync dist/ to the Pi
```

## Architecture

- **Song JSON** (`public/songs/*.json`): shared resound schema. Pitches are TRUE
  sounding pitch (`C4` scientific); the app transposes tenor +1 octave for
  display only (`displayOctave`). All timing in notated quarter-note beats —
  identical to resound-notation's `data-beat` values. `tempo` is notated-quarter
  BPM (compound meters already converted). `tempoMap` = rit/accel multipliers.
- **Converter** (`scripts/convert.mjs`): reads the legacy parallel arrays from
  `calebhugo-com/sing-harmony-public/`. Legacy `subsPerMeasure`/`pickups` are
  UNRELIABLE — meter+pickup are inferred by scoring barline crossings, with
  `METER_OVERRIDES` pinning the few songs inference can't settle. Key signatures
  inferred from accidental usage + final bass note (relative minor allowed).
- **Playback** (`src/player.js`): own beat-clock sequencer calling
  `piano.startNote()` per onset (NOT resound-sound's `play()` — that can't do
  live mute/tempo/seek). Ties merged at load. Velocity by unmuted-voice count:
  1→0.95 … 4→0.5 (matches the Piano's velocity layers).
- **Score** (`src/score.js`): NotationRenderer re-creates its SVG on responsive
  reflow, so ALL decoration (labels, cursor index, mute classes) re-applies via
  MutationObserver. Voice coloring is pure CSS on `[data-voice-id]`.

## Gotchas

- resound-notation renders ONE VOICE PER STAFF (no shared-staff SATB). The
  4-staff open score is deliberate.
- No pickup-measure support in the notation lib — the anacrusis is padded with
  leading rests by the converter.
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

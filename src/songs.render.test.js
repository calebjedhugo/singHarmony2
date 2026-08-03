/** @jest-environment jsdom */

/**
 * Every shipped song, through the real consumers.
 *
 * scripts/songs.test.mjs checks the data against the contract as this repo
 * understands it — which means it can only catch mistakes this repo's own
 * arithmetic doesn't share. This suite uses the LIBRARIES as the oracle
 * instead: it renders each song through the same Score path main.js uses
 * (resound-notation validates pickups and measure fill, and throws), and
 * builds each song's playback timeline through resound-sound.
 *
 * The two halves fail differently, which is the point. On bad pickup data the
 * renderer throws loudly; resound-sound just plays it, silently starting the
 * hymn late — so the timeline assertions below are the only thing standing
 * between a converter mistake and a hymn whose audio drifts from its page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildTimeline } from 'resound-sound';
import { Score } from './score.js';

const SONGS_DIR = path.join(process.cwd(), 'public', 'songs');
const slugs = fs.readdirSync(SONGS_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const load = (slug) => JSON.parse(fs.readFileSync(path.join(SONGS_DIR, `${slug}.json`), 'utf8'));

/** Notated length of a voice, in quarter-note beats. */
const voiceBeats = (voice) => voice.notes.reduce((sum, n) => {
  const [num, den] = n.length.split('/').map(Number);
  return sum + (num / den) * 4 * (n.dotted ? 1.5 : 1);
}, 0);

describe.each(slugs)('%s', (slug) => {
  const song = load(slug);

  it('engraves without the notation library rejecting it', () => {
    document.body.innerHTML = '<div id="scoreWrap"><div id="score"></div></div>';
    const score = new Score(document.querySelector('#score'));

    expect(() => score.render(song)).not.toThrow();
    expect(document.querySelectorAll('#score svg [data-beat]').length).toBeGreaterThan(0);
  });

  it('plays back on the same timeline it is engraved on', () => {
    const { events, totalBeats } = buildTimeline(song);

    // Same length the page shows: audio that runs long or short of the score
    // means the two systems disagree about the data.
    expect(totalBeats).toBeCloseTo(Math.max(...song.voices.map(voiceBeats)), 6);
    expect(events.length).toBeGreaterThan(0);

    // The hymn must SOUND from its first measure. Rest-padding a pickup back
    // in would leave the notation valid-looking while playback started a
    // measure late, which is exactly the failure this catches.
    const measure = song.timeSignature[0] * (4 / song.timeSignature[1]);
    expect(events[0].beat).toBeLessThan(song.pickupBeats || measure);
    expect(events[events.length - 1].beat).toBeLessThan(totalBeats + 1e-6);
  });
});

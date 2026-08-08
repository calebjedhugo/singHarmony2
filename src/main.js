/**
 * App shell: boots the player and the score, wires the three UI modules to
 * them, and routes between the song list and a song (`?song=slug`).
 */
import './style.css';
import { fetchIndex, fetchSong } from './catalog.js';
import { Player } from './player.js';
import { Score } from './score.js';
import { createControls } from './ui/controls.js';
import { createKeyWheel } from './ui/keyWheel.js';
import { createLayout } from './ui/layout.js';
import { createSongList } from './ui/songList.js';
import { rekeySong, songMode } from './rekey.js';

const $ = (sel) => document.querySelector(sel);
const listView = $('#listView');
const songView = $('#songView');
const backBtn = $('#backBtn');

const player = new Player();
const score = new Score($('#score'), {
  onSeek: (beat) => player.seek(beat),
  // drag-scrub in ribbon mode: playback start snaps to the nearest measure
  onScrub: (beat) => player.seek(beat),
});
const controls = createControls({ player, score });
const layout = createLayout({ score });
const songList = createSongList({
  listEl: $('#songList'),
  searchEl: $('#search'),
  onOpen: (slug) => openSong(slug, true),
});
const keyWheel = createKeyWheel({ onPick: (key) => changeKey(key) });

// The canonical song as fetched — every key change derives from THIS object,
// never from a previous rewrite.
let baseSong = null;

player.onTick = (beat) => {
  // lead the highlight by 100ms so its transition is fully in at note onset
  const lead = player.playing ? 0.1 / player.secPerBeat(beat) : 0;
  score.setCursor(beat + lead);
};

// ---------- views ----------
async function openSong(slug, push) {
  const song = await fetchSong(slug);
  if (!song) {
    // A renamed hymn, or a dead connection — fetchSong() cannot tell them
    // apart. Show the list rather than a blank song view, but leave ?song= in
    // the address bar: it costs nothing, and it makes a reload retry the hymn
    // once the network (or the file) comes back.
    showList(push);
    return;
  }
  baseSong = song;
  player.load(song);
  player.warmAhead(); // pre-render this song's pitches before the play tap
  $('#songTitle').textContent = song.title;
  setMeta(song);
  keyWheel.showSong({
    original: song.keySignature,
    current: song.keySignature,
    mode: songMode(song),
  });
  // Unhide BEFORE rendering: the ribbon render measures its own probe SVG
  // with getBBox(), which reads 0 inside a display:none subtree and collapses
  // the whole score to its minimum width (page mode self-heals through the
  // renderer's ResizeObserver; ribbon opts out of it and stays broken).
  listView.hidden = true;
  songView.hidden = false;
  backBtn.hidden = false;
  layout.prepareMode(); // before render: setMode() would re-render the old song
  score.render(song);
  score.setMuted(player.muted);
  score.setCursor(player.beat, true);
  controls.showSong(song);
  layout.showSong(song);
  if (push) history.pushState({ slug }, '', `?song=${slug}`);
  document.title = `${song.title} · How to Sing Harmony`;
}

function setMeta(song) {
  // keyBtn + meterVal concatenate to the same "G · 3/4" the header always
  // showed — the key is just tappable now.
  $('#keyBtn').textContent = song.keySignature;
  $('#meterVal').textContent = ` · ${song.timeSignature[0]}/${song.timeSignature[1]}`;
}

/**
 * Re-open the current hymn in another key: melody transposed, alto/tenor/
 * bass rewritten around it (rekey.js), pinned to the original progression.
 * The canonical key always shows the canonical, hand-curated score.
 */
async function changeKey(target) {
  if (!baseSong) return;
  keyWheel.setBusy(true);
  // Let the busy state paint before the (synchronous) rewrite starts.
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    const song = rekeySong(baseSong, target);
    player.load(song);
    player.warmAhead(); // the new key's accidentals may not be pre-rendered
    setMeta(song);
    score.render(song);
    score.setMuted(player.muted);
    score.setCursor(player.beat, true);
    controls.showSong(song);
    keyWheel.setCurrent(target);
  } catch (err) {
    // A key the engine can't voice for this tune: stay where we are.
    console.error(`Could not rewrite in ${target}:`, err);
  } finally {
    keyWheel.setBusy(false);
  }
}

function showList(push) {
  controls.hideSong();
  layout.showList();
  listView.hidden = false;
  songView.hidden = true;
  backBtn.hidden = true;
  if (push) history.pushState({}, '', location.pathname);
  document.title = 'How to Sing Harmony';
}

// two ways back: the topbar arrow on desktop, the menu link on mobile
for (const el of [backBtn, $('#backBtn2')]) {
  el.addEventListener('click', () => showList(true));
}

// ---------- routing ----------
function route(push) {
  const slug = new URLSearchParams(location.search).get('song');
  if (slug) openSong(slug, push);
  else showList(push);
}

window.addEventListener('popstate', () => route(false));

// ---------- boot ----------
// Warm the piano across the whole catalog's range while the user is still on
// the song list, so the first play tap has nothing left to render (~2ms).
player.warmUp();
fetchIndex()
  .then((songs) => songList.setSongs(songs))
  .catch(() => songList.showError('Could not load the hymn list. Check your connection and reload.'))
  .finally(() => route(false));

// debugging handle (also used by automated tests)
window.__sh = { player, score };

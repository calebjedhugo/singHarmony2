/**
 * App shell: boots the player and the score, wires the three UI modules to
 * them, and routes between the song list and a song (`?song=slug`).
 */
import './style.css';
import { fetchIndex, fetchSong } from './catalog.js';
import { Player } from './player.js';
import { Score } from './score.js';
import { createControls } from './ui/controls.js';
import { createLayout } from './ui/layout.js';
import { createSongList } from './ui/songList.js';

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
  player.load(song);
  player.warmAhead(); // pre-render this song's pitches before the play tap
  $('#songTitle').textContent = song.title;
  $('#songMeta').textContent = `${song.keySignature} · ${song.timeSignature[0]}/${song.timeSignature[1]}`;
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

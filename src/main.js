import './style.css';
import { Player } from './player.js';
import { Score } from './score.js';

const $ = (sel) => document.querySelector(sel);
const listView = $('#listView');
const songView = $('#songView');
const songListEl = $('#songList');
const searchEl = $('#search');
const backBtn = $('#backBtn');
const playBtn = $('#playBtn');
const tempoEl = $('#tempo');
const tempoVal = $('#tempoVal');
const statusEl = $('#status');

const VOICES = [
  { id: 'soprano', label: 'Soprano' },
  { id: 'alto', label: 'Alto' },
  { id: 'tenor', label: 'Tenor' },
  { id: 'bass', label: 'Bass' },
];

const player = new Player();
const score = new Score($('#score'), { onSeek: (beat) => player.seek(beat) });
let songIndex = [];
let current = null;

player.onTick = (beat) => score.setCursor(beat);
player.onEnd = () => setPlayingUI(false);

// ---------- song list ----------
async function loadIndex() {
  const res = await fetch('/songs/index.json');
  songIndex = (await res.json()).songs;
  renderList();
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  songListEl.innerHTML = '';
  for (const s of songIndex) {
    if (q && !s.title.toLowerCase().includes(q)) continue;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'song-item';
    btn.innerHTML = `
      <span class="song-title">${s.title}</span>
      <span class="song-badges">
        ${s.category ? `<span class="badge badge-cat">${s.category}</span>` : ''}
        <span class="badge">${s.key}</span>
        <span class="badge">${s.timeSignature[0]}/${s.timeSignature[1]}</span>
      </span>`;
    btn.addEventListener('click', () => openSong(s.slug, true));
    li.appendChild(btn);
    songListEl.appendChild(li);
  }
}
searchEl.addEventListener('input', renderList);

// ---------- song view ----------
async function openSong(slug, push) {
  const res = await fetch(`/songs/${slug}.json`);
  if (!res.ok) return showList(push);
  const song = await res.json();
  current = song;
  player.load(song);
  $('#songTitle').textContent = song.title;
  $('#songMeta').textContent =
    `${song.keySignature} major · ${song.timeSignature[0]}/${song.timeSignature[1]}`;
  tempoEl.value = song.tempo;
  tempoVal.textContent = `${song.tempo}`;
  player.bpm = song.tempo;
  listView.hidden = true;
  songView.hidden = false;
  backBtn.hidden = false;
  player.clearLoop();
  setPlayingUI(false);
  score.render(song);
  score.setMuted(player.muted);
  score.setCursor(player.beat, true);
  refreshLoopUI();
  if (push) history.pushState({ slug }, '', `?song=${slug}`);
  document.title = `${song.title} · How to Sing Harmony`;
}

function showList(push) {
  player.pause();
  setPlayingUI(false);
  current = null;
  listView.hidden = false;
  songView.hidden = true;
  backBtn.hidden = true;
  if (push) history.pushState({}, '', location.pathname);
  document.title = 'How to Sing Harmony';
}

backBtn.addEventListener('click', () => showList(true));
window.addEventListener('popstate', () => route(false));

function route(push) {
  const slug = new URLSearchParams(location.search).get('song');
  if (slug) openSong(slug, push);
  else showList(push);
}

// ---------- controls ----------
function setPlayingUI(playing) {
  // SVG elements don't implement the `hidden` IDL property — toggle the attribute
  playBtn.querySelector('.ic-play').toggleAttribute('hidden', playing);
  playBtn.querySelector('.ic-pause').toggleAttribute('hidden', !playing);
  playBtn.classList.toggle('is-playing', playing);
}

async function togglePlay() {
  if (!current) return;
  if (player.playing) {
    player.pause();
    setPlayingUI(false);
  } else {
    statusEl.textContent = 'Preparing piano…';
    statusEl.hidden = false;
    try {
      await player.play();
    } finally {
      statusEl.hidden = true;
    }
    setPlayingUI(true);
  }
}

playBtn.addEventListener('click', togglePlay);
$('#rewindBtn').addEventListener('click', () => player.rewind());

// A-B loop
const loopA = $('#loopA');
const loopB = $('#loopB');
const loopClear = $('#loopClear');
function refreshLoopUI() {
  loopA.classList.toggle('loop-set', player.loopStart !== null);
  loopB.classList.toggle('loop-set', player.loopEnd !== null);
  loopClear.toggleAttribute('hidden', player.loopStart === null && player.loopEnd === null);
  score.setLoopRange(player.loopStart, player.looping ? player.loopEnd : null);
}
loopA.addEventListener('click', () => {
  player.setLoopStart();
  if (player.loopEnd !== null && player.loopEnd <= player.loopStart) player.loopEnd = null;
  refreshLoopUI();
});
loopB.addEventListener('click', () => {
  player.setLoopEnd();
  if (player.loopStart === null || player.loopEnd <= player.loopStart) player.loopStart = player.firstNoteBeat();
  player.seek(player.loopStart);
  refreshLoopUI();
});
loopClear.addEventListener('click', () => {
  player.clearLoop();
  refreshLoopUI();
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && current && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    togglePlay();
  }
});

tempoEl.addEventListener('input', () => {
  player.bpm = Number(tempoEl.value);
  tempoVal.textContent = tempoEl.value;
});
$('#tempoReset').addEventListener('click', () => {
  if (!current) return;
  tempoEl.value = current.tempo;
  player.bpm = current.tempo;
  tempoVal.textContent = String(current.tempo);
});

// voice chips
const chipsWrap = $('#voiceChips');
for (const v of VOICES) {
  const chip = document.createElement('button');
  chip.className = `chip chip-${v.id} chip-on`;
  chip.innerHTML = `<span class="dot"></span>${v.label}`;
  chip.title = `Toggle ${v.label}`;
  chip.addEventListener('click', () => {
    const on = player.toggleMute(v.id);
    chip.classList.toggle('chip-on', on);
    score.setMuted(player.muted);
  });
  chipsWrap.appendChild(chip);
}

// ---------- boot ----------
loadIndex().then(() => route(false));

// debugging handle (also used by automated tests)
window.__sh = { player, score };

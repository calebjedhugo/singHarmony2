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
  score.verseFilter = 'all';
  score.mode = defaultMode(); // set directly pre-render (setMode would re-render the old song)
  applyModeUI(score.mode);
  score.render(song);
  score.setMuted(player.muted);
  score.setCursor(player.beat, true);
  refreshLoopUI();
  buildVerseChips();
  if (push) history.pushState({ slug }, '', `?song=${slug}`);
  document.title = `${song.title} · How to Sing Harmony`;
  updateRotateHint();
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
  updateRotateHint();
}

backBtn.addEventListener('click', () => showList(true));
$('#backBtn2').addEventListener('click', () => showList(true));

// Rotate-to-landscape hint on small portrait touch screens (the score wants width)
const rotateHint = document.createElement('div');
rotateHint.id = 'rotateHint';
rotateHint.hidden = true;
rotateHint.innerHTML = '<div><span class="phone-icon">&#128241;</span>' +
  'Rotate your phone sideways&mdash;<br>the music is much bigger in landscape.' +
  '<br><button type="button">Keep portrait</button></div>';
document.body.appendChild(rotateHint);
rotateHint.querySelector('button').addEventListener('click', () => {
  sessionStorage.setItem('sh-portrait-ok', '1');
  rotateHint.hidden = true;
});
function updateRotateHint() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;
  const portrait = window.innerHeight > window.innerWidth;
  const touch = 'ontouchstart' in window;
  const dismissed = sessionStorage.getItem('sh-portrait-ok');
  rotateHint.hidden = !(small && portrait && touch && !dismissed && !songView.hidden);
}
window.addEventListener('resize', updateRotateHint);
window.addEventListener('orientationchange', updateRotateHint);
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

// page/ribbon score mode — ribbon defaults on for phone landscape
const modeBtn = $('#modeBtn');
function defaultMode() {
  const saved = localStorage.getItem('sh-score-mode');
  if (saved === 'page' || saved === 'ribbon') return saved;
  return window.innerHeight < 500 && window.innerWidth > window.innerHeight ? 'ribbon' : 'page';
}
function applyModeUI(mode) {
  modeBtn.querySelector('.ic-ribbon').toggleAttribute('hidden', mode === 'ribbon');
  modeBtn.querySelector('.ic-page').toggleAttribute('hidden', mode !== 'ribbon');
}
function setMode(mode, save) {
  score.setMode(mode); // re-renders if a song is loaded
  applyModeUI(mode);
  if (save) localStorage.setItem('sh-score-mode', mode);
}
modeBtn.addEventListener('click', () => setMode(score.mode === 'ribbon' ? 'page' : 'ribbon', true));
window.addEventListener('resize', () => {
  requestAnimationFrame(() => score.song && score._decorate());
});

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

// verse picker (only for songs with 2+ verses)
const verseChipsWrap = $('#verseChips');
function buildVerseChips() {
  const count = score.verseCount();
  verseChipsWrap.innerHTML = '';
  verseChipsWrap.toggleAttribute('hidden', count < 2);
  if (count < 2) return;
  const options = [{ label: 'All verses', value: 'all' }];
  for (let i = 0; i < count; i++) options.push({ label: `${i + 1}`, value: i });
  for (const opt of options) {
    const b = document.createElement('button');
    b.className = 'verse-chip';
    b.textContent = opt.label;
    b.classList.toggle('verse-on', score.verseFilter === opt.value);
    b.addEventListener('click', () => {
      score.setVerse(opt.value);
      for (const el of verseChipsWrap.children) el.classList.remove('verse-on');
      b.classList.add('verse-on');
    });
    verseChipsWrap.appendChild(b);
  }
}

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

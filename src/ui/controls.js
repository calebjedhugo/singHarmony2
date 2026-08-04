/**
 * The transport row: play/pause, rewind, tempo, the A-B loop buttons, the
 * verse picker and the SATB mute chips.
 *
 * Everything here is a thin translation between a DOM control and a Player or
 * Score call — no playback or layout logic of its own.
 */

const VOICES = [
  { id: 'soprano', label: 'Soprano' },
  { id: 'alto', label: 'Alto' },
  { id: 'tenor', label: 'Tenor' },
  { id: 'bass', label: 'Bass' },
];

/** SVG elements don't implement the `hidden` IDL property. */
const setHidden = (el, hidden) => el.toggleAttribute('hidden', hidden);

/**
 * @param {object} opts
 * @param {import('../player.js').Player} opts.player
 * @param {import('../score.js').Score} opts.score
 * @param {ParentNode} [opts.root]
 */
export function createControls({ player, score, root = document }) {
  const $ = (sel) => root.querySelector(sel);
  const playBtn = $('#playBtn');
  const tempoEl = $('#tempo');
  const tempoVal = $('#tempoVal');
  const loopA = $('#loopA');
  const loopB = $('#loopB');
  const loopClear = $('#loopClear');
  const verseChips = $('#verseChips');
  let song = null;
  let preparing = false;

  // ---------- play / pause ----------
  /** @param {'idle'|'loading'|'playing'} state */
  function setPlayState(state) {
    setHidden(playBtn.querySelector('.ic-play'), state !== 'idle');
    setHidden(playBtn.querySelector('.ic-pause'), state !== 'playing');
    setHidden(playBtn.querySelector('.ic-loading'), state !== 'loading');
    playBtn.classList.toggle('is-playing', state === 'playing');
    playBtn.classList.toggle('is-loading', state === 'loading');
    playBtn.setAttribute('aria-busy', String(state === 'loading'));
    playBtn.title = state === 'loading' ? 'Preparing the piano…' : 'Play / pause (space)';
  }

  /**
   * The piano is warmed at page load, but a tap can beat it there — on a cold
   * cache the pre-render takes about a second. The button spins for exactly
   * that wait (nothing at all once the piano is ready) and ignores further
   * taps, so an impatient second tap can't start a second play.
   */
  async function togglePlay() {
    if (!song || preparing) return;
    if (player.playing) {
      player.pause();
      setPlayState('idle');
      return;
    }
    preparing = true;
    setPlayState('loading');
    try {
      await player.play();
      setPlayState('playing');
    } catch {
      setPlayState('idle'); // no piano: leave the button usable, not spinning
    } finally {
      preparing = false;
    }
  }

  playBtn.addEventListener('click', togglePlay);
  $('#rewindBtn').addEventListener('click', () => player.rewind());
  player.onEnd = () => setPlayState('idle');

  // Space is a transport key, except while typing in the search box.
  const onKeydown = (e) => {
    if (e.code !== 'Space' || !song || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    togglePlay();
  };
  document.addEventListener('keydown', onKeydown);

  // ---------- tempo ----------
  function setTempo(bpm) {
    player.bpm = bpm;
    tempoEl.value = String(bpm);
    tempoVal.textContent = String(bpm);
  }

  tempoEl.addEventListener('input', () => setTempo(Number(tempoEl.value)));
  $('#tempoReset').addEventListener('click', () => { if (song) setTempo(song.tempo); });

  // ---------- A-B loop ----------
  function refreshLoopUI() {
    loopA.classList.toggle('loop-set', player.loopStart !== null);
    loopB.classList.toggle('loop-set', player.loopEnd !== null);
    setHidden(loopClear, player.loopStart === null && player.loopEnd === null);
    score.setLoopRange(player.loopStart, player.looping ? player.loopEnd : null);
  }

  loopA.addEventListener('click', () => {
    player.setLoopStart();
    refreshLoopUI();
  });
  loopB.addEventListener('click', () => {
    player.setLoopEnd();
    // B with no passage before it sets no loop at all, and there is no A to
    // rewind to — seeking null would park playback on beat 0, which in a hymn
    // that opens with a rest is not even where the music starts.
    if (player.loopStart !== null) player.seek(player.loopStart);
    refreshLoopUI();
  });
  loopClear.addEventListener('click', () => {
    player.clearLoop();
    refreshLoopUI();
  });

  // ---------- verse picker (only for songs with 2+ verses) ----------
  function buildVerseChips() {
    const count = score.verseCount();
    verseChips.replaceChildren();
    setHidden(verseChips, count < 2);
    if (count < 2) return;
    const options = [{ label: 'All verses', value: 'all' }];
    for (let i = 0; i < count; i++) options.push({ label: String(i + 1), value: i });
    for (const opt of options) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'verse-chip';
      chip.textContent = opt.label;
      chip.classList.toggle('verse-on', score.verseFilter === opt.value);
      chip.addEventListener('click', () => {
        score.setVerse(opt.value);
        for (const other of verseChips.children) other.classList.remove('verse-on');
        chip.classList.add('verse-on');
      });
      verseChips.appendChild(chip);
    }
  }

  // ---------- voice chips (built once; they outlive any one song) ----------
  const chipsWrap = $('#voiceChips');
  for (const voice of VOICES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip chip-${voice.id} chip-on`;
    chip.dataset.initial = voice.label[0];
    chip.title = `Toggle ${voice.label}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = voice.label;
    chip.append(dot, label);
    chip.addEventListener('click', () => {
      chip.classList.toggle('chip-on', player.toggleMute(voice.id));
      score.setMuted(player.muted);
    });
    chipsWrap.appendChild(chip);
  }

  return {
    /** Point the controls at a freshly rendered song. */
    showSong(next) {
      song = next;
      setTempo(next.tempo);
      setPlayState('idle');
      refreshLoopUI();
      buildVerseChips();
    },
    /** Leaving the song view: stop the music and stand the controls down. */
    hideSong() {
      song = null;
      player.pause();
      setPlayState('idle');
    },
    /** Release the document-level key handler. The app lives as long as the
     *  page does and never calls this; tests that re-mount the markup do. */
    destroy() {
      this.hideSong();
      document.removeEventListener('keydown', onKeydown);
    },
  };
}

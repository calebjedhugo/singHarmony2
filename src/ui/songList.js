/**
 * The song list page: every hymn with its key/meter badges, filtered live by
 * the search box.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Matches on title, so "amazing" finds Amazing Grace and nothing else. */
const matches = (song, query) => !query || song.title.toLowerCase().includes(query);

function songButton(song, onOpen) {
  const btn = el('button', 'song-item');
  btn.type = 'button';
  btn.appendChild(el('span', 'song-title', song.title));
  const badges = el('span', 'song-badges');
  if (song.category) badges.appendChild(el('span', 'badge badge-cat', song.category));
  badges.appendChild(el('span', 'badge', song.key));
  badges.appendChild(el('span', 'badge', `${song.timeSignature[0]}/${song.timeSignature[1]}`));
  btn.appendChild(badges);
  btn.addEventListener('click', () => onOpen(song.slug));
  return btn;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.listEl  the <ul> to fill
 * @param {HTMLInputElement} opts.searchEl
 * @param {(slug: string) => void} opts.onOpen
 */
export function createSongList({ listEl, searchEl, onOpen }) {
  let songs = [];

  function render() {
    const query = searchEl.value.trim().toLowerCase();
    listEl.replaceChildren(...songs
      .filter((song) => matches(song, query))
      .map((song) => {
        const li = document.createElement('li');
        li.appendChild(songButton(song, onOpen));
        return li;
      }));
  }

  searchEl.addEventListener('input', render);

  return {
    setSongs(next) {
      songs = next;
      render();
    },
    /** The catalog didn't load — say so rather than showing an empty hymnal. */
    showError(message) {
      songs = [];
      listEl.replaceChildren(el('li', 'list-error', message));
    },
  };
}

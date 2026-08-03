/** @jest-environment jsdom */

/**
 * The song list page. It is the only view most visitors see first, and the one
 * place the app renders untrusted-shaped content (titles and categories from
 * the catalog JSON) — so the escaping assertion below is load-bearing, not
 * decorative.
 */
import { mountApp } from '../../test/appMarkup.js';
import { createSongList } from './songList.js';

const SONGS = [
  { slug: 'amazing-grace', title: 'Amazing Grace', category: null, key: 'F', timeSignature: [3, 4], tempo: 92 },
  { slug: 'silent-night', title: 'Silent Night', category: 'Christmas', key: 'Bb', timeSignature: [6, 8], tempo: 60 },
  { slug: 'it-is-well', title: 'It Is Well With My Soul', category: null, key: 'C', timeSignature: [4, 4], tempo: 84 },
];

let listEl;
let searchEl;
let opened;

function mount(songs = SONGS) {
  mountApp();
  listEl = document.querySelector('#songList');
  searchEl = document.querySelector('#search');
  opened = [];
  const list = createSongList({ listEl, searchEl, onOpen: (slug) => opened.push(slug) });
  list.setSongs(songs);
  return list;
}

const titles = () => [...listEl.querySelectorAll('.song-title')].map((el) => el.textContent);

const search = (text) => {
  searchEl.value = text;
  searchEl.dispatchEvent(new Event('input'));
};

describe('song list', () => {
  it('lists every hymn with its key and meter', () => {
    mount();

    expect(titles()).toEqual(['Amazing Grace', 'Silent Night', 'It Is Well With My Soul']);
    const badges = [...listEl.children[1].querySelectorAll('.badge')].map((b) => b.textContent);
    expect(badges).toEqual(['Christmas', 'Bb', '6/8']);
  });

  it('leaves the category badge off songs that have none', () => {
    mount();

    expect(listEl.children[0].querySelector('.badge-cat')).toBeNull();
    expect(listEl.children[1].querySelector('.badge-cat').textContent).toBe('Christmas');
  });

  it('filters on the title, case-insensitively', () => {
    mount();

    search('  NIGHT ');
    expect(titles()).toEqual(['Silent Night']);

    search('well with');
    expect(titles()).toEqual(['It Is Well With My Soul']);

    search('');
    expect(titles()).toHaveLength(3);
  });

  it('says nothing matched rather than showing a stale list', () => {
    mount();

    search('gregorian chant');
    expect(titles()).toEqual([]);
  });

  it('opens the song that was clicked', () => {
    mount();

    listEl.children[2].querySelector('button').click();
    expect(opened).toEqual(['it-is-well']);
  });

  it('opens the right song after a filter has reordered the list', () => {
    mount();

    search('silent');
    listEl.children[0].querySelector('button').click();

    expect(opened).toEqual(['silent-night']);
  });

  it('renders a title as text, never as markup', () => {
    // Titles are hand-authored JSON, but they land in the DOM, and the day one
    // contains an ampersand or an angle bracket it must read as punctuation.
    mount([{ ...SONGS[0], title: '<img src=x onerror=boom> Grace & Peace' }]);

    expect(titles()).toEqual(['<img src=x onerror=boom> Grace & Peace']);
    expect(listEl.querySelector('img')).toBeNull();
  });

  it('reports a catalog that would not load instead of an empty hymnal', () => {
    const list = mount();

    list.showError('Could not load the hymn list.');

    expect(listEl.textContent).toContain('Could not load the hymn list.');
    expect(listEl.querySelectorAll('.song-item')).toHaveLength(0);
  });
});

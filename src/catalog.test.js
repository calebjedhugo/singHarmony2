/** @jest-environment jsdom */

/**
 * The two catalog reads. They are four lines of fetch each, but the app's
 * error behavior is decided here: a missing hymn falls back to the list (a
 * stale bookmark shouldn't strand anyone on a blank page), while a missing
 * index is loud, because there is no app without it.
 */
import { fetchIndex, fetchSong } from './catalog.js';

const respond = (ok, body) => Promise.resolve({
  ok,
  status: ok ? 200 : 404,
  json: () => Promise.resolve(body),
});

afterEach(() => { delete global.fetch; });

describe('fetchIndex', () => {
  it('unwraps the song list', async () => {
    global.fetch = jest.fn(() => respond(true, { songs: [{ slug: 'amazing-grace' }] }));

    await expect(fetchIndex()).resolves.toEqual([{ slug: 'amazing-grace' }]);
    expect(global.fetch).toHaveBeenCalledWith('/songs/index.json');
  });

  it('throws when the catalog is unreachable, so the page can say so', async () => {
    global.fetch = jest.fn(() => respond(false));

    await expect(fetchIndex()).rejects.toThrow(/index\.json/);
  });
});

describe('fetchSong', () => {
  it('reads the hymn by slug', async () => {
    global.fetch = jest.fn(() => respond(true, { slug: 'silent-night', title: 'Silent Night' }));

    await expect(fetchSong('silent-night')).resolves.toMatchObject({ title: 'Silent Night' });
    expect(global.fetch).toHaveBeenCalledWith('/songs/silent-night.json');
  });

  it('returns null for a slug that is not in the catalog', async () => {
    global.fetch = jest.fn(() => respond(false));

    await expect(fetchSong('no-such-hymn')).resolves.toBeNull();
  });

  it('returns null when the answer is not a song file at all', async () => {
    // `npm run dev` answers an unknown path with index.html and a 200. Letting
    // the parse error escape leaves the previous hymn on screen under a URL
    // that no longer matches it.
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }));

    await expect(fetchSong('no-such-hymn')).resolves.toBeNull();
  });
});

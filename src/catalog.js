/**
 * The song catalog on disk: `public/songs/index.json` (the list page) and one
 * file per hymn (the song page). Both are static JSON served next to the app.
 */

/** The index entries; throws if the catalog can't be reached. */
export async function fetchIndex() {
  const res = await fetch('/songs/index.json');
  if (!res.ok) throw new Error(`songs/index.json: ${res.status}`);
  return (await res.json()).songs;
}

/**
 * One hymn, or null when it can't be read — a stale bookmark, a renamed slug,
 * or a dead connection. All three land the same way in the app (back to the
 * list), and only null does: a rejection here escapes an un-awaited openSong()
 * and leaves the reader on a view that no longer matches the URL.
 */
export async function fetchSong(slug) {
  try {
    const res = await fetch(`/songs/${slug}.json`);
    if (!res.ok) return null;
    // Vite's dev server answers an unknown path with index.html and a 200, so
    // "didn't parse" means the same thing a 404 does: there is no such hymn.
    return await res.json();
  } catch {
    return null;
  }
}

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

/** One hymn, or null when there is no such slug (a stale bookmark or link). */
export async function fetchSong(slug) {
  const res = await fetch(`/songs/${slug}.json`);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    // Vite's dev server answers an unknown path with index.html and a 200, so
    // "didn't parse" means the same thing a 404 does: there is no such hymn.
    return null;
  }
}

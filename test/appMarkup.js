/**
 * The app's REAL markup, straight out of index.html.
 *
 * The UI modules address their controls by id, so a test fixture written by
 * hand would happily keep passing after index.html renamed one of them. This
 * reads the shipped page instead (minus the module script, which Vite serves
 * and jest can't execute).
 */
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const BODY = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '');

/** Mount index.html's body into jsdom and return it. */
export function mountApp() {
  document.body.innerHTML = BODY;
  return document.body;
}

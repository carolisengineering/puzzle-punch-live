/* Adds the Google tag (first in <head>) and the cloud telemetry module (before </body>) to the built
   page (public/index.html), both stamped with the game's version so GA can tag every event with it.
   The game file itself is never edited; like the trim, this stops rather than guess if the page is
   not shaped as expected. Prints the version, which scripts/deploy.sh uses to label the deploy.
     node scripts/inject-telemetry.mjs public/index.html                                            */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { firebaseConfig } from '../live/firebase-config.js';

const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const tagFor = version =>
  `<script type="module" src="cloud-telemetry.js" data-game-version="${attr(version)}"></script>`;

/* Google's snippet, with two changes: the config carries game_version (so page_view and every later
   event have it), and a local preview (scripts/deploy.sh --serve) sends nothing. */
export function gtagFor(id, version) {
  if (!/^G-[A-Z0-9]+$/.test(id ?? '')) throw new Error(`${id} is not a GA4 measurement ID`);
  const params = JSON.stringify({ game_version: version }).replace(/</g, '\\u003c');
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  if (!/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)) gtag('config', '${id}', ${params});
</script>`;
}

/* GAME_VERSION is a const inside the game's closure, so the page cannot read it; deploy reads it here. */
export function gameVersion(html) {
  const found = [...html.matchAll(/const GAME_VERSION = '([^']*)'/g)];
  if (found.length !== 1) throw new Error(`expected exactly one GAME_VERSION, found ${found.length}`);
  return found[0][1];
}

const once = (html, mark) => {
  const n = html.split(mark).length - 1;
  if (n !== 1) throw new Error(`expected exactly one ${mark}, found ${n}`);
};

export function injectTelemetry(html, measurementId) {
  const version = gameVersion(html);
  once(html, '<head>');
  once(html, '</body>');
  return html
    .replace('<head>', `<head>\n${gtagFor(measurementId, version)}\n`)
    .replace('</body>', `${tagFor(version)}\n</body>`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const html = readFileSync(file, 'utf8');
  writeFileSync(file, injectTelemetry(html, firebaseConfig.measurementId));
  console.log(gameVersion(html));
}

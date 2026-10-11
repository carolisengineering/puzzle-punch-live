import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectTelemetry, gameVersion, tagFor, gtagFor } from '../../scripts/inject-telemetry.mjs';
import { firebaseConfig } from '../../live/firebase-config.js';

const ID = 'G-TEST123';
const page = v => `<html><head><title>t</title></head><body><script>const GAME_VERSION = '${v}';</script>x</body></html>`;

test('inserts the module tag, stamped with the game version, just before </body>', () => {
  const tag = '<script type="module" src="cloud-telemetry.js" data-game-version="PUZZLE PUNCH v9"></script>';
  assert.equal(tagFor('PUZZLE PUNCH v9'), tag);
  assert.ok(injectTelemetry(page('PUZZLE PUNCH v9'), ID).endsWith(`x${tag}\n</body></html>`));
});

test('the version attribute is escaped', () => {
  assert.equal(tagFor('a"<&'), '<script type="module" src="cloud-telemetry.js" data-game-version="a&quot;&lt;&amp;"></script>');
});

test('the Google tag goes first in <head>, configured with the game version', () => {
  const out = injectTelemetry(page('PUZZLE PUNCH v9'), ID);
  assert.ok(out.startsWith(`<html><head>\n${gtagFor(ID, 'PUZZLE PUNCH v9')}\n<title>`));
  const g = gtagFor(ID, 'PUZZLE PUNCH v9');
  assert.ok(g.includes('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>'));
  assert.ok(g.includes(`gtag('config', 'G-TEST123', {"game_version":"PUZZLE PUNCH v9"})`));
});

test('the Google tag sends nothing from a local preview', () => {
  assert.match(gtagFor(ID, 'v'), /if \(!\/\^\(localhost\|127\\\.0\\\.0\\\.1\)\$\/\.test\(location\.hostname\)\) gtag\('config'/);
});

test('the version cannot close the Google tag script', () => {
  assert.ok(!gtagFor(ID, 'x</script><b>').includes('</script><b>'));
});

test('refuses a measurement ID that is not a GA4 ID', () => {
  assert.throws(() => gtagFor("G-1'); alert(1", 'v'), /not a GA4 measurement ID/);
  assert.throws(() => gtagFor(undefined, 'v'), /not a GA4 measurement ID/);
});

test('gameVersion reads the one GAME_VERSION', () => {
  assert.equal(gameVersion(page('PUZZLE PUNCH v0.85r')), 'PUZZLE PUNCH v0.85r');
});

test('gameVersion refuses a page with no GAME_VERSION, or two', () => {
  assert.throws(() => gameVersion('<html></html>'), /exactly one GAME_VERSION, found 0/);
  assert.throws(() => gameVersion(page('a') + page('b')), /exactly one GAME_VERSION, found 2/);
});

test('refuses a page with no </body>, or two', () => {
  assert.throws(() => injectTelemetry("<head>const GAME_VERSION = 'v';", ID), /exactly one <\/body>, found 0/);
  assert.throws(() => injectTelemetry("<head>const GAME_VERSION = 'v';</body></body>", ID), /exactly one <\/body>, found 2/);
});

test('refuses a page with no <head>, or two', () => {
  assert.throws(() => injectTelemetry("const GAME_VERSION = 'v';</body>", ID), /exactly one <head>, found 0/);
  assert.throws(() => injectTelemetry("<head><head>const GAME_VERSION = 'v';</body>", ID), /exactly one <head>, found 2/);
});

test('the real game file takes both tags, with the project measurement ID', () => {
  const html = readFileSync('PUZZLE PUNCH.html', 'utf8');
  const v = gameVersion(html);
  assert.match(v, /^PUZZLE PUNCH v/);
  const out = injectTelemetry(html, firebaseConfig.measurementId);
  assert.ok(out.includes(tagFor(v)));
  assert.ok(out.includes(gtagFor('G-VG6FP1EQHZ', v)));
});

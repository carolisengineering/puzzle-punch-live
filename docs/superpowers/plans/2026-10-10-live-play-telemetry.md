# Live Play Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public Firebase build record how often people play (Google Analytics) and keep each run's gzipped log in Firestore on the free Spark plan, plus a local script that exports the runs and deletes them from the cloud.

**Architecture:** The game file stays untouched. A deploy-only browser module (`live/cloud-telemetry.js`) reads the game's globals once a second, sends GA events, and writes one Firestore document per run. Its pure logic lives in `live/telemetry-core.js`, which Node tests and the export script share. `scripts/deploy.sh` copies `live/*.js` into `public/` and inserts the module tag. A Node script (`scripts/export-runs.mjs`) uses the Admin SDK to write runs to `telemetry-live/` and delete them.

**Tech Stack:**
- Firebase JS SDK 13.0.0, loaded in the browser from `https://www.gstatic.com/firebasejs/13.0.0/`; npm `firebase@13.0.0` for tests.
- `firebase-admin@14.5.0`, `@firebase/rules-unit-testing@6.0.0`.
- `firebase-tools` through `npx -y`, as `deploy.sh` already does.
- Node 22 built-in test runner. Web `CompressionStream`, which is built into browsers and Node 22.

**Spec:** `docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md`

## Global Constraints

- Do not modify `PUZZLE PUNCH.html`, `puzzle_punch_helper.ps1` or `harness/live1_trim.mjs`.
- Stay on the Spark plan: no Cloud Functions, no Cloud Storage, nothing that needs Blaze.
- Firebase project ID `puzzle-punch`. Emulator tests use project ID `demo-puzzle-punch`, which never touches production.
- Firestore collection `runs`. Document ID: `<uid>_<stamp with characters outside [0-9A-Za-z-] replaced by '-'>`.
- Document fields, exactly: `uid, stamp, game, level, result, endReason, durationSec, score, kind, log, rawBytes, createdAt, updatedAt`.
- `kind` is one of `start`, `partial`, `full`, `slim`.
- Slim fallback when the gzipped full log is ≥ 900,000 bytes. Rules reject `log` ≥ 950,000 bytes.
- Export skips documents whose `updatedAt` is less than 1 hour old by default. Default output folder `telemetry-live/`. File name `delve-run <stamp> live-<uid first 6>.json`.
- Game globals read: `G` (`.state`, `.bot`, `.stage`), `RUN_STAMP`, `telemetryJSON()`, `telemetrySlimJSON()`. "In a run" means `!G.stage` and `G.state` is one of `escort | hold | greed | escape | end`. Bot runs (`G.bot` truthy) are skipped.
- GA events: automatic `page_view`, `run_start { level, game }`, `run_end { level, game, result, end_reason, duration_sec, score }`.
- Nothing the module does may throw into the game. Every failure is a `console.warn` prefixed `[cloud-telemetry]`.
- Choices this plan makes where the spec was silent:
  - On `localhost`, GA events are logged to the console instead of sent, so previews don't pollute real analytics.
  - At most one `partial` write per run every 5 minutes, so alt-tabbing doesn't spend writes.
  - All writes go through one queue, in order.
  - The hosting emulator uses port 5002, because macOS uses 5000 for AirPlay.
  - The export script has a `--min-age-minutes` flag, for the end-to-end check.
  - The rules also require `log is bytes`.

## Review Focus

1. **A partial write overtaking the end write.** If a hidden-tab `partial` save is still in flight when the run ends, it must not overwrite the `full` log. Writes go through one serial queue (Task 1 `createQueue` test, used in Task 4).
2. **A hostile `stamp` from a tampered client** (`../../x`, newlines, 200 characters). The export file name must stay inside the output folder, and stay sane (Task 3 test).
3. **CSV-hostile values** (commas, quotes or newlines in `endReason` or `stamp`). `runs-summary.csv` must stay one row per run (Task 3 test).
4. **A future game version renames a global.** The module must warn once and do nothing. The game must be unaffected (Task 1 `gameHooks` test).
5. **Several runs in one page load,** with a bot run in between and a run abandoned back to the setup screen. Each human run gets exactly one start and one end. Bot runs are ignored. An abandoned run is not reported as active (Task 1 tracker tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (new) | `"type": "module"`, pinned deps, `test` / `test:emulator` / `export-runs` scripts |
| `live/telemetry-core.js` (new) | Pure logic: game-hook probe, run tracker, document ID, header fields, gzip/gunzip, full-or-slim, serial queue |
| `live/cloud-telemetry.js` (new) | Browser glue: Firebase SDK, GA, anonymous auth, the poll loop, Firestore writes |
| `live/firebase-config.js` (new) | Public web-app config from `firebase apps:sdkconfig` |
| `firestore.rules` (new) | Write-own-only, size and shape checks, no reads or deletes |
| `firebase.json` (modify) | Add `firestore.rules` and the emulator ports |
| `scripts/export-core.mjs` (new) | `exportRuns(db, opts)`, `runFileName`, `csvLine`: testable against the emulator |
| `scripts/export-runs.mjs` (new) | CLI: parse flags, Admin SDK with ADC, print the report |
| `scripts/inject-telemetry.mjs` (new) | Insert the module tag before the single `</body>` |
| `scripts/deploy.sh` (modify) | Copy `live/*.js`, inject, deploy rules too, `--serve` runs emulators |
| `test/unit/*.test.mjs` (new) | Node tests for the core and injection |
| `test/emulator/*.test.mjs` (new) | Rules and export tests, run under `emulators:exec` |
| `.gitignore`, `README.md` (modify) | Ignore `telemetry-live/`; document setup, export and quotas |

---

### Task 1: Tooling and pure telemetry core

**Files:**
- Create: `package.json`
- Create: `live/telemetry-core.js`
- Test: `test/unit/telemetry-core.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all named exports of `live/telemetry-core.js`):
  - `RUN_STATES: Set<string>`
  - `SLIM_THRESHOLD = 900000`
  - `PARTIAL_GAP_MS = 300000`
  - `gameHooks(probe: () => {G, stamp, full, slim}) → {G, stamp, full, slim} | null`
  - `snapshotOf(hooks) → {stamp: string, state: string, skip: boolean}`
  - `createTracker() → { step(snapshot) → Array<{type: 'start'|'end', stamp}>, active() → string | null }`
  - `docId(uid: string, stamp: string) → string`
  - `headerFields(slimText: string) → {game, level, result, endReason, durationSec, score}`
  - `gzip(text: string) → Promise<Uint8Array>`
  - `gunzip(bytes: Uint8Array | Buffer) → Promise<string>`
  - `buildLog(kind: 'full'|'partial', fullText, slimText, threshold = SLIM_THRESHOLD) → Promise<{kind, log: Uint8Array, rawBytes: number}>`
  - `createQueue(onError: (e) => void) → (job: () => Promise<any>) => Promise<void>`

- [ ] **Step 1: Create `package.json` and install**

```json
{
  "name": "puzzle-punch-live",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test \"test/unit/*.test.mjs\"",
    "test:emulator": "PATH=\"/opt/homebrew/opt/openjdk/bin:$PATH\" npx -y firebase-tools emulators:exec --only auth,firestore --project demo-puzzle-punch \"node --test --test-concurrency=1 'test/emulator/*.test.mjs'\"",
    "export-runs": "node scripts/export-runs.mjs"
  },
  "dependencies": {
    "firebase-admin": "14.5.0"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "6.0.0",
    "firebase": "13.0.0"
  }
}
```

Run: `npm install`
Expected: installs without errors and creates `package-lock.json`. `node_modules/` is already in `.gitignore`.

- [ ] **Step 2: Write the failing tests**

`test/unit/telemetry-core.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_STATES, SLIM_THRESHOLD, gameHooks, snapshotOf, createTracker, docId, headerFields,
  gzip, gunzip, buildLog, createQueue,
} from '../../live/telemetry-core.js';

const hooksFor = (G, stamp) => ({ G, stamp, full: () => '{}', slim: () => '{}' });

test('RUN_STATES matches the game\'s inRunState', () => {
  assert.deepEqual([...RUN_STATES].sort(), ['end', 'escape', 'escort', 'greed', 'hold']);
});

test('gameHooks returns the hooks when every global is present', () => {
  const h = hooksFor({ state: 'setup' }, '2026-10-10 120000');
  assert.equal(gameHooks(() => h), h);
});

test('gameHooks returns null when a global is missing or renamed', () => {
  assert.equal(gameHooks(() => { throw new ReferenceError('G is not defined'); }), null);
  assert.equal(gameHooks(() => ({ G: {}, stamp: 'x', full: () => '', slim: undefined })), null);
  assert.equal(gameHooks(() => ({ G: null, stamp: 'x', full: () => '', slim: () => '' })), null);
  assert.equal(gameHooks(() => ({ G: {}, stamp: 7, full: () => '', slim: () => '' })), null);
});

test('snapshotOf flags bot runs and the studio stage as skipped', () => {
  assert.deepEqual(snapshotOf(hooksFor({ state: 'escort' }, 'a')), { stamp: 'a', state: 'escort', skip: false });
  assert.equal(snapshotOf(hooksFor({ state: 'escort', bot: { seed: 1 } }, 'a')).skip, true);
  assert.equal(snapshotOf(hooksFor({ state: 'escort', stage: {} }, 'a')).skip, true);
});

test('tracker: one start and one end per run', () => {
  const t = createTracker();
  assert.deepEqual(t.step({ stamp: 'a', state: 'setup', skip: false }), []);
  assert.deepEqual(t.step({ stamp: 'a', state: 'escort', skip: false }), [{ type: 'start', stamp: 'a' }]);
  assert.equal(t.active(), 'a');
  assert.deepEqual(t.step({ stamp: 'a', state: 'hold', skip: false }), []);
  assert.deepEqual(t.step({ stamp: 'a', state: 'end', skip: false }), [{ type: 'end', stamp: 'a' }]);
  assert.equal(t.active(), null);
  assert.deepEqual(t.step({ stamp: 'a', state: 'end', skip: false }), []);
});

test('tracker: several runs in one page load, bot run ignored', () => {
  const t = createTracker();
  t.step({ stamp: 'a', state: 'escort', skip: false });
  t.step({ stamp: 'a', state: 'end', skip: false });
  t.step({ stamp: 'a', state: 'setup', skip: false });
  assert.deepEqual(t.step({ stamp: 'bot', state: 'escort', skip: true }), []);
  assert.deepEqual(t.step({ stamp: 'bot', state: 'end', skip: true }), []);
  assert.equal(t.active(), null);
  assert.deepEqual(t.step({ stamp: 'b', state: 'escort', skip: false }), [{ type: 'start', stamp: 'b' }]);
  assert.deepEqual(t.step({ stamp: 'b', state: 'end', skip: false }), [{ type: 'end', stamp: 'b' }]);
});

test('tracker: a run first seen at its end reports start then end', () => {
  const t = createTracker();
  assert.deepEqual(t.step({ stamp: 'a', state: 'end', skip: false }),
    [{ type: 'start', stamp: 'a' }, { type: 'end', stamp: 'a' }]);
});

test('tracker: a run abandoned back to setup is not active', () => {
  const t = createTracker();
  t.step({ stamp: 'a', state: 'escort', skip: false });
  t.step({ stamp: 'a', state: 'setup', skip: false });
  assert.equal(t.active(), null);
});

test('docId sanitizes the stamp', () => {
  assert.equal(docId('U1', '2026-10-10 120000'), 'U1_2026-10-10-120000');
  assert.equal(docId('U1', 'arena 2026/x.y'), 'U1_arena-2026-x-y');
});

test('headerFields reads the slim header', () => {
  const slim = JSON.stringify({ game: 'PUZZLE PUNCH v0.85q', level: 'depths', result: 'WIN', endReason: 'escaped',
    score: 1234, summary: { durationSec: 612.4 } });
  assert.deepEqual(headerFields(slim), { game: 'PUZZLE PUNCH v0.85q', level: 'depths', result: 'WIN',
    endReason: 'escaped', durationSec: 612.4, score: 1234 });
});

test('headerFields fills gaps with null / empty strings', () => {
  assert.deepEqual(headerFields('{}'), { game: '', level: '', result: '', endReason: null, durationSec: null, score: null });
});

test('gzip / gunzip round trip, including non-ASCII', async () => {
  const text = JSON.stringify({ name: 'THE LIVING DEPTHS — ✦', n: [1, 2, 3] }, null, 1);
  const z = await gzip(text);
  assert.ok(z instanceof Uint8Array);
  assert.equal(await gunzip(z), text);
  assert.equal(await gunzip(Buffer.from(z)), text);
});

test('gunzip rejects bytes that are not gzip', async () => {
  await assert.rejects(gunzip(new Uint8Array([1, 2, 3, 4])));
});

test('buildLog keeps the full log under the threshold', async () => {
  const full = JSON.stringify({ events: [1, 2, 3] }), slim = '{"slim":true}';
  const r = await buildLog('full', full, slim);
  assert.equal(r.kind, 'full');
  assert.equal(await gunzip(r.log), full);
  assert.equal(r.rawBytes, Buffer.byteLength(full, 'utf8'));
  assert.equal((await buildLog('partial', full, slim)).kind, 'partial');
});

test('buildLog falls back to slim at the threshold', async () => {
  const full = JSON.stringify({ events: [1, 2, 3] }), slim = '{"slim":true}';
  const size = (await gzip(full)).length;
  const r = await buildLog('full', full, slim, size);         // exactly at the threshold → slim
  assert.equal(r.kind, 'slim');
  assert.equal(await gunzip(r.log), slim);
  assert.equal(r.rawBytes, Buffer.byteLength(slim, 'utf8'));
  assert.equal((await buildLog('full', full, slim, size + 1)).kind, 'full');
  assert.equal(SLIM_THRESHOLD, 900000);
});

test('createQueue runs jobs one at a time, in order, and survives a failure', async () => {
  const errors = [], order = [];
  const enqueue = createQueue(e => errors.push(e.message));
  enqueue(async () => { await new Promise(r => setTimeout(r, 30)); order.push('slow partial'); });
  enqueue(async () => { throw new Error('boom'); });
  await enqueue(async () => { order.push('end'); });
  assert.deepEqual(order, ['slow partial', 'end']);
  assert.deepEqual(errors, ['boom']);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../live/telemetry-core.js'`.

- [ ] **Step 4: Write `live/telemetry-core.js`**

```js
/* Pure helpers for the cloud telemetry module (live/cloud-telemetry.js). No Firebase imports, so the
   browser module, the export script and the Node tests all share them.
   Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md */

export const RUN_STATES = new Set(['escort', 'hold', 'greed', 'escape', 'end']);   // the game's inRunState()
export const SLIM_THRESHOLD = 900000;   // gzipped bytes; at or over this the slim log goes instead
export const PARTIAL_GAP_MS = 300000;   // at most one hidden-tab save per run every 5 minutes

/* The game's globals are classic-script let/const/functions, so only code that names them can read
   them. The caller passes a probe that does; a missing or renamed global comes back as null. */
export function gameHooks(probe) {
  try {
    const h = probe();
    const ok = h && h.G && typeof h.G === 'object' && typeof h.stamp === 'string'
      && typeof h.full === 'function' && typeof h.slim === 'function';
    return ok ? h : null;
  } catch (e) {
    return null;
  }
}

export function snapshotOf(h) {
  return { stamp: h.stamp, state: h.G.state, skip: !!(h.G.bot || h.G.stage) };
}

/* Turns one-second snapshots into run start / end events: one start per new stamp seen in a run
   state, one end per stamp when the state reaches 'end'. Bot runs and the studio stage are ignored. */
export function createTracker() {
  let started = null, ended = null, inRun = false;
  return {
    step(s) {
      inRun = !s.skip && RUN_STATES.has(s.state);
      if (!inRun) return [];
      const events = [];
      if (s.stamp !== started) { started = s.stamp; events.push({ type: 'start', stamp: s.stamp }); }
      if (s.state === 'end' && ended !== s.stamp) { ended = s.stamp; events.push({ type: 'end', stamp: s.stamp }); }
      return events;
    },
    active() { return inRun && started !== null && started !== ended ? started : null; },
  };
}

export function docId(uid, stamp) {
  return `${uid}_${String(stamp).replace(/[^0-9A-Za-z-]/g, '-')}`;
}

export function headerFields(slimText) {
  const o = JSON.parse(slimText), s = o.summary || {};
  return {
    game: String(o.game ?? ''),
    level: String(o.level ?? ''),
    result: String(o.result ?? ''),
    endReason: o.endReason ?? null,
    durationSec: typeof s.durationSec === 'number' ? s.durationSec : null,
    score: typeof o.score === 'number' ? o.score : null,
  };
}

export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export async function buildLog(kind, fullText, slimText, threshold = SLIM_THRESHOLD) {
  let text = fullText, log = await gzip(text);
  if (log.length >= threshold) { kind = 'slim'; text = slimText; log = await gzip(text); }
  return { kind, log, rawBytes: new TextEncoder().encode(text).length };
}

/* One write at a time, in order: a hidden-tab save still in flight must never land after the
   end-of-run save and overwrite the full log. A failed job is reported and the queue carries on. */
export function createQueue(onError) {
  let chain = Promise.resolve();
  return job => (chain = chain.then(job).catch(onError));
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test`
Expected: PASS, all tests in `telemetry-core.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json live/telemetry-core.js test/unit/telemetry-core.test.mjs
git commit -m "Add telemetry core: run tracker, gzip, slim fallback, write queue"
```

---

### Task 2: Firestore security rules and emulator config

**Files:**
- Create: `firestore.rules`
- Modify: `firebase.json` (add the `firestore` and `emulators` keys; `hosting` unchanged)
- Test: `test/emulator/rules.test.mjs`

**Interfaces:**
- Consumes: the document shape from Global Constraints.
- Produces:
  - `firestore.rules`, deployed in Task 5.
  - Emulator ports: auth 9099, firestore 8080, hosting 5002. Task 4's module and Task 3's tests rely on these.

- [ ] **Step 1: Install Java for the emulators**

Run: `brew install openjdk`, then `/opt/homebrew/opt/openjdk/bin/java -version`
Expected: prints an OpenJDK version of 21 or later. The brew formula is keg-only. `npm run test:emulator` and `deploy.sh --serve` (Task 4) put `/opt/homebrew/opt/openjdk/bin` on `PATH` themselves, so no shell config changes are needed.

- [ ] **Step 2: Add the emulator and rules config to `firebase.json`**

The emulator test files share one emulator project, so `test:emulator` (Task 1) runs them with `--test-concurrency=1`; one file's clear must not wipe another's data mid-test.

Replace the whole file with the following. The `hosting` block is unchanged:

```json
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "headers": [
      {
        "source": "/**",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache" }
        ]
      }
    ]
  },
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "hosting": { "port": 5002 },
    "ui": { "enabled": false }
  }
}
```

- [ ] **Step 3: Write the failing tests**

`test/emulator/rules.test.mjs`:

```js
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc, serverTimestamp, Bytes, Timestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-puzzle-punch',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const STAMP = '2026-10-10 120000';
const idOf = uid => `${uid}_2026-10-10-120000`;
const dbAs = uid => env.authenticatedContext(uid).firestore();
const startDoc = uid => ({
  uid, stamp: STAMP, game: 'PUZZLE PUNCH v0.85q', level: 'depths', result: 'in-progress',
  endReason: null, durationSec: 0, score: 0, kind: 'start',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
});
const logUpdate = (uid, n, kind = 'full') => ({
  uid, kind, log: Bytes.fromUint8Array(new Uint8Array(n)), rawBytes: n * 10, updatedAt: serverTimestamp(),
});
async function seed() {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'runs', idOf('alice')), { uid: 'alice', kind: 'start' }));
}

test('a player can create their own run', async () => {
  await assertSucceeds(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), startDoc('alice')));
});

test('a player can update their own run with a gzipped log', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertSucceeds(setDoc(ref, logUpdate('alice', 1000), { merge: true }));
});

test('a log just under the limit is accepted', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertSucceeds(setDoc(ref, logUpdate('alice', 949999), { merge: true }));
});

test('a log at the limit is rejected', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await setDoc(ref, startDoc('alice'));
  await assertFails(setDoc(ref, logUpdate('alice', 950000), { merge: true }));
});

test('a log that is not bytes is rejected', async () => {
  const ref = doc(dbAs('alice'), 'runs', idOf('alice'));
  await assertFails(setDoc(ref, { ...startDoc('alice'), kind: 'full', log: 'H4sI...', rawBytes: 10 }));
});

test("a player cannot write another player's document id", async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('bob')), startDoc('alice')));
});

test('the uid field must match the signed-in player', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), startDoc('bob')));
});

test('signed-out writes are rejected', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'runs', idOf('alice')), startDoc('alice')));
});

test('an extra field is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), { ...startDoc('alice'), ip: '1.2.3.4' }));
});

test('an unknown kind is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')), { ...startDoc('alice'), kind: 'huge' }));
});

test('a client-chosen updatedAt is rejected', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'runs', idOf('alice')),
    { ...startDoc('alice'), updatedAt: Timestamp.fromMillis(0) }));
});

test('reads are denied, even of your own run', async () => {
  await seed();
  await assertFails(getDoc(doc(dbAs('alice'), 'runs', idOf('alice'))));
  await assertFails(getDocs(collection(dbAs('alice'), 'runs')));
});

test('deletes are denied, even of your own run', async () => {
  await seed();
  await assertFails(deleteDoc(doc(dbAs('alice'), 'runs', idOf('alice'))));
});

test('other collections are denied', async () => {
  await assertFails(setDoc(doc(dbAs('alice'), 'other', 'x'), { a: 1 }));
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npm run test:emulator`
Expected: FAIL. With no `firestore.rules` file, `readFileSync` throws `ENOENT`.

- [ ] **Step 5: Write `firestore.rules`**

```
rules_version = '2';
// Public run logs from the Firebase build. Players may write only their own runs and never read;
// only the export script (Admin SDK, which bypasses these rules) reads and deletes.
// Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md
service cloud.firestore {
  match /databases/{database}/documents {
    match /runs/{id} {
      allow read, delete: if false;
      allow create, update: if request.auth != null
        && id.matches(request.auth.uid + '_.*')
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['uid', 'stamp', 'game', 'level', 'result',
             'endReason', 'durationSec', 'score', 'kind', 'log', 'rawBytes', 'createdAt', 'updatedAt'])
        && request.resource.data.kind in ['start', 'partial', 'full', 'slim']
        && (!('log' in request.resource.data)
            || (request.resource.data.log is bytes && request.resource.data.log.size() < 950000))
        && request.resource.data.updatedAt == request.time;
    }
  }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npm run test:emulator`
Expected: PASS, all 14 rules tests. The first run downloads the emulator JARs.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules firebase.json test/emulator/rules.test.mjs
git commit -m "Add Firestore rules for public run logs, with emulator tests"
```

---

### Task 3: Export script

**Files:**
- Create: `scripts/export-core.mjs`
- Create: `scripts/export-runs.mjs`
- Modify: `.gitignore` (add `telemetry-live/`)
- Test: `test/unit/export-core.test.mjs` (pure helpers)
- Test: `test/emulator/export.test.mjs`

**Interfaces:**
- Consumes: `gunzip`, `gzip` from `live/telemetry-core.js` (Task 1). The emulator config from Task 2.
- Produces (named exports of `scripts/export-core.mjs`):
  - `CSV_HEADER: string[]`
  - `runFileName(stamp, uid) → string`
  - `csvLine(values: any[]) → string` (no trailing newline)
  - `exportRuns(db, { outDir, keep = false, dryRun = false, now = Date.now(), minAgeMs = 3600000, pageSize = 200 }) → Promise<Report>`
  - `Report = { counts: {full, slim, partial, start}, failures: Array<{id, error}>, exportedBytes, deleted, remainingBytes, skippedRecent }`

- [ ] **Step 1: Write the failing unit tests for the pure helpers**

`test/unit/export-core.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFileName, csvLine, CSV_HEADER } from '../../scripts/export-core.mjs';

test('runFileName keeps the helper\'s naming, tagged live', () => {
  assert.equal(runFileName('2026-10-10 120000', 'AbC123xyz'), 'delve-run 2026-10-10 120000 live-AbC123.json');
});

test('runFileName strips path and control characters from a hostile stamp', () => {
  const name = runFileName('../../etc/passwd\n' + 'x'.repeat(200), 'u/../1');
  assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('\n'));
  assert.ok(name.startsWith('delve-run ') && name.endsWith('.json'));
  assert.ok(name.length <= 'delve-run '.length + 40 + ' live-'.length + 6 + '.json'.length);
});

test('runFileName never produces an empty stamp', () => {
  assert.equal(runFileName('////', ''), 'delve-run unstamped live-anon.json');
});

test('csvLine quotes commas, quotes and newlines', () => {
  assert.equal(csvLine(['a', 'hit, "hard"', 'two\nlines', null, 12.5]), 'a,"hit, ""hard""","two\nlines",,12.5');
});

test('CSV_HEADER lists the spec\'s columns', () => {
  assert.deepEqual(CSV_HEADER, ['exportedAt', 'uid6', 'stamp', 'game', 'level', 'result', 'endReason',
    'durationSec', 'score', 'kind', 'rawBytes', 'file']);
});
```

- [ ] **Step 2: Write the failing emulator tests**

`test/emulator/export.test.mjs`:

```js
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { gzip } from '../../live/telemetry-core.js';
import { exportRuns } from '../../scripts/export-core.mjs';

const PROJECT = 'demo-puzzle-punch';
const NOW = Date.parse('2026-10-10T12:00:00Z');
const OLD = Timestamp.fromMillis(NOW - 2 * 3600000);
let app, db, out;

before(() => { app = initializeApp({ projectId: PROJECT }, 'export-test'); db = getFirestore(app); });
after(() => deleteApp(app));
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  out = await mkdtemp(join(tmpdir(), 'pp-export-'));
});

const fullText = stamp => JSON.stringify({ game: 'PUZZLE PUNCH v0.85q', run: stamp, events: [{ t: 1, type: 'kill' }] }, null, 1);
async function seedRun(id, { uid = 'abcdef123', stamp = '2026-10-10 100000', kind = 'full', text, updatedAt = OLD, endReason = 'escaped', rawBytes } = {}) {
  const d = { uid, stamp, game: 'PUZZLE PUNCH v0.85q', level: 'depths', result: kind === 'start' ? 'in-progress' : 'WIN',
    endReason, durationSec: 600, score: 99, kind, createdAt: updatedAt, updatedAt };
  if (kind !== 'start') {
    const t = text ?? fullText(stamp);
    d.log = Buffer.from(await gzip(t));
    d.rawBytes = rawBytes ?? Buffer.byteLength(t, 'utf8');
  }
  await db.collection('runs').doc(id).set(d);
}
const exists = p => access(p).then(() => true, () => false);
const docCount = async () => (await db.collection('runs').get()).size;

test('exports a full run byte for byte, writes a CSV row, deletes the document', async () => {
  await seedRun('abcdef123_2026-10-10-100000');
  const r = await exportRuns(db, { outDir: out, now: NOW });
  assert.equal(r.counts.full, 1);
  assert.equal(r.deleted, 1);
  assert.equal(await docCount(), 0);
  const file = join(out, 'delve-run 2026-10-10 100000 live-abcdef.json');
  assert.equal(await readFile(file, 'utf8'), fullText('2026-10-10 100000'));
  const csv = (await readFile(join(out, 'runs-summary.csv'), 'utf8')).trim().split('\n');
  assert.equal(csv[0], 'exportedAt,uid6,stamp,game,level,result,endReason,durationSec,score,kind,rawBytes,file');
  assert.match(csv[1], /^2026-10-10T12:00:00\.000Z,abcdef,2026-10-10 100000,PUZZLE PUNCH v0\.85q,depths,WIN,escaped,600,99,full,\d+,delve-run 2026-10-10 100000 live-abcdef\.json$/);
});

test('slim, partial and start-only runs are exported; start-only has no file', async () => {
  await seedRun('a_1', { stamp: '2026-10-10 100001', kind: 'slim', text: '{"slim":true}' });
  await seedRun('a_2', { stamp: '2026-10-10 100002', kind: 'partial' });
  await seedRun('a_3', { stamp: '2026-10-10 100003', kind: 'start' });
  const r = await exportRuns(db, { outDir: out, now: NOW });
  assert.deepEqual(r.counts, { full: 0, slim: 1, partial: 1, start: 1 });
  assert.equal(await docCount(), 0);
  const files = (await readdir(out)).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['delve-run 2026-10-10 100001 live-abcdef.json', 'delve-run 2026-10-10 100002 live-abcdef.json']);
  const csv = (await readFile(join(out, 'runs-summary.csv'), 'utf8')).trim().split('\n');
  assert.equal(csv.length, 4);
  assert.ok(csv.some(l => l.includes(',start,') && l.endsWith(',')));   // no rawBytes, no file
});

test('a corrupt log or a size mismatch is reported and the document is kept', async () => {
  await db.collection('runs').doc('a_bad').set({ uid: 'abcdef1', stamp: 's1', kind: 'full', log: Buffer.from([1, 2, 3]), rawBytes: 3, updatedAt: OLD });
  await seedRun('a_size', { stamp: 's2', rawBytes: 5 });
  await seedRun('a_ok', { stamp: 's3' });
  const r = await exportRuns(db, { outDir: out, now: NOW });
  assert.deepEqual(r.failures.map(f => f.id).sort(), ['a_bad', 'a_size']);
  assert.equal(r.deleted, 1);
  assert.deepEqual((await db.collection('runs').get()).docs.map(d => d.id).sort(), ['a_bad', 'a_size']);
  assert.equal(await exists(join(out, 'delve-run s1 live-abcdef.json')), false);
  assert.ok(r.remainingBytes > 0);
});

test('runs updated within the last hour are skipped', async () => {
  await seedRun('a_new', { updatedAt: Timestamp.fromMillis(NOW - 10 * 60000) });
  const r = await exportRuns(db, { outDir: out, now: NOW });
  assert.equal(r.skippedRecent, 1);
  assert.equal(r.deleted, 0);
  assert.equal(await docCount(), 1);
  const r0 = await exportRuns(db, { outDir: out, now: NOW, minAgeMs: 0 });
  assert.equal(r0.deleted, 1);
});

test('--keep exports but deletes nothing', async () => {
  await seedRun('a_1');
  const r = await exportRuns(db, { outDir: out, now: NOW, keep: true });
  assert.equal(r.counts.full, 1);
  assert.equal(r.deleted, 0);
  assert.equal(await docCount(), 1);
  assert.equal(await exists(join(out, 'delve-run 2026-10-10 100000 live-abcdef.json')), true);
});

test('--dry-run writes nothing and deletes nothing', async () => {
  await seedRun('a_1');
  const dry = join(out, 'never');
  const r = await exportRuns(db, { outDir: dry, now: NOW, dryRun: true });
  assert.equal(r.counts.full, 1);
  assert.equal(r.deleted, 0);
  assert.equal(await docCount(), 1);
  assert.equal(await exists(dry), false);
});

test('a hostile stamp stays inside the output folder', async () => {
  await seedRun('a_evil', { stamp: '../../evil\nname' });
  await exportRuns(db, { outDir: out, now: NOW });
  const files = (await readdir(out)).filter(f => f.endsWith('.json'));
  assert.deepEqual(files, ['delve-run ....evilname live-abcdef.json']);   // slashes and the newline gone; no path left
});

test('CSV stays one line per run when values contain commas, quotes and newlines', async () => {
  await seedRun('a_1', { endReason: 'hit, "hard"\nthen fell' });
  await exportRuns(db, { outDir: out, now: NOW });
  const csv = await readFile(join(out, 'runs-summary.csv'), 'utf8');
  assert.ok(csv.includes('"hit, ""hard""\nthen fell"'));
});

test('pages through more documents than one page holds', async () => {
  for (let i = 0; i < 5; i++) await seedRun(`a_${i}`, { kind: 'start', stamp: `s${i}`, updatedAt: Timestamp.fromMillis(NOW - 7200000 + i) });
  const r = await exportRuns(db, { outDir: out, now: NOW, pageSize: 2 });
  assert.equal(r.counts.start, 5);
  assert.equal(await docCount(), 0);
});

test('a second export appends to the CSV without repeating the header', async () => {
  await seedRun('a_1', { stamp: 's1' });
  await exportRuns(db, { outDir: out, now: NOW });
  await seedRun('a_2', { stamp: 's2' });
  await exportRuns(db, { outDir: out, now: NOW });
  const lines = (await readFile(join(out, 'runs-summary.csv'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines.filter(l => l.startsWith('exportedAt,')).length, 1);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test && npm run test:emulator`
Expected: FAIL with `Cannot find module '.../scripts/export-core.mjs'`.

- [ ] **Step 4: Write `scripts/export-core.mjs`**

```js
/* Export public run logs from Firestore to local files, then delete them from the cloud.
   The CLI is scripts/export-runs.mjs; this module takes the Firestore handle so tests can point it at
   the emulator. Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md */
import { mkdir, writeFile, readFile, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { gunzip } from '../live/telemetry-core.js';

export const CSV_HEADER = ['exportedAt', 'uid6', 'stamp', 'game', 'level', 'result', 'endReason',
  'durationSec', 'score', 'kind', 'rawBytes', 'file'];
const KINDS = ['full', 'slim', 'partial', 'start'];

/* The helper's own naming (delve-run <stamp>.json), tagged live-<uid6>. The stamp is client-written,
   so it gets the helper's character filter and length cap before it is used in a path. */
export function runFileName(stamp, uid) {
  const s = String(stamp ?? '').replace(/[^0-9A-Za-z\-. _]/g, '').trim().slice(0, 40) || 'unstamped';
  const u = String(uid ?? '').replace(/[^0-9A-Za-z]/g, '').slice(0, 6) || 'anon';
  return `delve-run ${s} live-${u}.json`;
}

export function csvLine(values) {
  return values.map(v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(',');
}

const exists = p => access(p).then(() => true, () => false);

async function exportOne(d, { outDir, dryRun, now }) {
  if (!KINDS.includes(d.kind)) throw new Error(`unknown kind ${d.kind}`);
  let file = '';
  if (d.kind !== 'start') {
    if (!d.log) throw new Error('missing log');
    const text = await gunzip(d.log);
    const size = Buffer.byteLength(text, 'utf8');
    if (size !== d.rawBytes) throw new Error(`unpacked ${size} bytes, rawBytes says ${d.rawBytes}`);
    JSON.parse(text);
    file = runFileName(d.stamp, d.uid);
    if (!dryRun) {
      const path = join(outDir, file);
      await writeFile(path, text, 'utf8');
      if (await readFile(path, 'utf8') !== text) throw new Error(`read-back mismatch for ${file}`);
    }
  }
  return [new Date(now).toISOString(), String(d.uid ?? '').slice(0, 6), d.stamp, d.game, d.level, d.result,
    d.endReason, d.durationSec, d.score, d.kind, d.kind === 'start' ? null : d.rawBytes, file];
}

export async function exportRuns(db, { outDir, keep = false, dryRun = false, now = Date.now(),
  minAgeMs = 3600000, pageSize = 200 } = {}) {
  const cutoff = Timestamp.fromMillis(now - minAgeMs);
  const report = { counts: { full: 0, slim: 0, partial: 0, start: 0 }, failures: [], exportedBytes: 0,
    deleted: 0, remainingBytes: 0, skippedRecent: 0 };
  const csvPath = join(outDir, 'runs-summary.csv');
  if (!dryRun) await mkdir(outDir, { recursive: true });
  const toDelete = [];

  for (let last = null; ;) {
    let q = db.collection('runs').where('updatedAt', '<', cutoff).orderBy('updatedAt').limit(pageSize);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    last = page.docs[page.docs.length - 1];
    for (const doc of page.docs) {
      const d = doc.data(), logBytes = d.log ? d.log.length : 0;
      try {
        const row = await exportOne(d, { outDir, dryRun, now });
        if (!dryRun) {
          if (!(await exists(csvPath))) await writeFile(csvPath, csvLine(CSV_HEADER) + '\n', 'utf8');
          await appendFile(csvPath, csvLine(row) + '\n', 'utf8');
        }
        report.counts[d.kind]++;
        report.exportedBytes += logBytes;
        if (keep || dryRun) report.remainingBytes += logBytes;
        else toDelete.push(doc.ref);
      } catch (e) {
        report.failures.push({ id: doc.id, error: e.message });
        report.remainingBytes += logBytes;
      }
    }
  }

  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = db.batch();
    for (const ref of toDelete.slice(i, i + 500)) batch.delete(ref);
    await batch.commit();
    report.deleted += Math.min(500, toDelete.length - i);
  }

  const recent = await db.collection('runs').where('updatedAt', '>=', cutoff).get();
  report.skippedRecent = recent.size;
  for (const doc of recent.docs) report.remainingBytes += doc.get('log')?.length ?? 0;
  return report;
}
```

- [ ] **Step 5: Write `scripts/export-runs.mjs`**

```js
#!/usr/bin/env node
/* Export public run logs from Firestore into telemetry-live/ (or --out), then delete them from the
   cloud. Logs in with Application Default Credentials: run `gcloud auth application-default login` once.
     node scripts/export-runs.mjs [--dry-run] [--keep] [--out <dir>] [--min-age-minutes <n>]       */
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exportRuns } from './export-core.mjs';

const GiB = 1024 ** 3;
const { values: a } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
  keep: { type: 'boolean', default: false },
  out: { type: 'string', default: 'telemetry-live' },
  'min-age-minutes': { type: 'string', default: '60' },
  project: { type: 'string', default: 'puzzle-punch' },
} });

initializeApp({ projectId: a.project });
const r = await exportRuns(getFirestore(), {
  outDir: a.out, keep: a.keep, dryRun: a['dry-run'], minAgeMs: Number(a['min-age-minutes']) * 60000,
});

const mb = n => (n / 1024 ** 2).toFixed(1) + ' MB';
console.log(`${a['dry-run'] ? 'DRY RUN — nothing written or deleted. ' : ''}Output: ${a.out}`);
console.log(`Exported: ${r.counts.full} full, ${r.counts.slim} slim, ${r.counts.partial} partial, ${r.counts.start} start-only`);
console.log(`Log bytes exported: ${mb(r.exportedBytes)}. Deleted from Firestore: ${r.deleted}.`);
console.log(`Skipped (updated in the last ${a['min-age-minutes']} min): ${r.skippedRecent}.`);
console.log(`Still stored: ${mb(r.remainingBytes)} of logs (${(100 * r.remainingBytes / GiB).toFixed(1)}% of the 1 GiB free tier).`);
for (const f of r.failures) console.log(`FAILED ${f.id}: ${f.error} (kept in Firestore)`);
process.exitCode = r.failures.length ? 1 : 0;
```

- [ ] **Step 6: Ignore the export folder**

Append to `.gitignore`:

```
# written by scripts/export-runs.mjs; public players' run logs, not source
telemetry-live/
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npm test && npm run test:emulator`
Expected: PASS. The unit tests from Tasks 1 and 3, plus the emulator rules and export tests.

- [ ] **Step 8: Commit**

```bash
git add scripts/export-core.mjs scripts/export-runs.mjs .gitignore test/unit/export-core.test.mjs test/emulator/export.test.mjs
git commit -m "Add export script: Firestore runs to delve-run files and a CSV, then delete"
```

---

### Task 4: Browser module, web app config, and deploy wiring

**Files:**
- Create: `live/firebase-config.js` (generated from the CLI)
- Create: `live/cloud-telemetry.js`
- Create: `scripts/inject-telemetry.mjs`
- Modify: `scripts/deploy.sh`
- Test: `test/unit/inject-telemetry.test.mjs`

**Interfaces:**
- Consumes: everything in `live/telemetry-core.js` (Task 1); emulator ports 9099 / 8080 / 5002 (Task 2); `firestore.rules` (Task 2).
- Produces:
  - `export const firebaseConfig` from `live/firebase-config.js`.
  - `TAG` and `injectTelemetry(html: string) → string` from `scripts/inject-telemetry.mjs`.
  - `deploy.sh`, which deploys hosting plus rules; `deploy.sh --serve` runs the emulators.

- [ ] **Step 1: Register the web app and write the config**

This creates a web app in the `puzzle-punch` Firebase project. The spec approves it. Run:

```bash
npx -y firebase-tools apps:create WEB "Puzzle Punch Live"
npx -y firebase-tools apps:sdkconfig WEB <the appId printed above>
```

Write `live/firebase-config.js` with the printed values. Every key from the output goes in, and `measurementId` must be present:

```js
/* The Firebase web app's config (firebase apps:sdkconfig WEB). Public by design: it names the
   project, it grants nothing; firestore.rules decides what a browser may do. */
export const firebaseConfig = {
  apiKey: '<from sdkconfig>',
  authDomain: 'puzzle-punch.firebaseapp.com',
  projectId: 'puzzle-punch',
  storageBucket: '<from sdkconfig>',
  messagingSenderId: '<from sdkconfig>',
  appId: '<from sdkconfig>',
  measurementId: '<from sdkconfig>',
};
```

**Every `<from sdkconfig>` must be replaced with the real value.** If `measurementId` is missing, GA isn't linked to the web app. Stop and report it: the user links it in the console under Project settings → Integrations → Google Analytics, then rerun `apps:sdkconfig`.

- [ ] **Step 2: Write the failing injection test**

`test/unit/inject-telemetry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { injectTelemetry, TAG } from '../../scripts/inject-telemetry.mjs';

test('inserts the module tag just before </body>', () => {
  assert.equal(injectTelemetry('<html><body>x</body></html>'), `<html><body>x${TAG}\n</body></html>`);
});

test('refuses a page with no </body>', () => {
  assert.throws(() => injectTelemetry('<html>x</html>'), /exactly one <\/body>, found 0/);
});

test('refuses a page with two </body>', () => {
  assert.throws(() => injectTelemetry('</body></body>'), /exactly one <\/body>, found 2/);
});

test('the real game file has exactly one </body>', () => {
  const html = readFileSync('PUZZLE PUNCH.html', 'utf8');
  assert.ok(injectTelemetry(html).includes(TAG));
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../scripts/inject-telemetry.mjs'`.

- [ ] **Step 4: Write `scripts/inject-telemetry.mjs`**

```js
/* Adds the cloud telemetry module to the built page (public/index.html). The game file itself is
   never edited; like the trim, this stops rather than guess if the page is not shaped as expected.
     node scripts/inject-telemetry.mjs public/index.html                                            */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TAG = '<script type="module" src="cloud-telemetry.js"></script>';

export function injectTelemetry(html) {
  const n = html.split('</body>').length - 1;
  if (n !== 1) throw new Error(`expected exactly one </body>, found ${n}`);
  return html.replace('</body>', `${TAG}\n</body>`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  writeFileSync(file, injectTelemetry(readFileSync(file, 'utf8')));
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npm test`
Expected: PASS, including `the real game file has exactly one </body>`.

- [ ] **Step 6: Write `live/cloud-telemetry.js`**

```js
/* Cloud telemetry for the public Firebase build: GA page views and run events, and each run's log,
   gzipped, in Firestore (runs/{uid}_{stamp}). scripts/deploy.sh adds this module to public/index.html;
   the game file knows nothing about it, and nothing here may throw into the game.
   Spec: docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAnalytics, isSupported, logEvent } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, serverTimestamp, Bytes } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { gameHooks, snapshotOf, createTracker, docId, headerFields, buildLog, createQueue, PARTIAL_GAP_MS } from './telemetry-core.js';

const warn = (...a) => console.warn('[cloud-telemetry]', ...a);
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
/* The game's globals, read by name (they are classic-script let/const, not window properties). */
const hooks = () => gameHooks(() => ({ G, stamp: RUN_STAMP, full: telemetryJSON, slim: telemetrySlimJSON }));

/* GA: getAnalytics sends page_view on its own. On localhost the events go to the console instead. */
function setupAnalytics(app) {
  if (LOCAL) return Promise.resolve((name, params) => console.debug('[cloud-telemetry] GA', name, params));
  return isSupported()
    .then(ok => {
      if (!ok) return () => {};
      const a = getAnalytics(app);
      return (name, params) => logEvent(a, name, params);
    })
    .catch(e => { warn('analytics off', e); return () => {}; });
}

/* Firestore: anonymous sign-in, then save(stamp, fields, create). On localhost, the emulators. */
function setupStore(app) {
  const auth = getAuth(app), db = getFirestore(app);
  if (LOCAL) {
    connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8080);
  }
  const uid = signInAnonymously(auth).then(c => c.user.uid);
  uid.catch(e => warn('sign-in failed; runs will not be saved', e));
  return async (stamp, fields, create) => {
    const id = await uid;
    const data = { uid: id, stamp, ...fields, updatedAt: serverTimestamp() };
    if (create) data.createdAt = serverTimestamp();
    await setDoc(doc(db, 'runs', docId(id, stamp)), data, { merge: !create });
  };
}

function start() {
  if (!hooks()) { warn('game globals not found; telemetry off'); return; }
  const app = initializeApp(firebaseConfig);
  const ga = setupAnalytics(app);
  const save = setupStore(app);
  const enqueue = createQueue(e => warn('save failed', e));
  const tracker = createTracker();
  const lastPartial = new Map();   // stamp -> time of its last hidden-tab save

  const event = (name, params) => ga.then(log => { try { log(name, params); } catch (e) { warn('GA', e); } });
  const saveLog = (h, stamp, kind) => enqueue(async () => {
    const slim = h.slim();
    const { kind: k, log, rawBytes } = await buildLog(kind, h.full(), slim);
    await save(stamp, { ...headerFields(slim), kind: k, log: Bytes.fromUint8Array(log), rawBytes }, false);
  });

  setInterval(() => {
    const h = hooks();
    if (!h) return;
    for (const ev of tracker.step(snapshotOf(h))) {
      try {
        const head = headerFields(h.slim());
        if (ev.type === 'start') {
          event('run_start', { level: head.level, game: head.game });
          enqueue(() => save(ev.stamp, { ...head, kind: 'start' }, true));
        } else {
          event('run_end', { level: head.level, game: head.game, result: head.result,
            end_reason: head.endReason ?? '', duration_sec: head.durationSec ?? 0, score: head.score ?? 0 });
          saveLog(h, ev.stamp, 'full');
        }
      } catch (e) { warn(ev.type, e); }
    }
  }, 1000);

  /* A phone player who switches away mid-run: save what there is so far (at most every 5 minutes). */
  document.addEventListener('visibilitychange', () => {
    try {
      if (document.visibilityState !== 'hidden') return;
      const h = hooks(), stamp = tracker.active();
      if (!h || !stamp || h.stamp !== stamp) return;
      const now = Date.now();
      if (now - (lastPartial.get(stamp) ?? -Infinity) < PARTIAL_GAP_MS) return;
      lastPartial.set(stamp, now);
      saveLog(h, stamp, 'partial');
    } catch (e) { warn('hidden', e); }
  });
}

try { start(); } catch (e) { warn('start failed', e); }
```

Notes for the implementer:
- `telemetryJSON()` builds the full log on the main thread. It's only called at run end (state `end`, play has stopped) and when the tab is hidden, so it can't cause a frame hitch. The game's own 30-second autosave keeps running and keeps 404ing on Hosting, as it does today.
- If the gstatic imports are blocked, the module never runs. That is the intended "blocked" behavior: the game is a separate script and is unaffected.

- [ ] **Step 7: Wire up `scripts/deploy.sh`**

Replace the whole file with:

```bash
#!/usr/bin/env bash
# Build the Hosting payload and deploy it.
#
# The game is a single self-contained HTML file at the repo root. Hosting wants an
# index.html in a directory of its own, so we copy it in fresh every time -- that
# way a deploy can never ship a stale copy. public/ is generated, not source.
# The cloud telemetry module (live/*.js) is copied beside it and its <script> tag is
# added to public/index.html only; the game file itself is never edited.
#
# Usage: scripts/deploy.sh            # deploy hosting + Firestore rules
#        scripts/deploy.sh --serve    # preview on localhost:5002 against local emulators
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf public
mkdir public
cp "PUZZLE PUNCH.html" public/index.html
cp live/*.js public/
node scripts/inject-telemetry.mjs public/index.html

if [ "${1-}" = "--serve" ]; then
  # the emulators need Java; brew's openjdk is keg-only
  if [ -d /opt/homebrew/opt/openjdk/bin ]; then PATH="/opt/homebrew/opt/openjdk/bin:$PATH"; fi
  exec npx -y firebase-tools emulators:start --only hosting,auth,firestore
fi

exec npx -y firebase-tools deploy --only hosting,firestore:rules
```

- [ ] **Step 8: End-to-end check against the emulators**

1. Run `scripts/deploy.sh --serve` (leave it running). Open `http://localhost:5002/`.
2. In the browser console:
   - Expected: no `[cloud-telemetry]` warnings.
   - Expected: running `document.querySelector('script[src="cloud-telemetry.js"]')` returns the tag.
3. Press START. Within 2 seconds the console shows `[cloud-telemetry] GA run_start {…}`. Then in a terminal:

   ```bash
   curl -s -H "Authorization: Bearer owner" "http://localhost:8080/v1/projects/puzzle-punch/databases/(default)/documents/runs" | grep -o '"kind": *{[^}]*}'
   ```

   Expected: `"stringValue": "start"`.
4. Hide the tab for a moment and come back, then rerun the `curl`. Expected: `"partial"`.
5. In the console run `DELVE.debug.win()`. Expected: a `GA run_end` line in the console, and `curl` shows `"full"`.
6. Once `curl` shows `"full"`, note `RUN_STAMP` and `TELEM.length` from the console. Then:

   ```bash
   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/export-runs.mjs --out /tmp/pp-e2e --min-age-minutes 0
   node -e "const f=require('fs'),d='/tmp/pp-e2e/';const n=f.readdirSync(d).find(x=>x.endsWith('.json'));const o=JSON.parse(f.readFileSync(d+n));console.log(n,o.run,o.result,o.events.length)"
   ```

   Expected: one file whose `run` equals `RUN_STAMP`, `result` is `WIN`, and the event count equals `TELEM.length`. The script reports `Deleted from Firestore: 1`.
7. Blocked-SDK check: in DevTools → Network, block the `www.gstatic.com` domain, reload, and play a few seconds. Expected: the game plays normally, and the only errors are the blocked module loads.
8. Stop the emulators (Ctrl-C).

- [ ] **Step 9: Commit**

```bash
git add live/firebase-config.js live/cloud-telemetry.js scripts/inject-telemetry.mjs scripts/deploy.sh test/unit/inject-telemetry.test.mjs
git commit -m "Add cloud telemetry module and wire it into deploy"
```

---

### Task 5: Cloud setup, first deploy, README

The console steps are the user's. **Confirm with the user before the deploy in Step 3**: it goes to the public site.

**Files:**
- Modify: `README.md` (new "Cloud telemetry" section; update the "Deploy" section)

**Interfaces:**
- Consumes: everything above.
- Produces: the live feature, and documentation of it.

- [ ] **Step 1: Cloud project setup**

1. **User, in the console:** Authentication → Get started → Sign-in method → enable **Anonymous**.
2. Create the database:

   ```bash
   npx -y firebase-tools firestore:databases:create "(default)" --location nam5
   ```

   Expected: the database is created. If the CLI asks about an edition, choose Standard.
3. **User, optional:** GA Admin → Custom definitions → add event-scoped dimensions `result` and `level`.

- [ ] **Step 2: Export credentials**

**User** runs these. They are interactive browser logins:

```bash
brew install google-cloud-sdk
gcloud auth application-default login
gcloud auth application-default set-quota-project puzzle-punch
```

Run: `node scripts/export-runs.mjs --dry-run`
Expected: `DRY RUN …`, zero counts, and no permission error.

- [ ] **Step 3: Deploy, after the user confirms**

Run: `scripts/deploy.sh`
Expected: `Deploy complete!` for both hosting and firestore rules.

- [ ] **Step 4: Live verification**

1. Open the Hosting URL and play one run to the end. The deployed build has no debug UI, so play it, or call `DELVE.debug.win()` from the console.
2. GA → Reports → Realtime shows `page_view`, `run_start` and `run_end` within a few minutes.
3. Firebase console → Firestore → `runs` shows one document with `kind: full`.
4. `node scripts/export-runs.mjs --min-age-minutes 0 --keep` writes the run to `telemetry-live/`. The cloud copy is kept, so the real data stays until the user decides to clear it.

- [ ] **Step 5: Update `README.md`**

In the existing "Deploy" section, replace the paragraph that begins "Firebase Hosting serves the game as a static page." with:

```markdown
Firebase Hosting serves the game as a static page. There is no helper up there, so local records and
run logs are off: the game sees the `/highscore` 404, sets `telemOffline` and says so on the HUD.
It plays in full otherwise. Run logs go to the cloud instead; see Cloud telemetry below.
```

Replace the `scripts/deploy.sh --serve` line's comment with `# preview on localhost:5002 against local emulators (needs Java)`.

Then add this section after "Deploy":

```markdown
## Cloud telemetry
The deployed page also loads `live/cloud-telemetry.js`, which `scripts/deploy.sh` copies into
`public/` and adds to `public/index.html`. The game file is untouched. It:

- sends Google Analytics a `page_view` on every load, plus `run_start` and `run_end` events;
- saves each human run's log, gzipped, to Firestore `runs/{uid}_{stamp}` (anonymous sign-in).
  Logs over 900 KB gzipped are saved slim (header and summary only).

Players can write only their own runs and can never read; see `firestore.rules`.

Export runs to `telemetry-live/` (gitignored) and delete them from the cloud:

    node scripts/export-runs.mjs --dry-run   # count only
    node scripts/export-runs.mjs             # export, then delete
    node scripts/export-runs.mjs --keep      # export, keep the cloud copy
    node scripts/export-runs.mjs --out ../Puzzle-Punch/telemetry

Each run becomes `delve-run <stamp> live-<uid6>.json`, the same shape the helper writes, and a row in
`telemetry-live/runs-summary.csv`. First time: `gcloud auth application-default login`.

The project stays on the free Spark plan: 1 GiB stored (~30,000 runs) and 20K writes/day (~7,000 runs/day).
Going over stops recording until the next day; it never bills. Export monthly, or when the console's
Firestore usage nears 800 MB.

Tests: `npm test` (unit) and `npm run test:emulator` (rules and export; needs `brew install openjdk`).
```

In the "What is here" table, add these rows:

```markdown
| `live/` | The cloud telemetry module, added to the deployed page only. |
| `firestore.rules` | Who may write run logs (players: their own; nobody reads). |
| `scripts/export-runs.mjs` | Pulls run logs down to `telemetry-live/` and clears them from Firestore. |
```

- [ ] **Step 6: Run all tests one last time**

Run: `npm test && npm run test:emulator`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "Document cloud telemetry: setup, export, quotas"
```

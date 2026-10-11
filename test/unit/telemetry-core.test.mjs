import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_STATES, SLIM_THRESHOLD, gameHooks, snapshotOf, createTracker, docId, headerFields, stampOf,
  gzip, gunzip, buildLog, createQueue, createRecorder,
} from '../../live/telemetry-core.js';

const hooksFor = (G, log = []) => ({ G, telem: () => log, full: () => '{}', slim: () => '{}' });

test('RUN_STATES matches the game\'s inRunState', () => {
  assert.deepEqual([...RUN_STATES].sort(), ['end', 'escape', 'escort', 'greed', 'hold']);
});

test('gameHooks returns the hooks when every global is present', () => {
  const h = hooksFor({ state: 'setup' });
  assert.equal(gameHooks(() => h), h);
});

test('gameHooks returns null when a global is missing or renamed', () => {
  assert.equal(gameHooks(() => { throw new ReferenceError('G is not defined'); }), null);
  assert.equal(gameHooks(() => ({ G: {}, telem: () => [], full: () => '', slim: undefined })), null);
  assert.equal(gameHooks(() => ({ G: null, telem: () => [], full: () => '', slim: () => '' })), null);
  assert.equal(gameHooks(() => ({ G: {}, telem: undefined, full: () => '', slim: () => '' })), null);
});

test('snapshotOf flags bot runs and the studio stage as skipped', () => {
  const log = [];
  assert.deepEqual(snapshotOf(hooksFor({ state: 'escort' }, log)), { run: log, state: 'escort', skip: false });
  assert.equal(snapshotOf(hooksFor({ state: 'escort' }, log)).run, log);   // the run is the log array itself
  assert.equal(snapshotOf(hooksFor({ state: 'escort', bot: { seed: 1 } })).skip, true);
  assert.equal(snapshotOf(hooksFor({ state: 'escort', stage: {} })).skip, true);
});

test('tracker: one start and one end per run', () => {
  const t = createTracker();
  assert.deepEqual(t.step({ run: 'a', state: 'setup', skip: false }), []);
  assert.deepEqual(t.step({ run: 'a', state: 'escort', skip: false }), [{ type: 'start', run: 'a' }]);
  assert.equal(t.active(), 'a');
  assert.deepEqual(t.step({ run: 'a', state: 'hold', skip: false }), []);
  assert.deepEqual(t.step({ run: 'a', state: 'end', skip: false }), [{ type: 'end', run: 'a' }]);
  assert.equal(t.active(), null);
  assert.deepEqual(t.step({ run: 'a', state: 'end', skip: false }), []);
});

test('tracker: several runs in one page load, bot run ignored', () => {
  const t = createTracker();
  t.step({ run: 'a', state: 'escort', skip: false });
  t.step({ run: 'a', state: 'end', skip: false });
  t.step({ run: 'a', state: 'setup', skip: false });
  assert.deepEqual(t.step({ run: 'bot', state: 'escort', skip: true }), []);
  assert.deepEqual(t.step({ run: 'bot', state: 'end', skip: true }), []);
  assert.equal(t.active(), null);
  assert.deepEqual(t.step({ run: 'b', state: 'escort', skip: false }), [{ type: 'start', run: 'b' }]);
  assert.deepEqual(t.step({ run: 'b', state: 'end', skip: false }), [{ type: 'end', run: 'b' }]);
});

test('tracker: a run first seen at its end reports start then end', () => {
  const t = createTracker();
  assert.deepEqual(t.step({ run: 'a', state: 'end', skip: false }),
    [{ type: 'start', run: 'a' }, { type: 'end', run: 'a' }]);
});

test('tracker: a run abandoned back to setup is not active', () => {
  const t = createTracker();
  t.step({ run: 'a', state: 'escort', skip: false });
  t.step({ run: 'a', state: 'setup', skip: false });
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

test('stampOf reads the run stamp from the log header', () => {
  assert.equal(stampOf(JSON.stringify({ run: '2026-10-10 120000', level: 'depths' })), '2026-10-10 120000');
  assert.equal(stampOf('{}'), 'unstamped');
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

/* createRecorder: the poll / hidden-tab logic, with Firebase and GA injected. */
function fakeGame() {
  const g = { G: { state: 'setup' }, log: [], stamp: 'A' };
  g.hooks = () => ({
    G: g.G, telem: () => g.log,
    full: () => JSON.stringify({ run: g.stamp, events: g.log }),
    slim: () => JSON.stringify({ run: g.stamp, level: 'depths', result: g.G.state === 'end' ? 'WIN' : 'in-progress' }),
  });
  g.newRun = stamp => { g.stamp = stamp; g.log = []; g.G.state = 'escort'; };
  return g;
}

test('recorder: the end save carries the run that ended, even when an earlier save stalls', async () => {
  const g = fakeGame(), saves = [], events = [];
  let release; const gate = new Promise(r => { release = r; });
  const save = async (stamp, fields, create) => {
    saves.push({ stamp, kind: fields.kind, create, text: fields.log ? await gunzip(fields.log) : null });
    if (saves.length === 1) await gate;   // A's start write hangs (phone offline)
  };
  const rec = createRecorder({ hooks: g.hooks, save, event: (n, p) => events.push(n), warn: () => {} });
  g.newRun('A'); g.log.push('a1'); rec.tick();          // A starts; its save stalls
  g.G.state = 'end'; rec.tick();                        // A ends while the queue is blocked
  g.newRun('B'); g.log.push('b1'); rec.tick();          // B starts before the network returns
  release(); await rec.flush();
  assert.deepEqual(saves.map(s => [s.stamp, s.kind]), [['A', 'start'], ['A', 'full'], ['B', 'start']]);
  assert.equal(saves[1].text, JSON.stringify({ run: 'A', events: ['a1'] }));
  assert.deepEqual(events, ['run_start', 'run_end', 'run_start']);
});

test('recorder: a hidden tab saves a partial at most once per 5 minutes', async () => {
  const g = fakeGame(), saves = [];
  let t = 0;
  const rec = createRecorder({ hooks: g.hooks, save: async (s, f) => { saves.push(f.kind); }, event: () => {}, warn: () => {}, now: () => t });
  g.newRun('A'); rec.tick();
  rec.hidden(); t = 60000; rec.hidden(); t = 300001; rec.hidden();
  g.G.state = 'end'; rec.tick(); rec.hidden();          // ended: no partial
  await rec.flush();
  assert.deepEqual(saves, ['start', 'partial', 'partial', 'full']);
});

test('recorder: a throwing game hook is reported, not thrown', () => {
  const warns = [];
  const rec = createRecorder({ hooks: () => ({ G: {}, telem: () => { throw new Error('gone'); }, full: () => '', slim: () => '' }),
    save: async () => {}, event: () => {}, warn: (...a) => warns.push(a.join(' ')) });
  assert.doesNotThrow(() => { rec.tick(); rec.hidden(); });
  assert.ok(warns.length >= 1);
});

test('gunzip stops at a byte limit instead of inflating a gzip bomb', async () => {
  const { gzipSync } = await import('node:zlib');
  const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024));   // 50 MB of zeros, ~50 KB compressed
  await assert.rejects(gunzip(bomb, 1024 * 1024), /over 1048576 bytes/);
  assert.equal((await gunzip(await gzip('hello'), 5)), 'hello');
});

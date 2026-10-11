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

test('a gzip bomb or an absurd rawBytes is refused without inflating it, and the export carries on', async () => {
  const { gzipSync } = await import('node:zlib');
  const bomb = gzipSync(Buffer.alloc(50 * 1024 * 1024));
  await db.collection('runs').doc('a_bomb').set({ uid: 'abcdef1', stamp: 'b1', kind: 'full', log: bomb, rawBytes: 1000, updatedAt: OLD });
  await db.collection('runs').doc('a_huge').set({ uid: 'abcdef1', stamp: 'b2', kind: 'full', log: bomb, rawBytes: 2e9, updatedAt: OLD });
  await seedRun('a_ok', { stamp: 's3' });
  const r = await exportRuns(db, { outDir: out, now: NOW });
  const why = Object.fromEntries(r.failures.map(f => [f.id, f.error]));
  assert.match(why.a_bomb, /over 1000 bytes/);
  assert.match(why.a_huge, /rawBytes/);
  assert.equal(r.counts.full, 1);
});

test('a run updated after it was read is kept, not deleted', async () => {
  await seedRun('a_1', { stamp: 's1', kind: 'partial' });
  await seedRun('a_2', { stamp: 's2' });
  const r = await exportRuns(db, { outDir: out, now: NOW, progress: async row => {
    // the player comes back and finishes run s1 while the export is still working
    if (row[2] === 's1') await db.collection('runs').doc('a_1').set({ kind: 'full', updatedAt: Timestamp.now() }, { merge: true });
  } });
  assert.equal(r.deleted, 1);
  assert.deepEqual(r.changed, ['a_1']);
  assert.equal((await db.collection('runs').doc('a_1').get()).get('kind'), 'full');
});

test('--purge-invalid quarantines documents that cannot be exported, then deletes them', async () => {
  await db.collection('runs').doc('a_bad').set({ uid: 'abcdef1', stamp: 's1', kind: 'full', log: Buffer.from([1, 2, 3]), rawBytes: 3, updatedAt: OLD });
  await seedRun('a_ok', { stamp: 's2' });
  const r = await exportRuns(db, { outDir: out, now: NOW, purgeInvalid: true });
  assert.deepEqual(r.purged, ['a_bad']);
  assert.equal(r.failures.length, 0);
  assert.equal(await docCount(), 0);
  const q = JSON.parse(await readFile(join(out, 'quarantine', 'a_bad.json'), 'utf8'));
  assert.equal(q.id, 'a_bad');
  assert.match(q.error, /gzip|over 3 bytes/i);
  assert.equal(q.data.log, Buffer.from([1, 2, 3]).toString('base64'));
});

test('without --purge-invalid, a document that cannot be exported is kept', async () => {
  await db.collection('runs').doc('a_bad').set({ uid: 'abcdef1', stamp: 's1', kind: 'full', log: Buffer.from([1, 2, 3]), rawBytes: 3, updatedAt: OLD });
  const r = await exportRuns(db, { outDir: out, now: NOW });
  assert.deepEqual(r.purged, []);
  assert.equal(await docCount(), 1);
});

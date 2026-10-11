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
export const MAX_RAW_BYTES = 64 * 1024 * 1024;   // far above any real log (the largest seen is 2.4 MB)

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
    if (!Number.isInteger(d.rawBytes) || d.rawBytes < 0 || d.rawBytes > MAX_RAW_BYTES) {
      throw new Error(`rawBytes ${d.rawBytes} is not a size between 0 and ${MAX_RAW_BYTES}`);
    }
    const text = await gunzip(d.log, d.rawBytes).catch(e => {   // never inflates past what the document claims
      throw new Error(/over \d+ bytes/.test(e.message) ? e.message : `log is not valid gzip (${e.message || e.name})`);
    });
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

/* A document that cannot be exported, as JSON: bytes as base64, timestamps as ISO strings. */
function quarantineJSON(id, error, d) {
  const data = {};
  for (const [k, v] of Object.entries(d)) {
    data[k] = Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(v).toString('base64')
      : v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v;
  }
  return JSON.stringify({ id, error, data }, null, 1);
}

/* progress(row) is called after each run is exported (the CLI shows a running count).
   purgeInvalid: a document that cannot be exported is saved to <outDir>/quarantine/ and deleted,
   instead of being kept for ever. */
export async function exportRuns(db, { outDir, keep = false, dryRun = false, now = Date.now(),
  minAgeMs = 3600000, pageSize = 200, progress = () => {}, purgeInvalid = false } = {}) {
  const cutoff = Timestamp.fromMillis(now - minAgeMs);
  const report = { counts: { full: 0, slim: 0, partial: 0, start: 0 }, failures: [], exportedBytes: 0,
    deleted: 0, changed: [], purged: [], remainingBytes: 0, skippedRecent: 0 };
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
        else toDelete.push({ doc, logBytes });
        await progress(row);
      } catch (e) {
        if (purgeInvalid && !dryRun && !keep) {
          try {
            const qDir = join(outDir, 'quarantine');
            await mkdir(qDir, { recursive: true });
            await writeFile(join(qDir, doc.id.replace(/[^0-9A-Za-z_-]/g, '-') + '.json'), quarantineJSON(doc.id, e.message, d), 'utf8');
            toDelete.push({ doc, logBytes, purge: true });
            continue;
          } catch (qe) { e.message += `; quarantine failed: ${qe.message}`; }
        }
        report.failures.push({ id: doc.id, error: e.message });
        report.remainingBytes += logBytes;
      }
    }
  }

  /* Delete only what is unchanged since it was read: a run the player finished in the meantime (its
     full log merged over an exported partial) stays for the next export. */
  const writer = db.bulkWriter();
  writer.onWriteError(() => false);   // no retries; a refused delete just keeps the document
  const deletes = toDelete.map(({ doc, logBytes, purge }) =>
    writer.delete(doc.ref, { lastUpdateTime: doc.updateTime }).then(
      () => { if (purge) report.purged.push(doc.id); else report.deleted++; },
      e => {
        report.remainingBytes += logBytes;
        if (e.code === 9) report.changed.push(doc.id);   // FAILED_PRECONDITION: updated since read
        else report.failures.push({ id: doc.id, error: `delete: ${e.message}` });
      }));
  await writer.close();   // sends the queued deletes; their promises settle by now
  await Promise.all(deletes);

  const recent = await db.collection('runs').where('updatedAt', '>=', cutoff).get();
  report.skippedRecent = recent.size;
  for (const doc of recent.docs) report.remainingBytes += doc.get('log')?.length ?? 0;
  return report;
}

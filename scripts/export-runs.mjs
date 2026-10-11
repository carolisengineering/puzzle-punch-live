#!/usr/bin/env node
/* Export public run logs from Firestore into telemetry-live/ (or --out), then delete them from the
   cloud. Logs in with Application Default Credentials: run `gcloud auth application-default login` once.
     node scripts/export-runs.mjs [--dry-run] [--keep] [--purge-invalid] [--out <dir>] [--min-age-minutes <n>] */
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exportRuns } from './export-core.mjs';

const GiB = 1024 ** 3;
const { values: a } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
  keep: { type: 'boolean', default: false },
  'purge-invalid': { type: 'boolean', default: false },
  out: { type: 'string', default: 'telemetry-live' },
  'min-age-minutes': { type: 'string', default: '60' },
  project: { type: 'string', default: 'puzzle-punch' },
} });

initializeApp({ projectId: a.project });
const r = await exportRuns(getFirestore(), {
  outDir: a.out, keep: a.keep, dryRun: a['dry-run'], minAgeMs: Number(a['min-age-minutes']) * 60000,
  purgeInvalid: a['purge-invalid'],
});

const mb = n => (n / 1024 ** 2).toFixed(1) + ' MB';
console.log(`${a['dry-run'] ? 'DRY RUN — nothing written or deleted. ' : ''}Output: ${a.out}`);
console.log(`Exported: ${r.counts.full} full, ${r.counts.slim} slim, ${r.counts.partial} partial, ${r.counts.start} start-only`);
console.log(`Log bytes exported: ${mb(r.exportedBytes)}. Deleted from Firestore: ${r.deleted}.`);
console.log(`Skipped (updated in the last ${a['min-age-minutes']} min): ${r.skippedRecent}.`);
if (r.changed.length) console.log(`Kept (updated while exporting; next export takes them): ${r.changed.length}.`);
console.log(`Still stored: ${mb(r.remainingBytes)} of logs (${(100 * r.remainingBytes / GiB).toFixed(1)}% of the 1 GiB free tier).`);
if (r.purged.length) console.log(`Purged (could not be exported; saved under ${a.out}/quarantine/): ${r.purged.length}.`);
for (const f of r.failures) console.log(`FAILED ${f.id}: ${f.error} (kept in Firestore; --purge-invalid clears it)`);
process.exitCode = r.failures.length ? 1 : 0;

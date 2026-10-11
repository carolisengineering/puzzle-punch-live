# Exempt `runs.log` from Firestore indexing

Approved 2026-10-11. Branch: `firestore-log-index-exemption`.

## Why

By default, Firestore keeps an ascending and a descending single-field index entry for every field.
Indexing a bytes field uses its first 1,500 bytes, so each run's gzipped `log` adds about 3 KB of
index storage. Nothing ever queries on `log`. A run uses about 35 KB on average (1 GiB ÷ ~30,000
runs), so the exemption saves roughly 8–9%. That's that many more runs before the free 1 GiB fills.

## Constraint

`scripts/export-core.mjs` filters and sorts on `updatedAt`
(`where('updatedAt', '<', cutoff).orderBy('updatedAt')`). Its index must stay. Only `log` is exempted.

## Changes

1. **`firestore.indexes.json`** (new):

   ```json
   {
     "indexes": [],
     "fieldOverrides": [
       { "collectionGroup": "runs", "fieldPath": "log", "indexes": [] }
     ]
   }
   ```

2. **`firebase.json`**: add `"indexes": "firestore.indexes.json"` under `firestore`.
3. **`scripts/deploy.sh`**: deploy `hosting,firestore:rules,firestore:indexes`, so the index file
   ships with every deploy. The command you run doesn't change.
4. **Docs**:
   - Remove the item from the runbook's "Known small issues" list and from
     `docs/NEXT STEPS — suggestions.md`.
   - Add one README line saying `log` isn't indexed.

## Testing

- A unit test (`test/unit/firestore-indexes.test.mjs`) reads `firestore.indexes.json` and checks
  three things:
  - `runs.log` is exempted (an empty `indexes` list).
  - No override touches `updatedAt`.
  - `firebase.json` points at the file.

  The emulator ignores index settings, so this test is the only guard against an exemption that
  would break the export.
- Run the existing unit and emulator tests unchanged.

## Rollout and check

- Run `scripts/deploy.sh`. The Firebase CLI may offer to delete indexes that exist in the console
  but not in the file. None are expected. If it asks, answer **no**.
- Then `npx -y firebase-tools firestore:indexes` should list the `runs.log` override. Firebase
  console → Firestore → Indexes → Single field should show it too.
- Firestore removes the existing index entries for `log` in the background. New runs are smaller
  right away.
- `node scripts/export-runs.mjs --dry-run` should still run with no index error.

## Left out on purpose

Exempting the other fields nobody queries (`stamp`, `endReason`, `game`, …). They're each a few
bytes, and exempting one by mistake could break a future query.

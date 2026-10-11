# Cloud telemetry: go-live steps

Merged into `main` (PR #1). Steps 1–6 are the one-time go-live. For day-to-day use, see
**Reading runs in the console** and **Routine: exporting runs** below. Every machine that exports
still needs step 2.
Design: `docs/superpowers/specs/2026-10-10-live-play-telemetry-design.md`.
Plan: `docs/superpowers/plans/2026-10-10-live-play-telemetry.md`.

Already done: the "Puzzle Punch Live" web app is registered in the `puzzle-punch` Firebase
project (config in `live/firebase-config.js`), `openjdk` is installed for the emulators, and the
Firestore `(default)` database exists (Standard edition), so step 3 is already done.

## 1. Turn on Anonymous sign-in (Firebase console)

Firebase console → **Authentication** → Get started (if asked) → **Sign-in method** → enable
**Anonymous** → Save.

Without this, the page can't sign players in and no runs are saved. The game still plays.

## 2. Set up export credentials (terminal, once per machine)

```bash
brew install google-cloud-sdk
gcloud auth application-default login
gcloud auth application-default set-quota-project puzzle-punch
```

The login opens a browser. In Claude Code, run the gcloud commands with a `!` prefix (e.g.
`! gcloud auth application-default login`) so they run in the session.

Check that it works (this reads only; it changes nothing):

```bash
node scripts/export-runs.mjs --dry-run
```

Expected: `DRY RUN …`, zero counts, and no permission error.

## 3. Create the Firestore database

```bash
npx -y firebase-tools firestore:databases:create "(default)" --location nam5
```

If it asks for an edition, choose **Standard**. The free quotas apply to the `(default)` database.

## 4. Deploy (changes the public site)

```bash
scripts/deploy.sh --serve   # optional: local preview on http://localhost:5002 against emulators
scripts/deploy.sh           # deploys hosting + firestore.rules
```

Expected: `deploying: PUZZLE PUNCH v0.85r @ <commit>` (with `-dirty` if there are uncommitted
changes), then `Deploy complete!` for both hosting and firestore rules. The label shows in the
Firebase console under Hosting → Release history.

## 5. Check it on the live site

1. Open the live site and play one run to the end. Or open the browser console, run
   `DELVE.debug.start()`, wait a few seconds, then run `DELVE.debug.win()`.
2. **GA:** Reports → Realtime shows `page_view`, `run_start` and `run_end` within a few minutes.
3. **Firestore:** Firebase console → Firestore → `runs` shows one document with `kind: full`.
4. **Export without deleting:**

   ```bash
   node scripts/export-runs.mjs --min-age-minutes 0 --keep
   ```

   The run appears in `telemetry-live/` as `delve-run <stamp> live-<id>.json`, plus a row in
   `telemetry-live/runs-summary.csv`.

GA Admin → Custom definitions → add event-scoped dimensions `game_version`, `result` and `level`.
`game_version` is on every event (including `page_view`), so reports can compare play before and after
each deploy. GA only reports on a dimension from the day it is registered, so add it before deploying.

## 6. Merge the branch

Once the live check passes, merge `live-telemetry` into `main`.

---

## Reading runs in the console

Firebase console → Firestore → `runs`. Each document is one run, with the ID `{uid}_{stamp}`.

- **Readable fields:** `kind` (`start`, `partial`, `full` or `slim`), `result`, `level`,
  `durationSec`, `score`, `endReason`, `game`, `stamp`, `createdAt` and `updatedAt`.
- **`log`:** the full run log, gzipped. The console shows only raw bytes. `rawBytes` is the size
  when unzipped. A `start` document has no log. A `slim` log keeps only the header and summary.

To read a log, export it (step 2's gcloud setup is needed once per machine):

```bash
node scripts/export-runs.mjs --min-age-minutes 0 --keep
```

`--min-age-minutes 0` includes runs from the last hour, and `--keep` leaves the cloud copy in
place. Each run is written to `telemetry-live/` as `delve-run <stamp> live-<id>.json`, plus a row in
`telemetry-live/runs-summary.csv`.

## Routine: exporting runs

Run this monthly, or when the console's Firestore usage nears 800 MB:

```bash
node scripts/export-runs.mjs --dry-run         # count only
node scripts/export-runs.mjs                   # export to telemetry-live/, then delete from Firestore
node scripts/export-runs.mjs --keep            # export, keep the cloud copy
node scripts/export-runs.mjs --purge-invalid   # also clear runs that can't be exported (saved to quarantine/ first)
node scripts/export-runs.mjs --out ../Puzzle-Punch/telemetry   # straight into the big repo's telemetry folder
```

Runs updated in the last hour are skipped; they're picked up next time.

**Free-tier limits** (Spark plan, never bills):

| What | Limit | What happens if it's reached |
|---|---|---|
| Writes | 20K/day, about 7,000–10,000 runs | Recording stops until the next day |
| Storage | 1 GiB, about 30,000 runs | Recording stops until you export |
| Reads / deletes | 50K / 20K per day | An export can clear up to 20,000 runs a day |

If junk data ever shows up, export with `--purge-invalid` and consider turning on App Check.

## Known small issues (deferred)

- If a future game version drops `run` from its log header, all runs would share one stamp
  (`unstamped`) and overwrite each other with no warning.
- A very large hidden-tab save is labelled `slim` instead of `partial`.
- An export that hits a daily quota stops with a stack trace and no summary. CSV rows can repeat
  after `--keep` or a crash, and there is no `--limit` flag.
- `--min-age-minutes` isn't validated; a non-number crashes the script.
- CSV formula injection: a client-written `stamp` or `endReason` starting with `=` becomes a
  formula when the CSV is opened in Excel or Sheets.
- GA sends `0` for a missing `duration_sec` or `score`, which pulls averages down.
- The spec describes run detection as a pure function; the code uses a stateful tracker.

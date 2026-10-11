# Live play telemetry — design

Date: 2026-10-10. Status: approved in conversation, awaiting written-spec review.

## Goal

The public Firebase build currently records nothing: Hosting is static, the game's `/telemetry` and
`/highscore` POSTs 404, and the game sets `telemOffline`. We want:

1. **How often people play** — page loads, users, sessions, runs started and finished.
2. **Play statistics** — real players' run logs, in the same `delve-run *.json` shape the helper
   writes, so the main game's feedback engine (which reads the per-event stream) can use them.
3. **Low cost** — stay on the free Spark plan (a hard $0 ceiling), store logs compressed, and be able
   to export them locally and delete them from the cloud.

Out of scope: local helper play (unchanged), the game file (unchanged), the HUD's TELEMETRY OFFLINE
tag (it describes the helper; left as is), a `setup_view` GA event (not requested; a one-line add
later), App Check (only if abuse is seen).

## Measured inputs and free-tier fit

From the 271 run logs in `../Puzzle-Punch/telemetry`:

| | Raw | Gzipped |
|---|---|---|
| Mean log | 389 KB | 32 KB |
| Median log | 160 KB | ~14 KB |
| Largest log | 2.4 MB | ~200 KB |
| Slim (verdict) file | 4–7 KB | — |

Spark plan, Firestore Standard (checked against firebase.google.com/pricing on 2026-10-10): 1 GiB
stored, 20K writes / 50K reads / 20K deletes per day, 1 MiB max document.

- Writes: ~2–3 per run → **~7,000–10,000 runs/day** before the write quota.
- Storage: 1 GiB / 32 KB → **~30,000 stored runs** before an export is needed.
- Export: 20K deletes/day → up to 20,000 runs cleared per export run.
- Over quota on Spark means writes fail until the daily reset; there is no bill.

These numbers come from the developer's own (long) runs; public runs are likely shorter, so real
capacity should be higher.

Rejected alternatives: summary-only in Firestore (cheaper but loses the event stream the feedback
engine uses); full logs in Cloud Storage (needs the Blaze plan, no hard cost cap, and the 5K
uploads/month free quota caps it at ~165 runs/day).

## Architecture

```
PUZZLE PUNCH.html (unchanged)          live/cloud-telemetry.js (new, deploy-only)
  window.DELVE: G, telem(), ──read──▶  1 s poll → run start / end / hidden
  telemetryJSON(),                            │
  telemetrySlimJSON()                         ├─▶ Google Analytics (page_view, run_start, run_end)
                                              └─▶ Firestore runs/{uid}_{stamp} (gzipped log)
                                                          │
                                   scripts/export-runs.mjs ◀┘  (admin, local)
                                              │
                                              ▼
                        telemetry-live/delve-run <stamp> live-<uid6>.json + runs-summary.csv
```

The game file is re-copied from the big repo and re-trimmed for every version, so no cloud code goes
in it. `scripts/deploy.sh` copies `live/*.js` into `public/` and adds the module to
`public/index.html` when building.

## Components

### 1. `live/firebase-config.js`

The web app's Firebase config (apiKey, projectId, appId, measurementId, …), exported as a module.
Committed: Firebase web config is public by design. Produced by `firebase apps:sdkconfig WEB <appId>`.

### 2. `live/cloud-telemetry.js` (browser module)

Loads the Firebase JS SDK (app, analytics, auth, firestore) from `www.gstatic.com/firebasejs/<version>/` (the current SDK
release at implementation time, pinned in the URL). Analytics and Auth+Firestore are set up independently, so one being blocked does not stop
the other.

**Startup**
- Analytics starts, which sends `page_view` automatically (default config).

(Amended: GA now comes from the Google tag (gtag.js), which `scripts/deploy.sh` puts at the top of
`<head>` with `game_version` in its config; it sends `page_view`. The module no longer loads the
Firebase Analytics SDK, which would have sent a second `page_view` for the same measurement ID; it
sends `run_start` / `run_end` through `window.gtag`. Deploys are labelled with the game version and
commit.)
- Anonymous sign-in (`signInAnonymously`) gives a stable per-browser `uid`.
- On `localhost` / `127.0.0.1` it connects to the Auth and Firestore emulators instead of production.

**Game contract**: the game's state lives inside its own closure, so the module reads what it exposes
on `window.DELVE`: `DELVE.G` (`.state`, `.bot`, `.stage`), `DELVE.telemetryJSON`,
`DELVE.debug.telemetrySlimJSON` and `DELVE.debug.telem()` (the run's log array). If any is missing at
startup, it `console.warn`s once and does nothing more. (Amended during implementation: the first
draft assumed `G`, `RUN_STAMP` and `telemetryJSON` were page globals; they are not.)

**Run detection**: a 1 s `setInterval` takes a snapshot `{ run: DELVE.debug.telem(), state: G.state,
skip }`. `startRun` makes a new log array for every run, so the array itself identifies the run;
`RUN_STAMP` is not exposed, and is read from the log header's `run` field when a document is written.
- *In a run* = the same test as the game's `inRunState()`: not `G.stage`, and `G.state` in
  `escort | hold | greed | escape | end`.
- *Skipped*: bot runs (`G.bot` truthy) and the dev studio's stage (`G.stage` truthy).
- *Run start*: in a run with a log array not seen before → GA `run_start { level, game }`, then write
  the `start` document.
- *Run end*: `G.state` becomes `'end'` for the current run (once per run) → GA `run_end { level,
  game, result, end_reason, duration_sec, score }`, then write the `full` (or `slim`) document.
- *Hidden*: `visibilitychange` to `hidden` while in a run that has not ended → write a `partial`
  document (best effort, at most once per run every 5 minutes). If the player returns, the
  end-of-run write replaces it.

The detection logic is a pure function `(prevSnapshot, snapshot) → events[]` so it can be unit
tested.

**Building the payload**
- Text = `telemetryJSON()`; gzip it with `CompressionStream('gzip')`.
- If the gzipped size is ≥ 900,000 bytes, use `telemetrySlimJSON()` instead (`kind: 'slim'`).
- Header fields are taken from `JSON.parse` of the slim JSON (small) so they match the file.

**Failure handling**: every Firebase call is wrapped in try/catch and logged with `console.warn`; no
errors reach the game. No retries beyond the Firestore SDK's own in-memory queue.

### 3. Firestore data model

Collection `runs`, document ID `<uid>_<stamp with characters outside [0-9A-Za-z-] replaced by '-'>`.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Must equal `request.auth.uid` |
| `stamp` | string | `RUN_STAMP` as is |
| `game` | string | `GAME_VERSION` |
| `level` | string | `LVL.id` |
| `result` | string | `in-progress`, `WIN` or `LOSS` |
| `endReason` | string or null | |
| `durationSec` | number | |
| `score` | number | |
| `kind` | string | `start`, `partial`, `full` or `slim` |
| `log` | bytes | Gzipped JSON text; absent on `start` |
| `rawBytes` | number | Byte length of the uncompressed UTF-8 text; absent on `start` |
| `createdAt` | timestamp | Server time, set on create |
| `updatedAt` | timestamp | Server time, every write |

The start write uses `setDoc`. Later writes use `setDoc(..., { merge: true })` so `createdAt` is kept.

### 4. `firestore.rules`

Players may create and update only their own `runs` documents and may never read or delete. Every
field is typed and size-capped (amended after the final review):

- The document ID must equal `docId(uid, stamp)`, and `stamp` is at most 64 characters.
- `game`, `level` and `result` are short strings, `endReason` is null or at most 200 characters, and
  `durationSec` and `score` are null or numbers.
- `kind` must agree with the log: `start` has no `log`; every other kind has `log` (bytes,
  < 950,000) and an integer `rawBytes`.
- `updatedAt` must be the server's request time.

The rules cannot limit how many runs one anonymous player writes. On Spark that cannot cost money:
over the daily write quota, recording stops until the next day. A script could still fill the 1 GiB
storage with well-formed junk; recording then stops until an export (with `--purge-invalid` for
anything unexportable) clears it. App Check is the next defence if that is ever seen.

### 5. `scripts/export-runs.mjs`

Node 22 + `firebase-admin` (new root `package.json`; `node_modules/` is already gitignored).
Authenticates with Application Default Credentials (`gcloud auth application-default login`).

```
node scripts/export-runs.mjs [--dry-run] [--keep] [--purge-invalid] [--out <dir>] [--min-age-minutes <n>]
```

For each `runs` document with `updatedAt` more than 1 hour ago, oldest first:

1. If it has a `log`: gunzip it, check the length equals `rawBytes`, and check it parses as JSON.
2. Write the text exactly as stored to `<out>/delve-run <stamp> live-<uid first 6>.json`, then re-read
   the file and compare it.
3. Append a row to `<out>/runs-summary.csv` (header written if the file is new): `exportedAt, uid6,
   stamp, game, level, result, endReason, durationSec, score, kind, rawBytes, file`. Start-only
   documents get a row with no file.
4. Only after steps 1–3 succeed (and unless `--keep`), delete the document, with a precondition
   that it is unchanged since it was read; a run updated meanwhile is kept for the next export. Any
   failure leaves the document in place and is listed at the end, unless `--purge-invalid` is given:
   then it is saved to `<out>/quarantine/<id>.json` and deleted. Logs are inflated with a byte limit
   (`rawBytes`, at most 64 MB), so a gzip bomb is refused rather than inflated.

`--dry-run` reads and reports only. The final report shows counts by `kind`, failures, total `log`
bytes exported, and the remaining stored `log` bytes compared with 1 GiB.

Suggested routine: run monthly, or whenever the console's Firestore usage passes about 800 MB.
`--out ../Puzzle-Punch/telemetry` puts runs where the big repo's helper and Dev Studio list them.

### 6. Deploy and config changes

- `scripts/deploy.sh`:
  - Copy `live/*.js` to `public/`.
  - Insert `<script type="module" src="cloud-telemetry.js"></script>` before `</body>`; fail unless
    `</body>` appears exactly once.
  - Deploy `--only hosting,firestore:rules`.
  - `--serve` runs `firebase emulators:start --only hosting,auth,firestore`.
- `firebase.json`: add `"firestore": { "rules": "firestore.rules" }` and an `emulators` block (auth,
  firestore, hosting ports). No hosting rewrites; the existing no-catch-all rule stays.
- `.gitignore`: add `telemetry-live/`.
- `README.md`: a short "Cloud telemetry" section covering setup, the export command and the quotas.

## One-time setup

| Step | Who / how |
|---|---|
| `brew install google-cloud-sdk openjdk` | Developer |
| `gcloud auth application-default login` | Developer (interactive) |
| `firebase apps:create WEB "Puzzle Punch Live"`, then `apps:sdkconfig` → `live/firebase-config.js` | CLI |
| Confirm the config has a `measurementId` (GA is linked to the project) | CLI / console |
| Enable Anonymous sign-in | Console: Authentication → Sign-in method |
| Create Firestore `(default)`, Standard edition, `nam5` | CLI or console |
| Optional: GA custom dimensions `result`, `level` | Console: GA Admin → Custom definitions |

## Testing

1. **Rules** (`@firebase/rules-unit-testing`, Firestore emulator):
   - Allowed: create and update your own document.
   - Denied: another player's ID, not signed in, extra field, unknown `kind`, `log` ≥ 950,000 bytes,
     wrong `updatedAt`, any read, any delete.
2. **Export** (emulator, seeded with full, slim, partial, start-only and one corrupt document):
   - Files and CSV rows are correct.
   - The corrupt document is reported and not deleted.
   - `--keep` deletes nothing; `--dry-run` writes nothing.
   - Documents updated within the last hour are skipped.
3. **Module unit tests** (Node 22 test runner):
   - Run-detection transitions: start, end, a new run after an end, bot and stage runs skipped, end
     reported once.
   - Gzip round trip; the full-or-slim choice at the 900,000-byte threshold.
   - Document-ID sanitizing.
4. **End to end** on `scripts/deploy.sh --serve` (emulators):
   - Start a run and drive it to its end through `DELVE.debug`.
   - The document appears as `start`, then `full`.
   - The export writes a file that matches `telemetryJSON()` for that run.
5. **After the first real deploy**: GA DebugView shows `page_view`, `run_start` and `run_end`, and one
   real run appears in Firestore and exports cleanly.

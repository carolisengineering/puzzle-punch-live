# PUZZLE PUNCH — LIVE

A smaller cut of Puzzle Punch: one level, no sampler material, no dev tooling.

## Where it came from
Copied from the full project (`Puzzle-Punch`, the big repo). Now at commit `a09adab`, game v0.86a,
md5 `ee849232ef0dddb832cf802e9c760cae` (first cut: `93fc3cd`, v0.85m). That repo keeps the full history, the samplers, the harness, the telemetry and
the design docs. This repo starts fresh and does not share git history with it.

Fixes made over there do not flow here on their own. The way to carry a new version across is to take
the whole game file again and re-run the trim (it stops if anything it expects has moved):

    git -C ../Puzzle-Punch fetch
    git -C ../Puzzle-Punch show origin/main:"PUZZLE PUNCH.html" > "PUZZLE PUNCH.html"
    # point FROM_MD5 in harness/live1_trim.mjs at the new file's md5
    node harness/live1_trim.mjs

To look at one change on its own instead, diff the two game files:

    git -C ../Puzzle-Punch show <sha>:"PUZZLE PUNCH.html" > /tmp/big.html
    diff /tmp/big.html "PUZZLE PUNCH.html"

## What is here
| File | What it is |
|---|---|
| `PUZZLE PUNCH.html` | The game. One self-contained file, no external assets. |
| `puzzle_punch_helper.ps1` | The local helper (PowerShell). Serves the game at http://localhost:8747/ and keeps records and run logs beside it. |
| `Launch Puzzle Punch.bat` | Windows launcher: starts the helper, opens the game. |
| `docs/` | Notes for this cut only. |
| `firebase.json` | Firebase Hosting config for the public build. |
| `scripts/deploy.sh` | Builds `public/` from the game file and deploys it. |
| `live/` | The cloud telemetry module, added to the deployed page only. |
| `firestore.rules` | Who may write run logs (players: their own; nobody reads). |
| `scripts/export-runs.mjs` | Pulls run logs down to `telemetry-live/` and clears them from Firestore. |

Not copied: the Dev Studio and Input Lab pages, `samplers/`, `harness/`, `telemetry/`, `art/`, `archive/`.

The helper writes `highscore.json`, `combat-studio.json` and `telemetry/` next to itself while you play.
They are gitignored here; it creates them fresh on first run.

## Play
Windows: double-click `Launch Puzzle Punch.bat`.
Mac: the helper needs PowerShell (`brew install powershell`), then
`pwsh -File puzzle_punch_helper.ps1` and open http://localhost:8747/. Opening the HTML file
directly also works; you just lose records and run logs.

## Deploy
Firebase Hosting serves the game as a static page. There is no helper up there, so local records and
run logs are off: the game sees the `/highscore` 404, sets `telemOffline` and says so on the HUD.
It plays in full otherwise. Run logs go to the cloud instead; see Cloud telemetry below.

    scripts/deploy.sh --serve    # preview on localhost:5002 against local emulators (needs Java)
    scripts/deploy.sh            # ship it (only from a clean tree at a commit already on origin/main)

The script copies the game file to `public/index.html` and deploys that, rebuilding `public/`
from scratch each time so a deploy cannot ship a stale copy. Each deploy is labelled with the game
version and commit (e.g. `PUZZLE PUNCH v0.85v @ fc43c27`), shown in the Firebase console under
Hosting → Release history. `public/` is generated; it is
gitignored and is not source. `firebase.json` deliberately has no catch-all rewrite — the
helper routes must 404 for the game's offline path to work, and a rewrite would answer them
with the page itself at `200`.

First time on a new machine: `npm ci`, then `npx firebase login`.

## Cloud telemetry
The deployed page also loads `live/cloud-telemetry.js`, which `scripts/deploy.sh` copies into
`public/` and adds to `public/index.html`. The game file is untouched. It:

- adds the Google tag (gtag.js) at the top of `<head>`, which sends GA a `page_view` on every load;
  the module sends `run_start` and `run_end` through it. Every event is tagged `game_version`, read
  from the game file at deploy time. Local previews send nothing to GA;
- saves each human run's log, gzipped, to Firestore `runs/{uid}_{stamp}` (anonymous sign-in).
  Logs over 900 KB gzipped are saved slim (header and summary only). `log` is exempt from indexing
  (`firestore.indexes.json`), which saves about 3 KB per run; the export needs only `updatedAt`'s index.

Players can write only their own runs and can never read; see `firestore.rules`.

Export runs to `telemetry-live/` (gitignored) and delete them from the cloud:

    node scripts/export-runs.mjs --dry-run   # count only
    node scripts/export-runs.mjs             # export, then delete
    node scripts/export-runs.mjs --keep      # export, keep the cloud copy
    node scripts/export-runs.mjs --purge-invalid   # also clear runs that cannot be exported
    node scripts/export-runs.mjs --out ../Puzzle-Punch/telemetry

Each run becomes `delve-run <stamp> live-<uid6>.json`, the same shape the helper writes, and a row in
`telemetry-live/runs-summary.csv`. First time on a machine, install gcloud and log in:

    brew install google-cloud-sdk
    gcloud auth application-default login
    gcloud auth application-default set-quota-project puzzle-punch

In the Firestore console, a run's `log` field is gzipped and shows as raw bytes. Export the run to
read it. See `docs/TELEMETRY — go-live steps.md` → Reading runs in the console.

The project stays on the free Spark plan: 1 GiB stored (~30,000 runs) and 20K writes/day (~7,000 runs/day).
Spark never bills. Going over the daily writes stops recording until the next day; a full 1 GiB stops
it until you export. The rules cap every field, but a determined script could still fill the storage
with junk runs: export them like any others, and `--purge-invalid` clears anything that cannot be
exported (saved under `telemetry-live/quarantine/` first). If that ever happens, turn on App Check.
Export monthly, or when the console's Firestore usage nears 800 MB.

Tests: `npm test` (unit) and `npm run test:emulator` (rules and export; needs `brew install openjdk`).

## Level
THE LIVING DEPTHS, alone. There is no antechamber: START on the setup screen descends straight
into the mine (the walk out of the mouth, as the dev menu's runs do it), and START on the end screen
returns to the setup screen. The game file after the trim: md5 `d104c1ea4b83b2f31324102e8ddadb6a`.

The other levels' code (castle, forest, desert, glacier, rainbow road, manor) is still in the file,
unreachable. Pruning it is a later pass. The trim itself is `harness/live1_trim.mjs`; it runs
against the version named in its `FROM_MD5` (now v0.86a) and stops if anything it expects is missing.

## Notes
`docs/` holds this cut's build notes. The design docs, rulings and samplers stay in the big repo.

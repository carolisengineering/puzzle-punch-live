# PUZZLE PUNCH — LIVE

A smaller cut of Puzzle Punch: one level, no sampler material, no dev tooling.

## Where it came from
Copied from the full project (`Puzzle-Punch`, the big repo). Now at commit `70e129f`, game v0.85o,
md5 `c8beff8206ae9b044c7be17598178fc0` (first cut: `93fc3cd`, v0.85m). That repo keeps the full history, the samplers, the harness, the telemetry and
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

Not copied: the Dev Studio and Input Lab pages, `samplers/`, `harness/`, `telemetry/`, `art/`, `archive/`.

The helper writes `highscore.json`, `combat-studio.json` and `telemetry/` next to itself while you play.
They are gitignored here; it creates them fresh on first run.

## Play
Windows: double-click `Launch Puzzle Punch.bat`.
Mac: the helper needs PowerShell (`brew install powershell`), then
`pwsh -File puzzle_punch_helper.ps1` and open http://localhost:8747/. Opening the HTML file
directly also works; you just lose records and run logs.

## Deploy
Firebase Hosting serves the game as a static page. There is no helper up there, so records and
run logs are off: the game sees the `/highscore` 404, sets `telemOffline` and says so on the HUD.
It plays in full otherwise.

    scripts/deploy.sh --serve    # preview on localhost first
    scripts/deploy.sh            # ship it

The script copies the game file to `public/index.html` and deploys that, rebuilding `public/`
from scratch each time so a deploy cannot ship a stale copy. `public/` is generated; it is
gitignored and is not source. `firebase.json` deliberately has no catch-all rewrite — the
helper routes must 404 for the game's offline path to work, and a rewrite would answer them
with the page itself at `200`.

First time on a new machine: `npx -y firebase-tools login`.

## Level
THE LIVING DEPTHS, alone. There is no antechamber: START on the setup screen descends straight
into the mine (the walk out of the mouth, as the dev menu's runs do it), and START on the end screen
returns to the setup screen. The game file after the trim: md5 `a3da67721e2d9241ebce6605d895b2a7`.

The other levels' code (castle, forest, desert, glacier, rainbow road, manor) is still in the file,
unreachable. Pruning it is a later pass. The trim itself is `harness/live1_trim.mjs`; it runs
against the version named in its `FROM_MD5` (now v0.85o) and stops if anything it expects is missing.

## Notes
`docs/` holds this cut's build notes. The design docs, rulings and samplers stay in the big repo.

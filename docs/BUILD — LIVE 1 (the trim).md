# BUILD — LIVE 1: THE TRIM (2026-10-07)

From: Puzzle-Punch @ 93fc3cd, `PUZZLE PUNCH.html` v0.85m, md5 77e86a3e01f4a1ea4c738cc63da54707.
To: md5 326b3355bc2a04076e949edfec141af0. Script: `harness/live1_trim.mjs`.

## What changed
1. `LEVELS` holds the depths alone; `COMING` (the sealed doors) is empty. The other six levels' code stays in the file, unreachable.
2. `liveDescend()` (beside `startHub`): `startRun(0)`, then the depths' walk out of the mouth (`walkStart84d`). The setup screen's START and its CONFIRM call it in place of `startHub()`. The hub is never built or shown.
3. The end screen's START goes to the setup screen (it went to the hub).

Not changed: the pause menu's LEAVE THE HALL still calls `startHub()`; the practice hall was only reachable from the hub, so that menu item never shows. The descent card (LEVEL 1 · THE LIVING DEPTHS under the heartbeat) was part of the hub's door and is not shown; it can be put back on the setup screen if wanted.

## Checked (headless Chromium, 2026-10-07)
- Loads with no script errors; `LEVELS` is `['depths']`.
- Both seats on the keyboard, ENTER on the setup screen: state `escort`, level `depths`, the couple at the mouth after the walk-in.
- A run ends, the end beats play, ENTER: state `setup`. ENTER again: a new run in the depths.
- A computer run (seed 12345, speed 4) played 147 game seconds with no errors.
- Opened from disk the game logs one expected console error (the helper is not there); with the helper it is silent.

# BUILD — LIVE 2: v0.85o CARRIED OVER (2026-10-08)

From: Puzzle-Punch @ 70e129f (`origin/main`), `PUZZLE PUNCH.html` v0.85o, md5 c8beff8206ae9b044c7be17598178fc0.
To: md5 a3da67721e2d9241ebce6605d895b2a7. Script: `harness/live1_trim.mjs` (unchanged but for `FROM_MD5`).

The whole game file was taken over fresh and the LIVE 1 trim run on it again — nothing was patched by hand.
No other file in this repo needed carrying: between 93fc3cd and 70e129f the big repo changed only
`PUZZLE PUNCH.html` among the files this cut holds (the helper, the launcher and the ignore files are
untouched; everything else over there is samplers, harness and docs, which this cut does not take).

## What came with it
Two builds, both of them depths work (the big repo's `docs/builds/BUILD — v0.85n.md` and `— v0.85o.md`):
- **v0.85n, the balance pass.** Her chain and the keg resized; the stagger off the couple's basic and
  charged attacks; SLOW DRIP is a drip with a spill; SENTRY's reach 300 and STORM's hops 0.5; the
  ore-back walls out of the escape's enemy budget; new telemetry; the end screen's tally rolls up row
  by row and skippable; the keg's blast is more cloud, not a bigger cloud.
- **v0.85o, the chamber floods on every way home.** Every hall-or-plain room of 20+ cells on the depths
  is an escape post (was: the generator's start-to-ore route only, so a couple running home the other
  way round the ring passed none), and a post fires from inside its room rather than within 430 px of
  its centre.

## The trim, re-applied
All eight of the trim's anchors still matched exactly once in v0.85o, and the edit it makes is
character-for-character what it made on v0.85m (checked by diffing the two trims' diffs; only the line
numbers moved). So the cut is the same as LIVE 1's:
1. `LEVELS` holds the depths alone; `COMING` is empty.
2. `liveDescend()` in place of `startHub()` on the setup screen's START and CONFIRM.
3. The end screen's START goes back to the setup screen.

## Checked (headless Chrome for Testing, 2026-10-08, this Mac)
- The file's one inline script parses (`node --check`).
- Served over http: boots to `setup`, no page errors.
- Both keyboard halves seated, ENTER: state `escort`, level `depths`, the couple at the mouth after the
  walk-in (`v_descend.png` in the scratch run, not kept).
- A run ended on the end screen, ENTER: state `setup`. ENTER again: a new run in the depths.
- A computer run (seed 12345, speed 4) played 147.4 game seconds with no page errors.
- Opened over http the game logs `TELEMETRY OFFLINE` on the HUD (no helper running); from disk it logs
  the one expected CORS error for `/highscore`, as before.

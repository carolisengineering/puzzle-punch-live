# HANDOFF — after LIVE 1 (2026-10-07), updated after LIVE 2 (2026-10-08)

## Where things stand
- This repo is the one-level cut of Puzzle Punch: THE LIVING DEPTHS, no hub, no samplers, no dev tooling. Now from `Puzzle-Punch @ 70e129f` (game **v0.85o**), trimmed by `harness/live1_trim.mjs`. Details: `docs/BUILD — LIVE 2 (v0.85o carried over).md`; the first cut (v0.85m) is `docs/BUILD — LIVE 1 (the trim).md`.
- Game file after the trim: md5 `a3da67721e2d9241ebce6605d895b2a7`. Confirm before patching.
- v0.85o brought the balance pass (v0.85n) and the escape-post fix (v0.85o) — both depths work, so both land in this cut. He has not played either here.
- Carrying the next version across: take the whole file again and re-run the trim (README, "Where it came from"). All eight anchors held from v0.85m to v0.85o; if one ever stops matching, the script writes nothing and says which.
- Everything is staged; the initial commit has still not been made, and it would now hold v0.85o, not v0.85m. Suggested name: `LIVE: the trim, from v0.85o`. No remote yet.
- Verified headless after each cut (Chrome for Testing via playwright-core in a scratch folder, not kept): boot, START descends, end screen returns to setup and back into a run, a ~147 s computer run, no page errors.

## Open
- The descent card (LEVEL 1 · THE LIVING DEPTHS under the heartbeat) belonged to the hub's door and no longer shows. Put it back on the setup screen? (ASK)
- Prune the dead code of the other six levels (castle, forest, desert, glacier, rainbow road, manor). Their globals and generators are still in the file. A later pass; do it in small steps with the md5 check and a headless run after each.
- The pause menu's LEAVE THE HALL still calls `startHub()`; it never shows because the practice hall was only reachable from the hub. Harmless; remove with the prune.
- Playing on this Mac: the helper is PowerShell and `pwsh` is not installed (`brew install powershell`). Without it the game runs from the file but keeps no records or run logs.

## Carrying fixes from the big repo
    git -C ../Puzzle-Punch show <sha>:"PUZZLE PUNCH.html" > /tmp/big.html
    diff /tmp/big.html "PUZZLE PUNCH.html"
Fixes do not flow on their own; patch by hand.

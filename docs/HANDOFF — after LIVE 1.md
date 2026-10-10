# HANDOFF — after LIVE 1 (2026-10-07), updated after LIVE 2 (2026-10-08) and LIVE 3 (2026-10-10)

## Where things stand
- This repo is the one-level cut of Puzzle Punch: THE LIVING DEPTHS, no hub, no samplers, no dev tooling. Now from `Puzzle-Punch @ c155c19` (game **v0.85q**), trimmed by `harness/live1_trim.mjs`. Details: `docs/BUILD — LIVE 3 (v0.85q carried over).md`; before it, `— LIVE 2 (v0.85o carried over).md`, and the first cut (v0.85m) is `— LIVE 1 (the trim).md`.
- Game file after the trim: md5 `17361ee8e516fb5157bcdcfc96c735f3`. Confirm before patching.
- v0.85q brought the hub fix (reached here through `startRun`), the roost's slower shapes, the log's ore-back split, and two stagger cards (the pool is 47) — all of it live in a depths run. v0.85p's dev-menu forest sampler row and v0.85q's Sister Blades came with the file but are not reachable in this cut (no `samplers/`, no rack, no studio page). He has not played any of it here.
- Carrying the next version across: take the whole file again and re-run the trim (README, "Where it came from"). All eight anchors have held from v0.85m through v0.85q; if one ever stops matching, the script writes nothing and says which. v0.85q's hub fix landed inside `startHub`'s body, which the trim patches around without collision — worth re-checking whenever a change touches the hub.
- Committed through `eb76274` (`add firebase deploy`); the v0.85q carry-over is in the working tree, uncommitted. No remote yet. The deployed page is still v0.85o — `scripts/deploy.sh` has not been run for v0.85q.
- Verified headless after each cut (Chrome for Testing, not kept): boot, START descends, end screen returns to setup and back into a run, no page errors. LIVE 3 used the big repo's `harness/pwlite.mjs` over Playwright's Chromium (10 of 10 PASS, 8 s of play rather than a full run).

## Open
- The descent card (LEVEL 1 · THE LIVING DEPTHS under the heartbeat) belonged to the hub's door and no longer shows. Put it back on the setup screen? (ASK)
- Prune the dead code of the other six levels (castle, forest, desert, glacier, rainbow road, manor). Their globals and generators are still in the file. A later pass; do it in small steps with the md5 check and a headless run after each.
- The pause menu's LEAVE THE HALL still calls `startHub()`; it never shows because the practice hall was only reachable from the hub. Harmless; remove with the prune.
- The dev menu's FOREST SAMPLER row (v0.85p) leads nowhere here: it asks the helper first, so it answers `NEEDS THE LAUNCHER` / `RESTART THE LAUNCHER` instead of opening a dead page. Remove with the prune.
- Playing on this Mac: the helper is PowerShell and `pwsh` is not installed (`brew install powershell`). Without it the game runs from the file but keeps no records or run logs.

## Carrying fixes from the big repo
    git -C ../Puzzle-Punch show <sha>:"PUZZLE PUNCH.html" > /tmp/big.html
    diff /tmp/big.html "PUZZLE PUNCH.html"
Fixes do not flow on their own; patch by hand.

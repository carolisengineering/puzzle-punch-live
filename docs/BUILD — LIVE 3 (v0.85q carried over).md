# BUILD — LIVE 3: v0.85q CARRIED OVER (2026-10-10)

From: Puzzle-Punch @ c155c19, `PUZZLE PUNCH.html` v0.85q, md5 076d5af2467aa1f483213866f57e2b90.
To: md5 17361ee8e516fb5157bcdcfc96c735f3. Script: `harness/live1_trim.mjs` (unchanged but for `FROM_MD5`).

The whole game file was taken over fresh and the LIVE 1 trim run on it again — nothing was patched by hand.
Two versions came over at once (v0.85p and v0.85q); v0.85o was the last cut.

Of the files this cut holds, the big repo changed two between 70e129f and c155c19: the game file, carried
over, and `puzzle_punch_helper.ps1`, **not carried**. The helper's only change is v13's sampler routes
(`/sampler/forest`, `/sampler/forest/which`), which serve a file out of `samplers/` — and this cut has no
`samplers/`. So the helper here stays v12. Everything else over there is samplers, harness, art and docs,
which this cut does not take.

## What came with it
- **v0.85p, the forest sampler in the dev menu.** The dev menu (F9, or a pad's SELECT, on the main menu)
  gained a FOREST SAMPLER row. Nothing outside the dev menu changed; a run plays exactly as v0.85o's.
  In this cut that row cannot work — see the limits below.
- **v0.85q, the hub fix, the roost's time, the log's rocks, two stagger cards, and the Sister Blades**
  (the big repo's `docs/builds/BUILD — v0.85q.md`):
  - **The hub fix.** Her chain state (`P2.ch85m`, `P2.spinT`) is reset in `startHub`, `startRun` and
    `startPractice`. v0.85p threw `IndexSizeError` at `drawHer85m` after a run with a pirouette and a
    finisher. It lands here through `startRun`, which is what `liveDescend()` calls.
  - **THE ROOST: the same shapes, more time.** The Wheel's 12 dives 0.6 s apart; the Comb forms at +16,
    the Pincer at +30. Four dials on the studio's SHARED tab. Depths work, so it matters here.
  - **The log tells the ore-back walls from the roaming ore-backs.** `rock: 'wall' | 'vein' | 'roam'` on
    the damage, strike and kill rows, plus the summary's split. Depths work. Note the records and run logs
    are off on the deployed page (no helper up there); the rows are there when you play through the helper.
  - **FLINCH and STAGGERING BLOWS.** Two new cards (common and epic, both players). The pool is 47
    (11 epic / 10 rare / 26 common). They deal in a depths run, so they are live in this cut.
  - **THE SISTER BLADES.** A third armory weapon (`blades`). The rack that chooses a weapon is in the
    antechamber, which this cut does not have, so a normal run here still starts with the sword and the
    staff (checked: `bladesWanted85q()` is false in a live run). The blades' code, art and 41 dials are in the file, reachable only through the studio — which
    this cut also does not ship a page for. Carried for completeness, not reachable in play.

## The trim, re-applied
All of the trim's anchors still matched exactly once in v0.85q (the script writes nothing otherwise),
and the trimmed file differs from the big repo's v0.85q in exactly six places — the trim's own edits and
nothing else (`diff` hunk count). v0.85q's hub fix touches `startHub`, which the trim also patches around;
the two do not collide (the fix is inside the function body, the trim's anchor is its opening line, and
`liveDescend()` reaches the same reset through `startRun`). So the cut is the same as LIVE 1's and LIVE 2's:
1. `LEVELS` holds the depths alone; `COMING` is empty.
2. `liveDescend()` in place of `startHub()` on the setup screen's START and CONFIRM.
3. The end screen's START goes back to the setup screen.

## Checked (headless Chrome for Testing through `harness/pwlite.mjs` from the big repo, 2026-10-10, this Mac)
A scratch script served the trimmed file over http with the helper routes 404ing, as the deployed page is
(not kept; it drove START through `PInput.latched`, the harness's own press path). 10 of 10 PASS:
- The file's one inline script parses (`node --check`).
- Boots to `setup`, no page errors, no console errors.
- `LEVELS` is `['depths']` alone; `COMING` is empty.
- Both halves seated, one frame of START: state `escort`, level `depths` — the descent, no hub.
- 8 s of play from there: no page errors (enemies alive, the clock running).
- `endRun` then the open end screen, START: state `setup`.
- The `/highscore` 404 set `telemOffline`, so the HUD says so — the deployed page's path.
- In that run: `LOADOUT` is `{p1main: 'sword', p1thrown: 'daggers', p2main: 'pick'}`, `W1.id` is `sword` and
  `bladesWanted85q()` is false — the blades stay out of a run here, as expected with no rack. `REWARD_POOL`
  is 47, so v0.85q's two cards are dealable.
- The version line reads `PUZZLE PUNCH v0.85q`.

NOT run: a full computer-played run (the big repo's own v0.85q checks cover the game; his ruling there was
to stop making full bot runs a build gate). Not seen by eye in a browser. The PowerShell helper was not
run (no PowerShell on this Mac). Not deployed — `scripts/deploy.sh` has not been run for this version.

## Known limits
- **The dev menu's FOREST SAMPLER row cannot work in this cut.** It asks `/sampler/forest/which` first, so
  it answers rather than opening a dead page: opened from the folder, `NEEDS THE LAUNCHER`; through this
  cut's v12 helper, `RESTART THE LAUNCHER (its helper is older)`; on the deployed page, the 404 reads as no
  sampler. Harmless, but it is a dev-menu row that leads nowhere here. Pruning it belongs with the later
  pass that prunes the other levels' code.
- The Sister Blades are unreachable in play here (no rack, no studio page), as above.
- The other levels' code (castle, forest, desert, glacier, rainbow road, manor) is still in the file,
  unreachable, as before.

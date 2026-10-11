# Suggested next steps

As of 2026-10-11. Start with item 1. It's small and closes a safety gap in the export. Most of
these ideas come from the "Known small issues (deferred)" list at the end of
`docs/TELEMETRY — go-live steps.md`.

## Worth doing soon

1. **Stop CSV formula injection.** Players write `stamp` and `endReason` themselves. If one starts
   with `=`, `+`, `-` or `@`, Excel or Sheets runs it as a formula when you open `runs-summary.csv`.
   The export script should put a `'` in front of those cells.
2. **Make the export script sturdier.**
   - Check that `--min-age-minutes` is a number. Right now a non-number crashes it.
   - Add a `--limit` flag.
   - When a daily quota is hit, print a clean summary instead of a stack trace.
   - Stop duplicate CSV rows after a `--keep` export or a crash.

## Better data

3. **Stop GA from counting missing values as 0.** A missing `duration_sec` or `score` is sent as
   `0`, which pulls averages down in GA reports. Leave the parameter out when there's no value.
4. **Write a local summary script.** Point it at `telemetry-live/` and it prints win rate by level,
   typical run length, and where players quit (`endReason`). That gives quick answers without
   opening each JSON file.

## Safety nets

5. **Run the tests on every push with GitHub Actions.** The repo has no CI yet. One workflow could
   run `npm test` and `npm run test:emulator` on every push and PR. That protects
   `firestore.rules` and the export script for little cost.
6. **Turn on App Check, but only if junk runs appear.** The runbook already names it as the
   fallback. Until then, `--purge-invalid` handles bad data.

## Done

- **Exempt `runs.log` from Firestore indexing** (2026-10-11). See
  `docs/superpowers/specs/2026-10-11-firestore-log-index-exemption-design.md`.

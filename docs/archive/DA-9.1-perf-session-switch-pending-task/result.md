# DA-9.1 · Result

**Closed 2026-09-05.** Completed at DA-9 acceptance: the "Switching review sessions" budget line in `perf/budgets.ts` now says `pendingUntil: "DA-24"` — the header task owns the sessions menu and the measurement, DA-9 has no page to switch sessions on.

**Verification.** `grep -n 'pendingUntil: "DA-24"' perf/budgets.ts` finds the line; `bun run perf` prints `| pending | DA-24 |` for that row.

**Documentation in the same pass.** Not required; `docs/reference/11-perf.md` does not name the task per row.

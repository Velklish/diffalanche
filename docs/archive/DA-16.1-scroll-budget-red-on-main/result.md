# DA-16.1 · Result

**Closed 2026-09-05.** Not a regression: the reading the finding left open — the page of DA-19–21 costing more than the Phase 0 page, or the machine — is settled for the machine. On a quiet machine at the end of the Phase 1 run, with the whole UI on `main` (composer, threads, header, live update, keyboard map, empty states — everything the finding's page did not yet carry), the scrolling line reads **7.3 / 7.0 / 6.9 ms per frame, median 7.0 against 8.3, zero long tasks in every run**; three single-run processes earlier the same hour, before the gate's shape changed, read 7.6, 7.8 and 7.3. The finding's 9.1–9.5 with one to three long tasks were taken with several agent sessions running gates on the same machine (load average 15–80 through the day), and the ui-c worker's quiet pass on its branch read 8.2–8.4 with zero long tasks, which already put the margin at a tenth of a millisecond. Nothing in the UI changed to bring the number down; the page never cost what the busy machine reported. What stands from the finding: the number on a GitHub runner is still unknown (DA-5.1, deferred), and a gate on a shared machine only means something alone.

**Verification.** `bun run perf` on `main` at the end of the run, machine quiet: the table above, exit 0.

**Documentation in the same pass.** Not required; the perf gate's own change is DA-25.2's.

# DA-25.4 · Result

**Closed 2026-09-05.** Completed. `e2e/live.spec.ts` waits, after putting the fixture file back, until the edited card no longer shows the appended line — the page has taken the restore's `diff-changed` — so the frame cannot land in the next spec's page. The shell screenshot test and its baselines are untouched: the failure was residue from the spec before it, not the shell.

**Verification.** The failing shape: `bun run test:ui` in file order on a quiet machine, "the empty shell in the dark theme" receiving a 17 943 px page where a 900 px one was expected, once in a full run and never in three isolated runs. After the change, `bun run test:ui` green in file order (58).

**Documentation in the same pass.** Not required; the wait carries its reason in a comment.

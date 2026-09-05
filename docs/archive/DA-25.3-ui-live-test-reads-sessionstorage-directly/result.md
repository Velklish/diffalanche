# DA-25.3 · Result

**Closed 2026-09-05.** Completed, on the ui-c branch in `9f1c3d8`. `tests/ui-live.test.ts` read the global `sessionStorage` directly in one assertion; Node has that global, Bun's runtime does not, so `bun run test:bun` — a gate of `backslop.json` — was red on a tree the worker had reported green after running `bun run test` only. `readDismissed` is exported from `src/ui/store.ts` with the two-runtime reason on it, and the test reads the persisted dismiss through it, so what is asserted is what a page opened now would find, through the code such a page uses.

**Verification.** `bun run test` and `bun run test:bun` both green on the ui-c branch and on `main` after integration (401 tests each). The finding was filed by the e2e worker from its own gate run, which is the check that caught it.

**Documentation in the same pass.** Not required; the lesson — a worker's gate list is `backslop.json`'s, not `bun run test` alone — is in the result of DA-25.

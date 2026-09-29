# DA-56.6 · Result

**Closed 2026-09-29.** Completed on cause and fix. The card's own Verification is not met here: it asks for `bun run perf` inside 300 ms on a quiet development machine. That check has moved to DA-56.9 (major), deferred to a session on that machine.

**Cause.** Since DA-55, switching tasks in the sessions menu goes through `showTask(name)`. That puts `?review=<name>` in the address. So a reader who switches away and back ends up on `?review=<current>`, and so does the perf harness, which does exactly that before `measureUpdate`. From then on every `diff-changed` fetch was `GET /api/repos/:repo/diff?review=<name>`. `ReviewService.repository(repo, session)` answered every named session from `freshRepository`: a `readReview` and four git processes at `1079222`, five at the tip. It did so even though the watcher had just rescanned that session and patched the held document before it emitted the event. DA-55.2 had checked only `repository(repo, undefined)`, and the update line had stopped taking that path.

**Fix.** In `src/server/review.ts`, git is read only when `session !== watched()`, that is, for a task other than the one the watcher rescans. A name equal to `watched()` is answered from the held, rescanned document, as a request with no name already was.

**Verification.** All measurements were taken on the 4-core cloud container, not the M1 Pro. The `ABBA` runs use nine a side unless noted:

| Comparison | Update line | Resolution | Load |
|---|---|---|---|
| `4be4936` → `1079222` (the step) | 255 → 336 ms, +81 | ±78, no overlap | 1.4–2.2 |
| `1079222` → `1079222` + the condition | 337 → 260 ms, −77 | ±75 | 0.6–2.1 |
| `4be4936` → `1079222` + the condition | +20 | ±37, no difference | 1.9–2.2 |
| tip → tip + fix, `bun perf/compare.ts`, run 1 | −52 | ±44 | 1.8–3.2 |
| tip → tip + fix, `bun perf/compare.ts`, run 2 | −25 | ±34, no difference | 2.0–2.8 |
| tip → tip + fix, `bun perf/compare.ts`, run 3 (13 a side) | −43 | ±34 | 0.7–3.1 |

- **Share of the step.** The condition accounts for 77 of the 81 ms. The fixed tip may still stand above DA-53 (+25 and +59 against `4be4936`, 151 commits apart). That residual is DA-56.11, a hypothesis.
- **Tests.** `tests/server.test.ts` has two new tests, one on each side of the condition: "answers a window named on the session the watcher rescans from the rescan, not from git", and a named task the watcher does not rescan still reads git. File result: 58 of 58.
- **Mutation probes.** Each side's test turns red when its half of the condition is undone: `if (session !== undefined)` on one side, the held document always used on the other.
- **Gates on the worker's tree.** Gates 8, green 5:
  - `test` and `test:bun`: the eleven embedding reds.
  - `perf`: over budget on this container's base. Its update line read 300 ms, ok.
  - `lint`, `typecheck`, `check:comments`, `test:ui` and backslop lint: green.
- **Review.** One isolated reviewer: no code regression.
  - The major finding was this acceptance gap, now carried by DA-56.9.
  - The minor findings, all fixed: "followed" reworded to "the session the watcher rescans (`watched()`)"; the untested other side of the condition; the `review.json` caveat in 07-server; DA-56.11's numbers.
  - The LRU-trim hypothesis is inherited from the unnamed path, so it is not new.
  - The pre-existing gap it pointed at is filed as DA-56.12, a hypothesis: a path-level scope edit outside current reaches no window.
  - DA-56.10 (minor) is filed: a `compare.ts` repetition hung 18 minutes with no timeout.

**Documentation in the same pass.** `docs/reference/07-server.md`, "The task a request is about"; `docs/reference/11-perf.md`, "What inside DA-55 carries it"; `CHANGELOG.md`, Fixed.

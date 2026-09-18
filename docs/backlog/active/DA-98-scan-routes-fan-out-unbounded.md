# DA-98 · The scan and candidate routes fan out one unbounded Promise.all of git processes over every repository

- **Scope:** 07-server, 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

Three call sites read every repository under the root through one `Promise.all` with no cap on how many git processes are in flight at once.

[src/server/review.ts](../../../src/server/review.ts), lines 294-296:

```ts
  const base = await sessionBase(config);
  const repositories = await Promise.all(
    found.repositories.map(async (repository) => {
```

[src/server/review.ts](../../../src/server/review.ts), lines 325-329, does the same for `candidatesOf`, and [src/core/change-set.ts](../../../src/core/change-set.ts), lines 165-172, for `scanReview`. Each element of those arrays is a `readRepositoryChange` ([src/core/git/index.ts:93](../../../src/core/git/index.ts)), which is at least four git processes — `currentBranch` and `resolveBase` in one `Promise.all`, then `diff` and `untrackedFiles` in another — and more in `branch` mode, where the base resolution walks `defaultRemote`, `remoteDefaultBranch` and `mergeBase`. [02-git.md](../../reference/02-git.md) states the per-repository cost itself: "Reading one is four git processes". So the number of concurrent spawns is four times the number of repositories under the root, decided by the folder rather than by the code.

The codebase already knows the shape of the fix and applies it elsewhere: `listBranches` in [src/server/routes/branches.ts](../../../src/server/routes/branches.ts), lines 60-72, walks the same repository list in a deliberate sequential `for` loop. `grep -rn "concurren\|p-limit\|CONCURRENCY" src/ perf/ docs/` finds nothing that bounds these three.

At the scale the product is documented for the cost is linear and small, and that narrowing is the accurate statement: [docs/SPEC.md:117](../../SPEC.md) measures on 21 repositories, and [11-perf.md](../../reference/11-perf.md) reports the same fixture. Reproduced on this machine (Apple silicon, `ulimit -u` 2666), `execFile("git", ["--version"])` in one `Promise.all`:

```
1 19 ms
50 221 ms
200 913 ms
400 1672 ms
800 3290 ms
```

No collapse and no EMFILE — about 4 ms per spawn all the way up. What this entry is about is therefore unbounded-concurrency debt, not a demonstrated failure at the documented scale; the "minutes of wall clock on hundreds of repositories" reading is extrapolation and is written here as a hypothesis.

One consequence is real at any scale. `diff` and `untrackedFiles` go through `git()` ([src/core/git/run.ts:24](../../../src/core/git/run.ts)), which rejects rather than through `gitOrNull`, so a single failing spawn rejects the whole `Promise.all` and the route answers 500 for the entire root. On the first-run screen that is invisible: `loadScan` ([src/ui/store.ts:1195](../../../src/ui/store.ts)) drops a non-ok response with a bare `if (!response.ok) return;`, and the effect in [src/ui/components/FirstRun.tsx](../../../src/ui/components/FirstRun.tsx), lines 26-28, is keyed on `[scan, loadScan]`, neither of which changed — so the three metrics stay dashes with no error and no retry.

Nothing in CI covers it: `BUDGETS` in [perf/budgets.ts](../../../perf/budgets.ts) has no line for `GET /api/scan` or for the candidates route.

## Work to do

- Decide the bound before writing it, and record the decision where the reader of the route will find it. The candidates are a fixed small pool (the shape `listBranches` already uses, at width 1), a pool sized from the host (`availableParallelism`), or a configured value on `Config` — and the choice is between a predictable ceiling and a machine-dependent one.
- Put the chosen bound in one place that all three call sites use, rather than three copies: `summarise` and `candidatesOf` in [src/server/review.ts](../../../src/server/review.ts) and `scanReview` in [src/core/change-set.ts](../../../src/core/change-set.ts) all map over a repository list and await `readRepositoryChange`.
- Decide separately whether one repository's failure should still reject the whole response. If the answer is no, that is the taxonomy work in [DA-66](../../archive/DA-66-git-errors-have-no-taxonomy/task.md) and belongs there; if the answer is yes for now, say so in [07-server.md](../../reference/07-server.md) so the 500 is documented behaviour rather than an accident of `git()` throwing.
- Make the first-run screen show that the scan failed. `loadScan` currently cannot distinguish "not asked yet" from "asked and refused", and the dash is the truth only in the first case.
- Update [02-git.md](../../reference/02-git.md) and [07-server.md](../../reference/07-server.md) with the concurrency ceiling, next to the existing "four git processes" sentence, so the next caller that maps over repositories knows what it is joining.

## Out of scope

- The error taxonomy of the git layer — `git()` versus `gitOrNull()`, and what a spawn failure means — which is [DA-66](../../archive/DA-66-git-errors-have-no-taxonomy/task.md).
- Caching the scan, or making it incremental. This entry bounds what the route spawns; it does not change the decision in [07-server.md](../../reference/07-server.md) that the scan reads git per request.
- Whether the perf gate should grow a line for the scan routes at all: what the gate measures and what it silently passes is [DA-69](../queue/DA-69-perf-gate-reports-green-unmeasured.md).

## Verification

- A test drives `summarise`, `candidatesOf` and `scanReview` over a fixture with more repositories than the bound and asserts the peak number of concurrent git processes, not the elapsed time — `tests/scope-scan.test.ts` already counts processes rather than seconds and is the pattern to follow.
- Raising the fixture's repository count without raising the bound leaves that assertion green; removing the cap from any one of the three call sites turns it red.
- A test asserts that a `GET /api/scan` refusal reaches the first-run screen as something other than three dashes.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`.

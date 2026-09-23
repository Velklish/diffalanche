# DA-60 · Remove the structural causes of flakiness from the suites

- **Order:** 250
- **Scope:** 11-perf, 05-watcher, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

[DA-31.1](../DA-31.1-unit-suite-flaky-under-load/task.md) closed by
fixing `tests/events.test.ts`. It named a second suspect and did not reach it,
and that one is still there. An audit sweep over `tests/`, `e2e/`, `perf/` and
`scripts/` found it plus six more, all structural — none of them needs a
reproduction to be believed, because each is visible in the assertion itself.

The suite is green on a quiet machine. Measured on this tree
(`a8d673b`), with the audit's own agents loading the box:

```
bun run test       ×3   exit 0, 0, 0      464 tests / 35 files, 21.9 s, 21.8 s, 23.8 s
bun run test:bun   ×2   exit 0, 0         464 tests / 35 files, 22.5 s, 21.5 s
```

Green five times is not evidence of stability — it is evidence that the numbers
these tests assert have headroom *today*. The numbers they print move a long way
between those same runs:

| Printed by | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `edit to diff-changed` | 369 ms | 440 ms | 475 ms |
| `update after an edit` | 344.2 ms | 304.7 ms | 330.5 ms |
| `check-ignore over 50 paths` | 23.7 ms | 36.1 ms | 28.5 ms |

The suites hold 29 fixed waits (`grep -rn "setTimeout(done\|setTimeout(resolve\|waitForTimeout\|sleep(" tests/ e2e/ perf/ | wc -l`).

### What the sweep found

**1. The watcher budget calibrates itself after the window it compensates for.**
[tests/watcher.test.ts:334](../../../tests/watcher.test.ts) asserts
`median(elapsed) < BUDGET_MS + (await baseline())`. `elapsed` is filled by three
timed edits at lines 290–300; `baseline()` runs only at line 334 — after those
edits and after a read-back poll that may take up to 20 s. The comment above it
(lines 322–329) states the intent, "the budget on top of one rescan timed in the
same conditions", and the code times the rescan afterwards instead. A load spike
covering the edits but not the baseline fails the test on an unchanged tree; the
reverse skew widens the ceiling silently. This is the line DA-31.1 wrote down as
its lead suspect.

**2. The smoke script's busy-port retry can never fire.**
[scripts/smoke.sh:288](../../../scripts/smoke.sh) decides "port taken, try the
next one" by matching `EADDRINUSE|address already in use|Is port [0-9]+ in use`
against `serve`'s stderr. But
[src/server/serve.ts:139](../../../src/server/serve.ts) replaces the original
error with `port <n> is already in use: stop the diffalanche that holds it, or
run with --port <n>`, so the raw Node wording the grep expects never reaches
stderr. The retry loop at lines 344–347 exists for exactly this case; instead
`serve_failed` runs and the smoke run exits 1. Port collision is the one thing
the retry was written for, and it is the one thing it cannot catch.

**3. Four spawn sites run TypeScript through `process.execPath` unguarded.**
[tests/cli-comments.test.ts:32](../../../tests/cli-comments.test.ts) defines
`runsTypeScript` (Bun, or Node ≥ 22.18) and skips when it is false; its comment
says "only this one test asks for more". `grep -n "process.execPath" tests/*.ts`
finds five spawn sites. The other four —
`tests/storage-concurrency.test.ts:34`, `tests/write-api.test.ts:454`,
`tests/watcher.test.ts:565`, `tests/events.test.ts:192` — spawn `.ts` files with
no guard, while `package.json` declares `"engines": { "node": ">=22" }`. On a
supported Node between 22.0 and 22.18 those four fail and the guarded one skips.

**4. The UI screenshot suite is macOS-only by accident.**
[e2e/shell.spec.ts:42](../../../e2e/shell.spec.ts) asserts
`toHaveScreenshot("shell-dark.png")`, and the only baselines on disk are
`shell-dark-darwin.png` and `shell-light-darwin.png`.
`e2e/playwright.config.ts` sets neither `snapshotPathTemplate` nor
`ignoreSnapshots`, so Playwright's default suffix is `process.platform` and a
Linux run looks for a file that does not exist. This is the suite
[DA-54.2](../DA-54.2-ui-suite-in-gates/task.md) wants to put in a gate; it cannot go into
a Linux gate as it stands.

**5. The first fixture edit races the recursive watcher's arming.**
[tests/events.test.ts:162](../../../tests/events.test.ts) writes its first
fixture file immediately after `beforeAll` starts the server, with one short test
in between. The watcher's readiness barrier
([src/core/watcher/index.ts:372](../../../src/core/watcher/index.ts)) waits for
`watcher.ready`, which for the recursive path does not prove the OS has begun
delivering. `tests/watcher.test.ts:90–116` records this window empirically — four
writes of thirty produced no event inside five seconds — and arms around it;
`events.test.ts` does not.

**6. Two e2e assertions hold a perf budget the way the gate refuses to.**
[e2e/sidebar.spec.ts:102](../../../e2e/sidebar.spec.ts) takes one sample and
asserts `jump < 50`, where 50 is `perf/budgets.ts` `fileJumpMs`. The gate takes
the median of three and multiplies by `RUNNER_ALLOWANCE` on a shared runner;
this spec does neither, so it is the same budget held to a stricter rule in a
suite that is not the gate.

**7. An SSE handshake is bounded fifteen times tighter than the defect needs.**
[tests/events.test.ts:151](../../../tests/events.test.ts) asserts
`head < 1_000` to prove the response head is not withheld until the first
heartbeat. The defect it guards against (DA-25.1) produces a head at
`HEARTBEAT_MS = 15_000`. Anything between 1 s and 15 s is a red test that is not
the defect.

**8. The perf harness waits 500 ms for a round trip it allows 750 ms.**
[perf/harness.ts:220](../../../perf/harness.ts) sleeps a fixed 500 ms in the
`finally` of `measureUpdate` so "the rescan of the restored file lands before the
next run starts". The path being waited out is the one the harness measures:
`updateMs`, budget 300 ms, ceiling 750 ms on a shared runner. When the restore
takes longer than the sleep, the next run's measurement starts with the previous
run's rescan still in flight.

### What run 0921 recorded

Three tracks ran gates on this tree through the evening of 2026-09-21, each on
its own worktree and each declaring its environmental reds against the base
commit `ed81928`. The records are the first live evidence for this list, and
they change two of its items.

**Item 1 fired, and the margin was 1%.** `tests/watcher.test.ts` "rescans the
edited repository alone and has the new hunk in diff.json in time" went red with
`expected 605.6702079999995 to be less than 599.8497499999994` — the median of
the timed edits against `BUDGET_MS + baseline()`, both timed in the same run,
red on the base commit as well. Six milliseconds over a ceiling the test
computes for itself after the window it is compensating for. The sweep called
this the lead suspect on reasoning alone; it does not need the reasoning any
more.

**Item 5's cause is one line lower than this list says.** The readiness barrier
at [src/core/watcher/index.ts](../../../src/core/watcher/index.ts) awaits
`Promise.all(watchers.map((w) => w.ready))` honestly — but
[src/core/watcher/tree.ts](../../../src/core/watcher/tree.ts) returns
`ready: Promise.resolve()` for the native path, so on that path the barrier
awaits nothing at all. The polling path builds a real baseline from its first
walk. That asymmetry is why `arm()` exists, and it applies to every `watchTree`
caller, including watches of the data directory rather than of a repository.

**Two more verdicts of the same family, seen by two tracks independently.**
`tests/watcher.test.ts` "a comments.json that cannot be read → stops the comment
events and leaves the rest of the chain running" fails as
`Error: the watcher never caught up` from the `settle()` deadline poll, and
`tests/events.test.ts` reddened on "replays what a client missed while it was
away" and on "carries a reply written by the CLI". All three are deadline polls
over an event that arrives late under load rather than not at all.

**Two runners, one tree, two different verdicts — and that pair is a cheaper
proof than the procedure this run uses.** The final gate run of the
storage-cli-git branch, on a clean tree at entry load 11.27, reddened
`bun run test` on `tests/watcher.test.ts` "rescans the edited repository alone"
(`expected 580.2531250000002 to be less than 460.0728330000002`) and
`bun run test:bun` on `tests/synth.test.ts` "produces byte-identical trees for
the same seed" (timed out in 5000 ms). Same tree, same minute, different
verdicts. A defect in the code reddens the same verdict on both runners; only
the machine picks a different one each time. Where that pair appears, it
settles the question without the re-runs and the base-commit measurement the
run otherwise demands.

`tests/synth.test.ts` is a ninth member of this list and was not in the sweep:
its budget is a 5 s test timeout over the generation of the synthetic fixture,
with no precondition of any kind.

**The ceiling this verdict computes for itself moved threefold in one evening.**
`baseline()` is a median of three rescans, taken in the same run as the
measurement it bounds. Eight interleaved runs of `tests/watcher.test.ts` on a
quiet machine gave 59.6, 67.7, 75.1, 78.3, 77.6, 78.4, 109.0 and 126.9 ms; the
two readings taken inside a full gate chain, read out of the text of the failing
assertion, were 160.07 and 193.98 ms. No code changed between them. The
assertion is `median(elapsed) < BUDGET_MS + baseline()`, so the right-hand side
varies by more than the budget it adds to — and the first run of each series is
visibly a warm-up, which makes the ceiling depend on run order as well as on
load. Inside the full suite the same verdict went red three times in one evening —
605.67 against 599.85, 580.25 against 460.07, 510.78 against 493.98, gaps of
6.0, 120.2 and 16.8 ms; run alone on a quiet machine it was green twelve times
out of twelve, four by verdict and eight instrumented.

**A tenth entry, and the cleanest instance of the family.**
`e2e/live.spec.ts` "an edit patches its own card, holds the reading position,
and leaves the composer open" was proved environmental by three full `test:ui`
runs under one lock — the branch tip, the base `ed81928`, the tip again —
giving green, red, green, with `git diff --stat ed81928 <tip> -- e2e/` empty:
the file is byte-identical on both sides.

The assertion that failed differs between occurrences: at `:187`
`expect(settled).not.toBeNull()` inside a gate chain, at `:183`
`expect(Math.abs(after.top - marks.top)).toBeLessThan(ROW_HEIGHT)` on the base.
Two statements in one test, both asking whether the patch had settled before
the test looked. A defect reddens the same assertion every time; a race takes
whichever one the machine reaches first, and that is what makes the pair a
signature rather than a coincidence. Over six runs the test was green four
times and red twice, and never red on a machine that was quiet.

**A wall-clock precondition that is assumed rather than asserted cannot be
seen to have failed.** The lock-writers suite added by DA-76.1 waits a fixed
budget for a racing scan to finish and then asserts that the cache was not
written through the lock. Made to measure its own precondition, it failed
immediately on this machine: a scan of the fixture took 467 ms against a 400 ms
budget while the gates chain was running. Every earlier green of that verdict
had been reached without the writer arriving — a pass that proves nothing, and
that nothing distinguishes from a pass that proves something. The fix there
turned the constant into a floor under a multiple of the scan the same test
already times; the residual is that the multiple is a heuristic, not a bound.

This is the general shape behind items 1, 5, 7 and 8: each holds a number that
the machine, not the code, decides, and each reports the same green whether it
checked or never reached the check.

## Work to do

- Fix each of the eight. The shape of the fix differs: (1) and (8) need the wait
  replaced by a condition, not a longer sleep; (2) is a one-line pattern fix plus
  a test that a second `serve` on a taken port retries; (3) is the existing
  `runsTypeScript` guard applied to the other four sites, or the helper compiled;
  (4) needs a platform decision — baselines per platform, or the screenshot
  assertions confined to a suite that declares macOS; (5) needs the arming step
  `watcher.test.ts` already has; (6) and (7) need the assertion moved to the
  quantity the test actually owns.
- Sweep the remaining fixed waits by the same rule: a wait is either a
  condition with a generous deadline or a documented sleep with a reason. Write
  the rule down in `docs/reference/11-perf.md`, next to what the gate measures.
- Make every remaining fixed wait say whether it was enough. A sleep that was
  long enough and a sleep that was not print the same green, and the verdict
  behind the short one has not run; the lock-writers case above is the measured
  instance of that. Where a wait guards an assertion, the test can time the
  thing it waits for and derive the budget from it or check the budget against
  it.
- Where a budget is asserted outside the gate, say in the reference which
  assertion owns which number. Two places holding one budget to two rules is how
  a red test stops meaning anything.

## Out of scope

- [DA-55.2](../DA-55.2-update-budget-step-up/task.md) — why the update budget stepped
  from 260 ms to 341 ms. That is a performance question; this task is about
  assertions that fail without a regression.
- [DA-54.2](../DA-54.2-ui-suite-in-gates/task.md), putting the Playwright UI suite in a
  gate. Item 4 is a precondition for it, not the same work.
- Speeding up the suites.

## Verification

- Each of the eight is closed by a change that makes its failure mode
  impossible, not by a wider bound: name for each what would have to happen for
  it to be red, and show it is no longer load.
- The busy-port retry is proved: start a `serve`, start a second on the same
  port, and show the smoke script retries rather than exiting 1.
- `bun run test` and `bun run test:bun` stay green under load — run each three
  times with the machine busy and record the exit codes.
- The rule for waits is in `docs/reference/11-perf.md`, and every remaining fixed
  sleep in `tests/`, `e2e/` and `perf/` either satisfies it or is gone.

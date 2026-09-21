# DA-60 · Remove the structural causes of flakiness from the suites

- **Order:** 250
- **Scope:** 11-perf, 05-watcher, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

[DA-31.1](../../archive/DA-31.1-unit-suite-flaky-under-load/task.md) closed by
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
[DA-54.2](../../archive/DA-54.2-ui-suite-in-gates/task.md) wants to put in a gate; it cannot go into
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
- Where a budget is asserted outside the gate, say in the reference which
  assertion owns which number. Two places holding one budget to two rules is how
  a red test stops meaning anything.

## Out of scope

- [DA-55.2](../../archive/DA-55.2-update-budget-step-up/task.md) — why the update budget stepped
  from 260 ms to 341 ms. That is a performance question; this task is about
  assertions that fail without a regression.
- [DA-54.2](../../archive/DA-54.2-ui-suite-in-gates/task.md), putting the Playwright UI suite in a
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

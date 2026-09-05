# DA-25.2 · `bun run perf` stops after its first run and never returns

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-5
- **Taken:** 2026-09-05

## Context

`bun run perf` is one of the `gates` of `backslop.json`, so every task is
reported against it. On this machine it prints `run 1/3` and then stops: the
process stays alive, uses no CPU, and never starts a second measurement. It has
to be killed.

Observed five times on 2026-09-05, in three worktrees of this repository and on
two different branches — including one that carried none of the live-update work
— so it is not a property of any one branch:

```
$ bun run perf
fixture .perf/fixture: 21 repositories, 300 files, 30000 lines
run 1/3: {"variant":"default","firstRenderMs":99.1, … ,"updateMs":335}
   (fifteen minutes later, nothing else)

$ ps -o pid,etime,%cpu -p <gate>
71291   15:43   0.0
$ pgrep -P 71291            # no children: no browser was ever spawned
$ ps aux | grep -c headless_shell
0
```

What it is not:

- **Not `chromium.launch()` on its own.** Three launch/close cycles in one
  process take 974, 378 and 226 ms.
- **Not the review server either.** The same three cycles *inside*
  `withServer(".perf/fixture", …)` — the harness's own server, watcher and all —
  take 974, 378 and 226 ms and return.

So what is left is the state the process is in after a whole measurement has
run: by then it has opened and closed an SSE stream, switched the session twice
(two writes, two rescans) and edited and restored a file of the fixture (two
more rescans). The next `chromium.launch()` never spawns a process. A watcher
callback and a `spawn` deadlocking under Bun is the first thing to rule out —
`recursive: false`, which makes the watcher walk instead of watching, is a
one-flag experiment against that.

Two smaller things fall out of the same runs, both from killing a hung gate:
the fixture is left with the probe line of DA-25 still appended (`30002 lines`
instead of `30000`) and on the second session (`synth-b`) rather than the one it
came in on, because both are undone in a `finally` the kill never reaches. A
gate whose fixture drifts measures a slightly different review each time.

## Work to do

- Reproduce with `--runs 2` on a freshly generated fixture, then bisect the
  three things run 1 does that a bare launch does not: the SSE stream, the
  session switch, and the edit probe. Removing one at a time says which.
- If it is the watcher, try `recursive: false` in the harness's server and, if
  that settles it, either close the watcher between runs or take the browser out
  of the process that holds it.
- Until it is fixed, the honest workaround is one measurement per process —
  `bun perf/run.ts --runs 1`, three times, medians taken by hand — and
  [11-perf.md](../../reference/11-perf.md) should say so rather than leaving the
  next person to discover the hang.
- Make the fixture's state a precondition rather than an assumption: the gate
  already regenerates a fixture whose `current` pointer is missing, and the same
  check can cover a fixture that a killed run left edited or switched.

## Out of scope

- The CPU-per-frame budget, which is DA-16.1.

## Verification

- `bun run perf` completes three runs and prints its table, five times in a row,
  on a machine doing nothing else.

# DA-54.4 · The UI suite becomes a gate that flaps under load, and the load precondition of ADR-013 does not cover it

- **Order:** 730
- **Scope:** 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-21
- **Cost:** major
- **Dependencies:** [DA-54.5](../DA-54.5-load-precondition-reads-one-minute-only/task.md) — its last question is whether the precondition belongs to `perf` alone or to the gate list, and this entry is the first caller of that answer

## Context

Finding discovered while making the Playwright UI suite a gate (DA-54.2). The
suite is now the sixth of the seven entries of `gates` in `backslop.json`, so every worker
runs it before reporting.

It is a browser suite with live-update specs in it, which means it is a suite
about time, and a machine that is busy decides some of its assertions.
Measured on 2026-09-21, three runs on one machine, two trees:

| tree | load average at the start | result |
|---|---|---|
| wave-2 branch | 23.16 | **1 failed**, 94 passed |
| `ed81928` | 9.87 | 95 passed, exit 0 |
| wave-2 branch | 9.15 | 95 passed, exit 0 |

The failure:

```
e2e/live.spec.ts:106:1 › an edit patches its own card, holds the reading
position, and leaves the composer open

Error: expect(received).not.toBeNull()
Received: null
  at e2e/live.spec.ts:187:25
      const settled = await page.evaluate(() => window.__perf.settles.at(-1) ?? null);
>     expect(settled).not.toBeNull();
```

`settles` is the record of the scroll-anchor correction, and the assertion asks
for one to have happened at all. Under load the live patch had not landed by the
time the spec looked, so there was nothing to correct — the same class of red as
the two timer-sensitive Vitest specs this session saw at a load average of 53,
and green on both trees once the machine was quiet.

[ADR-013](../../adr/adr-013-perf-gate-off-ci.md) gave `bun run perf` a load
precondition for exactly this: above 2.5 runnable tasks per core the gate
declines to produce a verdict rather than producing a wrong one, and says so.
`bun run test:ui` has no such thing. So of the seven gates, the two that depend
on the machine now behave differently: one says `unable to measure`, the other
goes red and the worker has to prove the red is not theirs.

## Work to do

- Give `bun run test:ui` the same precondition, or decide it should not have one.
  `perf/load.ts` already holds `readLoad`, `tooBusy`, `LOAD_CEILING` and
  `ignoringLoad`, so the mechanism exists; what is missing is where it is asked
  from — a Playwright global setup that fails the run early with the same
  `unable to measure` wording is the obvious place, and it is a different file
  from the gate's `main`.
- Decide whether the bypass is the same variable. `DIFFALANCHE_PERF_IGNORE_LOAD`
  names perf; a suite that is not perf reading a variable that says so is a
  smaller lie than two variables to keep in sync, but it is still one.
- Whichever is chosen, the rule a worker follows has to be written down once
  rather than twice: a red that the machine caused is proved by re-running the
  failed spec on a quiet machine and by running it on the base commit, and the
  measurements above are the first recorded instance of that proof.

## Out of scope

- Making the live specs themselves tolerant of a slow machine. That is a change
  to what they assert, and it is a larger question than where the gate stops.
- The load ceiling's own number, which is ADR-013's and was measured there.

## Verification

- `bun run test:ui` on a machine above the ceiling stops with `unable to
  measure` and does not report a failed spec.
- Below the ceiling it behaves exactly as it does today, including the
  screenshot comparisons, which the CI job skips and the gate does not.

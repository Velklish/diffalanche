# DA-60.2 · A watcher event the suites wait 20 s for may be lost rather than late

- **Order:** 810
- **Scope:** 05-watcher, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Parent:** DA-60
- **Cost:** major (hypothesis)

## Evidence

Filed from the DA-55.7 worker at the orchestrator's request. **A hypothesis:**
nothing below tells a late event from one that never came.

DA-60 made every wait in the suites a condition with a deadline "that only a
hang reaches" — 20 s for a watcher event or an SSE frame
([11-perf.md](../../reference/11-perf.md#waits-in-the-suites)). The verdicts
below still run out of it. If the event were only late, a deadline that long
should cover any load the machine has shown; that it does not suggests the event
is sometimes lost — a change the watch or the walk never reports, or a rescan
that says nothing — and a longer deadline would not help.

1. **Seen by this worker.** `tests/watcher.test.ts`, "a comments.json that
   cannot be read › stops the comment events and leaves the rest of the chain
   running", red once in `bun run test:bun` (1 failed, 790 passed) of the gate
   series on `6af7885` (DA-55.7), run 2026-09-24 00:17–00:20Z under
   `/tmp/da-perf.lock`, load average 11.57 / 15.54 / 16.36 at the series' start
   and 30.06 at 00:18Z. The assertion in full:

   ```
   Error: the watcher never caught up
    ❯ settle tests/watcher.test.ts:176:39
   ```

   `settle` writes a new file into another repository and waits 20 s for its
   `diff-changed`; under the Bun runtime the suite walks the trees
   (`recursive: false`, `pollIntervalMs: 40`). The same verdict alone,
   `DIFFALANCHE_TEST_RUNTIME=bun bunx --bun vitest run tests/watcher.test.ts -t
   "stops the comment events and leaves the rest of the chain running"`, was
   green twice on `6af7885` (exit 0, 0; 2.85 s and 3.16 s) and twice on the base
   `ee3dd21` (exit 0, 0), alternating, load 9.75–10.86.

   **It came back** on `569f970` (the review round of DA-55.7), clean tree,
   2026-09-24 00:51Z, load average 32.45 at 00:52Z: `DIFFALANCHE_TEST_RUNTIME=bun
   bunx --bun vitest run tests/server.test.ts tests/watcher.test.ts
   tests/review-reread.test.ts tests/cli.test.ts tests/exports.test.ts` — 1
   failed, 142 passed, the same verdict and the same `Error: the watcher never
   caught up` after 20.5 s. Under the lock 00:57–00:58Z, load 12.85–22.21,
   alternating `569f970` and `ee3dd21`: the verdict alone twice on each side and
   the whole of `tests/watcher.test.ts` twice on each side, all eight exit 0
   (46/46 and 45/45). Both sightings were at a load average above 30 and neither
   came back below 23.
2. **Recorded at the acceptance of DA-41, not re-run here.** Its `result.md`
   (`docs/archive/DA-41-model-delivery/result.md` on `main` from `66b749b`, not
   yet on this branch's base) says: integration gates on `2db3239` under
   `/tmp/da-perf.lock` 23:59:02–00:03:21Z, load averages 15.9–32.5 on 8 cores;
   `bun run test:bun` 1 — `tests/events.test.ts > the live stream > carries a
   reply written by the CLI, and the activity line with its author`, "Error: no
   reply-added within 20000 ms" (events.test.ts:104), at load 32.5. That file
   alone under the lock, alternating: `2db3239` 0, `ee3dd21` 0, `2db3239` 0,
   `ee3dd21` 0 (11/11 each); `bun run test:bun` again in full on `2db3239` 0
   (802/802). "Not reproduced on either side, so not proved the machine's
   either; the timer starts after the CLI has written, so it measures the
   watcher." Earlier reds of the same verdict with the 10 s deadline on the ml2
   and gates branches are the orchestrator's word, not checked here.

## What it would take

Tell "late" from "never" before touching a deadline: a probe run of the two
verdicts that waits 120 s and logs when the event did arrive, under the load the
reds were seen at. An event that arrives at 25 s is a deadline question for
11-perf; one that never arrives is a watcher defect of 05-watcher — a change of
one of the walked trees that the walk's baseline swallowed, or a rescan queued
behind something that never ends.

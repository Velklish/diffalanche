# DA-31.1 · Result

**Closed 2026-09-05.** Completed, once a red run with its output kept named the test: `tests/events.test.ts` "carries a reply written by the CLI, and the activity line with its author" — `no reply-added within 5000 ms`, in a full `bun run test` on a quiet machine (32 Vitest workers starting at once), and 10 of 10 green five times in isolation. The test spawned a Node process for the CLI reply and started its clock at the spawn, so the five-second window held the process start under a parallel suite as well as the watcher's latency. The clock now starts when the CLI has exited — what is measured is the watcher, the debounce, the poll and the stream, which is what the test is about — the frame wait is twenty seconds, and the latency assertion stays at five.

**Verification.** `bun run test` and `bun run test:bun` green after the change (401 each), full suites, quiet machine; the earlier red runs under load 13–31 recorded in the task are the same shape and are not expected back.

**Documentation in the same pass.** Not required; the reason is in the test.

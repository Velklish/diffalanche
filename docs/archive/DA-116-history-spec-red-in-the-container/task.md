# DA-116 · Two tests of e2e/history.spec.ts fail in the cloud container, base included, and pass in CI

- **Order:** 890
- **Scope:** 08-ui, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-28
- **Dependencies:** none

## Context

Found while running `bun run test:ui` for DA-82 on a 4-core cloud container
(root user, Chromium 141 headless shell, Bun 1.3.11). Two tests fail there, and the
same two fail on `origin/main` at `f49b3fa` in a worktree of its own
(`bun e2e/quiet.ts e2e/history.spec.ts`: 2 failed, 6 passed, both trees); the CI
`UI suite` of the same commits passed:

- `e2e/history.spec.ts:339` › "a task this window closes raises no mark of its own":
  `arrived(page, "sessions-changed <name>", 0)` at line 362 timed out after 20 s
  with no such frame heard, after the row's `Close` and its toast.
- `e2e/history.spec.ts:432` › "a task deleted elsewhere takes a window on it to the
  current one": a comment written by `cli("comment", …)` at line 442 never reached
  `.rail-list` within 20 s — it read "This review session has no comments."

Both wait for a frame of `/api/events` caused by a write the page did not make
through its own request path. The cause is unknown; the root user, the headless
shell's version and the Bun version are the three known differences from CI, and
none has been tried in isolation.

## Work to do

- Reproduce in the container and name which of the three differences it is.
- If it is the environment, say so in 11-perf's "Waits in the suites" or the
  README's contributor notes; if it is a race the container exposes, fix it.

## Out of scope

- The other environment reds of the same run: the embedding model and the Bun
  stack-trace tests, which are the environment's, and the `chmod` test under
  root, which is DA-117.1.

## Verification

- Both tests pass in the container, or the reference names the condition under
  which they cannot.

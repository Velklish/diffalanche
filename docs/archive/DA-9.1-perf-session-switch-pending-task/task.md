# DA-9.1 · The "switching review sessions" budget waits on the wrong task

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** none

## Context

`perf/budgets.ts:40` marks the budget line "Switching review sessions" as
`pendingUntil: "DA-9"`, and the header of that file says the line is turned on
by the task named there. DA-9 is the domain of review sessions — `createSession`,
`useSession`, `setBase`, `listSessions` in `src/core/domain` — and it cannot
turn the line on: the measurement is a browser one. `perf/harness.ts` drives the
built page, and the page has no way to switch sessions until the server serves
`GET /api/sessions` (DA-16, queue) and the header carries the sessions menu
(DA-24, queue).

DA-24 already owns the measurement and says so: `docs/backlog/queue/DA-24-ui-header.md`
line 27 — "switching sessions swaps the thread set within 100 ms in the perf
harness".

Evidence:

```
$ grep -n "pendingUntil" perf/budgets.ts
40:    pendingUntil: "DA-9",
47:    pendingUntil: "DA-25",
$ bun run perf
| Switching review sessions | 100 ms | pending | DA-9 |
```

DA-9 cannot enable that row, so the row keeps printing `DA-9` — which reads as
an unfinished task rather than a budget waiting on the UI.

## Work to do

- Point the line at the task that can measure it: `pendingUntil: "DA-24"` in
  `perf/budgets.ts`.
- Check the neighbouring line the same way: `Update after an edit in one
  repository` names DA-25, which is `ui-live-update` and does own its
  measurement — that one looks right, so this is a one-line change unless the
  check says otherwise.

## Out of scope

- Writing the measurement itself: that is DA-24's, together with the UI it
  measures.

## Verification

- `bun run perf` prints `| Switching review sessions | 100 ms | pending | DA-24 |`.

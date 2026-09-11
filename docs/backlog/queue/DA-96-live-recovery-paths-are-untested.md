# DA-96 · Every client-side recovery path in live.ts is untested: reload frames, reconnecting state, replay

- **Order:** 510
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

Three paths in [src/ui/live.ts](../../../src/ui/live.ts) exist only for the case where live update has already gone wrong, and no test in `tests/` or `e2e/` reaches any of them. The happy path of the same module is covered — `e2e/live.spec.ts` has two tests, and `tests/ui-live.test.ts` pins the store and patch layer — so what is missing is the recovery, not the module.

The three are:

```ts
// src/ui/live.ts:47-51
queue = queue.then(task).catch((error: unknown) => {
  // A fetch that failed is a frame lost, not a page lost: the stream is
  // still open and the next event patches over it.
  store().setToast(error instanceof Error ? error.message : String(error));
});

// src/ui/live.ts:62-64
source.onerror = () => {
  if (source.readyState !== EventSource.CLOSED) store().setConnection("reconnecting");
};

// src/ui/live.ts:119
on<{ reason: string }>("reload", () => store().loadReview());
```

`grep -rln "ui/live\|startLive" tests/ e2e/ src/` answers `src/ui/App.tsx` and `src/ui/live.ts` and nothing else: no test imports the module. `tests/ui-live.test.ts:2-3` imports `src/ui/patch.ts` and `src/ui/store.ts`. `e2e/live.spec.ts` holds exactly two tests — a reply reaching the rail (line 71) and an edit patching its own card (line 106) — and neither drops the stream nor overruns the frame ring; `grep -n reconnecting e2e/*.spec.ts` is empty.

The producer half of the same contract is pinned: `tests/events.test.ts:330` asserts that a client further behind than the ring reaches gets `reload` with the right id. So the server is held to emitting the frame and the client is not held to answering it. `docs/archive/DA-25-ui-live-update/result.md` says the same by omission — its verification paragraph lists the reply, the edit, the anchor and the mutation probes, and none of the three paths above.

What follows is narrow: someone renames the event or drops the listener at line 119 and every suite stays green, while a tab that slept longer than the ring keeps showing a stale review with `watching` in the footer — the state ADR-005 added the frame to prevent. It is a stale page until a manual reload, not wrong data written anywhere, which is why this is minor.

Two constraints found while reading the code, both of which shape where the test can live. First, the unit suite has no DOM: `vitest.config.ts` sets no `environment`, and the `diff-changed` and thread handlers reach `capture()` (live.ts:196-197), which reads `document` — the three paths above do not, so a unit test can drive them and only them. Second, neither runtime supplies the global the module uses: `node -e 'typeof EventSource'` on Node v25.2.1 and `bun -e` on Bun 1.3.14 both answer `undefined`, so a test must bring its own class, including the `CLOSED` constant that line 63 compares against.

## Work to do

- Decide where the tests live, and say why in the test's own header. The candidates are a unit test in `tests/` that drives `startLive()` against a stubbed `EventSource` and a stubbed `fetch`, the way `tests/ui-threads.test.ts:46` already stubs `fetch` against the same store; and a Playwright test in `e2e/` that takes the stream away from a loaded page. They are not equivalent: the unit test reaches all three paths but proves nothing about the browser's own reconnect, and the e2e test is the only one that does.
- If the e2e route is chosen, take the stream down without taking the server down: `e2e/playwright.config.ts` starts one `webServer` for the whole suite with `workers: 1` and `reuseExistingServer: false`, so a spec that stops the process ends the run for every spec after it. Aborting `**/api/events` through `page.route`, or `context.setOffline`, leaves the fixture intact.
- Cover the reload frame: dispatch a `reload` event at the stub and assert the review was read again — a second `GET /api/review`, not merely that no error was raised.
- Cover the connection state in both directions: `onerror` with `readyState` open sets `reconnecting`, and `onerror` with `readyState === CLOSED` leaves the footer alone. The second half is what stops a fix that simply sets the state unconditionally.
- Cover the queue's catch: make one queued fetch reject and assert both halves — the toast carries the message, and the next event is still applied. The comment above it claims the stream survives a lost frame, and nothing checks that claim.
- Write the stub as one helper the three tests share rather than three near-copies, and keep it to what the module uses: `addEventListener`, `onopen`, `onerror`, `readyState`, `close`, and the static `CLOSED`.

## Out of scope

- The server side of live update, which `tests/events.test.ts` covers, and the ring and replay logic behind it.
- The happy path of `live.ts` — `diff-changed`, threads, activity — and the reading-position anchor, all of which `e2e/live.spec.ts` and `tests/ui-live.test.ts` hold.
- Changing what the recovery does. This task pins the behaviour that exists; a different answer to a lost stream is a separate decision.
- DA-60, which removes structural causes of flakiness from the suites. A new test must not become its ninth item, but nothing in DA-60's list is one of these three.
- DA-105, the toast that does not restart when the same message repeats — that is the toast's behaviour, not whether the failure reaches one.

## Verification

- Each of the three paths has a test that fails when the path is removed, proven as a mutation probe after the commit: deleting the `reload` listener at live.ts:119 turns the reload test red; replacing line 63 with an unconditional `setConnection("reconnecting")` turns the CLOSED half red; removing the `.catch` at live.ts:47 turns the toast test red and leaves an unhandled rejection where the assertion was.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`. Both runners matter here — the stub replaces a global neither of them defines, so a test that accidentally relies on the runtime's own `EventSource` fails on one of the two.
- If the e2e route is taken, `bun run test:ui` is green as a whole run and not only for the new spec: the shared server is the thing most easily broken by it.

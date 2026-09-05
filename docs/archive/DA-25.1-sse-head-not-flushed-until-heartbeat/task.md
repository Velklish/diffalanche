# DA-25.1 · The stream's response head reaches the browser only with its first heartbeat

- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-18

## Context

`GET /api/events` writes nothing until it has something to say, and the first
thing it says is the heartbeat fifteen seconds later. The response *head* is not
flushed before that either, so a client learns that its stream is up only when
the first byte arrives — up to fifteen seconds after it asked.

Measured against the server the UI tests run, on the fixture of `.perf/e2e`:

```
$ PORT=4899 FIXTURE=.perf/e2e bun e2e/server.ts &
$ bun -e 'const t=Date.now();
  const r = await fetch("http://127.0.0.1:4899/api/events");
  console.log("headers after", Date.now()-t, "ms", r.status, r.headers.get("content-type"));
  const {value} = await r.body.getReader().read();
  console.log("first bytes:", JSON.stringify(new TextDecoder().decode(value)));'
headers after 15807 ms 200 text/event-stream
first bytes: ": keep-alive\n\n"
```

What it costs the UI: `EventSource` fires `onopen` when the head arrives, so the
sidebar footer of DA-25 reads `connecting` for fifteen seconds on every load of
a quiet review — the one state the handoff's living dot is there to deny. No
event is lost in that window: `streamEvents` subscribes the client while it is
handling the request, before anything is written, so a frame emitted a
millisecond after the page opened is delivered (and flushes the head with it).
It is the *silence* that is invisible, not the stream.

DA-25 works around it in `src/ui/live.ts`: the page also asks for
`GET /api/activity`, which it needs for the feed's ring anyway, and treats an
answer to that as proof that the server is there. The workaround is honest about
the server and dishonest about the stream — it cannot tell a stream that is up
from one whose request never arrived — and it does nothing for a reconnect that
has no missed frames to replay.

## Work to do

- Write one comment line into the stream as soon as it is subscribed, before the
  heartbeat loop, in `streamEvents` ([`src/server/events.ts`](../../../src/server/events.ts)):
  the head is flushed with it and `onopen` fires at once. It goes after
  `events.subscribe(client)` and the replay, so the ordering the replay depends
  on is untouched.
- Remove the workaround in `src/ui/live.ts` and let `onopen` be what the footer
  reads, as `startLive` was written to do.
- Say in [07-server.md](../../reference/07-server.md) that the stream opens with
  a comment line, beside what it already says about the heartbeat.

## Out of scope

- The heartbeat interval, and Bun's `idleTimeout: 0`, which are what keep an
  open stream open rather than what opens it.

## Verification

- A test beside `tests/events.test.ts` reads the response head of
  `GET /api/events` and asserts it arrives without waiting for a heartbeat: the
  measurement above, with a budget of one second rather than fifteen.
- The Playwright check of DA-25 — the sidebar footer saying `watching` — passes
  with the workaround removed.

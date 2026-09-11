# DA-86 · A broken comments.json aborts reloadData, so metadata and session-list events stop with no signal

- **Order:** 410
- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The watcher reads the data directory as one chain, and a throw anywhere in it
drops the rest of the chain on the floor.
[src/core/watcher/index.ts:247-252](../../../src/core/watcher/index.ts):

```ts
  /** The three files of the data directory, in the order a change of one affects the others. */
  async function reloadData(): Promise<void> {
    await reloadCurrent();
    await reloadComments();
    await reloadMetadata();
    await reloadSessions();
  }
```

The second step is the unguarded one: `reloadComments` opens with
`const list = await readComments(config.dataDir, session);`
([index.ts:289-291](../../../src/core/watcher/index.ts)), with no `try` around
it. `readComments` ([src/core/storage/index.ts:166-171](../../../src/core/storage/index.ts))
returns `[]` only for a file that is not there; a file that *is* there goes into
`parseComments`, which fails on invalid JSON (`parseJson`,
[src/core/storage/fields.ts:20-26](../../../src/core/storage/fields.ts)) and on a
schema version outside `READABLE_VERSIONS` (`asVersion`,
[src/core/storage/schema.ts:51-60](../../../src/core/storage/schema.ts)) — the
latter deliberately, since a file of a version this build does not know is
refused whole. `reloadData` is the only caller of `reloadMetadata` and
`reloadSessions`, and it is scheduled from one place, the data directory's burst
handler at [index.ts:363](../../../src/core/watcher/index.ts). `enqueue`
([index.ts:152-165](../../../src/core/watcher/index.ts)) catches the rejection,
hands it to `onError`, and drops it; `serve` turns that into one
`rescan failed: …` line on stderr
([src/server/serve.ts:88-92](../../../src/server/serve.ts)). Nothing retries, so
the next burst repeats the same rejection at the same line.

While the file stays broken, `session-changed` and `sessions-changed` stop: a
base change, a scope edit or a `review close` on the current session, and a task
created or closed anywhere under `reviews/`, all produce nothing for an open
window.

The watcher treats exactly this condition as survivable everywhere else, which is
what makes line 291 an inconsistency rather than a deliberate fail-fast:
`snapshotComments` ([index.ts:544-554](../../../src/core/watcher/index.ts)) and
`readSessionOrNull` ([index.ts:577-584](../../../src/core/watcher/index.ts)) wrap
the same reads in `try`/`catch`, and the comment at
[index.ts:293-298](../../../src/core/watcher/index.ts) already reasons about "one
broken by hand and since repaired". `docs/reference/05-watcher.md:215-218` states
the intended behaviour as a promise: a file that cannot be read "leaves the
watcher without a baseline rather than without a start".

Two qualifications bound it. Because of the defect filed as
`DA-64-serve-exits-on-unreadable-data.md` the server today exits at start-up on a
broken `comments.json`, so this stall is reached when the file breaks while
`serve` is already running rather than before it. And it is not fully silent: the
comment-reading HTTP routes fail visibly on the same file. It is the metadata and
session-list events that stop with no signal at all.

## Work to do

- Make `reloadComments` survive an unreadable `comments.json` the way
  `snapshotComments` already does, so the chain reaches `reloadMetadata` and
  `reloadSessions`. Setting `comments` back to `null` reuses the existing
  re-baseline path at [index.ts:293-298](../../../src/core/watcher/index.ts): the
  next readable version becomes the baseline rather than two hundred new
  comments.
- Decide whether a caught read is reported or swallowed, and name the choice in
  the entry that closes this. The candidates are: hand it to `options.onError`
  once per transition into the broken state (so `serve` prints one line, not one
  per burst), hand it over on every burst as rescans already do, or say nothing
  at all. The middle one is what the current code effectively does for the whole
  chain today.
- Check the chain's other steps rather than assuming: `reloadMetadata` goes
  through the guarded `readSessionOrNull`, `reloadCurrent` reads `current`.
- Update `docs/reference/05-watcher.md` where it describes the reload chain so
  the guarantee it states at lines 215-218 covers the metadata and session-list
  half explicitly, not only the comment baseline.

## Out of scope

- `serve` exiting 1 on unreadable data at start-up: that is
  `DA-64-serve-exits-on-unreadable-data.md`, scoped to 06-cli and 07-server. This
  entry is about the already-running process.
- The behaviour of the comment HTTP routes on a broken file, which fail visibly
  and are meant to.
- Repairing or migrating a `comments.json` of an unknown schema version: refusing
  it is the storage layer's decision, and it stands.

## Verification

- A watcher test writes an unreadable `comments.json` for the current session —
  both shapes, `{ not json` and a `version` outside `READABLE_VERSIONS` — then
  changes `review.json`'s base and creates a second session, and asserts that
  `session-changed` and `sessions-changed` both still arrive. The nearest
  existing test to model it on is the `snapshotSessions` case at
  [tests/watcher.test.ts:682-690](../../../tests/watcher.test.ts), which does the
  same thing to `review.json`.
- Reverting the guard turns that test red: with the throw restored, the two
  events never arrive and the assertion times out rather than merely reading a
  different value.
- A second assertion covers the re-baseline: once the file is repaired, what is
  in it is the baseline, not a burst of `comment-added`.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  `bun run perf` is untouched by this change but is part of the gate set.

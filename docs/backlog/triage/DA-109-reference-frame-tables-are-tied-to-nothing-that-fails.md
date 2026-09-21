# DA-109 · The reference frame tables are tied to nothing that fails

- **Scope:** 05-watcher, 07-server, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-22
- **Dependencies:** none

This is a task in its own right and not a finding under a parent, which is why
it carries no cost label: what it asks for is a check the repository does not
have, not a defect in somebody's task. DA-59 and DA-60 sit here on the same
footing.

## Context

`WatcherEvent` in [src/core/watcher/bus.ts](../../../src/core/watcher/bus.ts) is
the wire shape as well as the in-process one — the server forwards each member
as a named SSE frame with that object as the data. Three tables in the reference
describe the same union, one per audience:

- [05-watcher.md](../../reference/05-watcher.md):238-247 — event, data, when it
  is emitted;
- [07-server.md](../../reference/07-server.md):505-514 — event and the JSON on
  the wire;
- [08-ui.md](../../reference/08-ui.md):964-972 — event and what the page does
  with it.

Nothing connects any of them to the type. `bun run typecheck` reads no markdown;
`bun run lint` is Biome over the sources; `backslop lint` is about the tracker's
own files and has no opinion on a reference table, nor should it. A frame can
gain a field, change meaning, or be split in two, and every gate stays green
while all three tables go on describing the frame that used to exist.

That is not hypothetical. In wave 2, DA-55.1 and DA-68 changed the union — the
three comment frames gained a `session`, `session-changed` was narrowed to the
metadata of a followed session, and `current-changed` was split out of it — and
all three tables were left behind:

As 05-watcher.md read until `DA-55.1`:

```md
| `comment-added` | `{ id }` | a comment appeared in `comments.json` |
| `reply-added` | `{ id, commentId }` | a reply appeared in a thread; `id` is the reply |
| `comment-status` | `{ id }` | a comment was resolved or reopened |
```

As 07-server.md read until the same commit:

```md
| `comment-added` | `{ type, id }` |
| `reply-added` | `{ type, id, commentId }` — `id` is the reply |
| `comment-status` | `{ type, id }` |
| `session-changed` | `{ type, name }` — the current session, or the metadata of it |
```

The 07-server table had no `current-changed` row at all, and the 08-ui table
neither mentioned that a comment frame naming another task is dropped unread nor
carried a row for the frame a window with no `?review=` follows.

The fourth case is the one that shows the cost is not only a stale table. The
paragraph on what `POST /api/sessions/:name/use` invalidates
([07-server.md](../../reference/07-server.md):269-277) argued from the frame:

As it read until `DA-55.1`:

```md
A switch through `use` does pay: the watcher sees `current` move and sends
`session-changed` for the session switched to, and that drops its document.
```

Once the pointer got a frame of its own, that sentence was not merely out of
date — it asserted a cost the server no longer pays, in a passage whose whole
subject is what a switch costs. A reader reaching for the document-cache
behaviour would have been told the opposite of what the code does.

All four were found by reading the files while working on something else. None
was found by a check, because there is no check that could have found them: the
tables are prose beside a type, and nothing compares the two. Every gate was
green over all four.

## Work to do

- Decide where the check lives. The candidates are a test in `tests/` that reads
  the three markdown files and the type, a `backslop` gate command of its own, or
  a script under `scripts/` wired into the existing `bun run lint`. A test is the
  cheapest to reach — the suite already runs on every gate pass — and the failure
  message can name the table and the row.
- Parse the union members out of `bus.ts`. The declaration is a discriminated
  union of object literals with a `type` string, so the member names and their
  field names can be read from the TypeScript AST rather than by regular
  expression; `typescript` is already a dependency.
- Parse the frame rows out of the three tables. They need an anchor the parser
  can find — an HTML comment above each table naming the union it mirrors is
  enough, and it keeps the tables readable.
- Fail on the three shapes this entry is about: a frame in the type with no row;
  a row whose field list is not the member's field list; a row naming a frame the
  type no longer has. The three tables do not carry the same columns, so the
  comparison that is common to all of them is the frame **name** and its **field
  names** — 05-watcher and 07-server print the fields, 08-ui does not, so 08-ui is
  checked for the name alone.
- Say in [README.md](../../reference/README.md) that the frame tables are
  checked, so the next person to add a frame learns it from the reference rather
  than from a red gate.

## Out of scope

- Every other correspondence between the reference and the code. The reference
  describes behaviour in prose throughout, and a general docs-versus-code check
  is not a thing this repository can have. This entry is about one machine-shaped
  correspondence — a closed union against three tables that enumerate it.
- The four stale tables themselves. They are corrected in the commits of DA-55.1
  and DA-68; this entry is the check that would have caught them.
- Whether `WatcherEvent` should be the wire shape at all. It is, by
  [ADR-005](../../adr/adr-005-live-update.md), and a separate wire type would be
  a second place to keep in step rather than a cure.

## Verification

- Remove `session` from `comment-added` in the 05-watcher table: the check goes
  red naming that row. Put it back: green.
- Add a member to `WatcherEvent` and no row: the check goes red naming the frame
  and the tables that lack it.
- Delete a row for a frame that exists: red. Leave a row for a frame that does
  not: red.
- The check must be green on the tree it is added to, which is the same statement
  as "the three tables are correct today" — so it is also the test that the
  corrections in DA-55.1 and DA-68 were complete.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  A markdown parse in the test suite touches no measured route, so `bun run perf`
  is unaffected.

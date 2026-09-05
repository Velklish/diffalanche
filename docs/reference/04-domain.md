# 04 · Domain

`src/core/domain` holds the rules above the files: what a review session is,
what a comment may do, and who may do it. It reads and writes only through
`src/core/storage` ([03-storage.md](03-storage.md)) and knows nothing about the
CLI, the server, or the UI — all three call the same functions.

Everything the domain refuses is a `DomainError` with a `code`. The code is what
a caller reads; the message is what a person reads.

| Code | When |
|---|---|
| `invalid-name` | a session name outside the character set, or a reserved one |
| `invalid-base` | a base argument that is none of the four forms |
| `session-exists` | `review new` on a name that is already a session |
| `no-such-session` | a named session that is not in the data directory |
| `no-current-session` | no `--review` and no `current` pointer |
| `no-such-comment` | a comment id that is not in the session |
| `invalid-anchor` | anchor levels that do not add up: a line without a file, a range that runs backwards |
| `role-not-human` | `resolve` or `reopen` from anything but a human |
| `line-not-in-diff` | a line anchor on a line the change set does not have |

## Review sessions

```ts
createSession(dataDir, name, base, title?): Promise<Review>
useSession(dataDir, name): Promise<Review>
setBase(dataDir, name, base): Promise<Review>
listSessions(dataDir): Promise<SessionList>
readSession(dataDir, name): Promise<Review>
resolveSessionName(dataDir, name?): Promise<string>
```

`createSession` writes `review.json` and an empty `comments.json` under the
session's lock and then makes the session current. Both files exist from the
start on purpose: a reader that has to tell "no file yet" from "no comments"
tells them apart for nothing.

A name that is already a session is refused with `session-exists`. The check
runs twice — before the lock and inside it, which is the one that decides — so
two creates of one name at the same instant cannot both pass, and both the
ordinary refusal and the loser of that race come back with the same code.

`useSession` only moves the `current` pointer, so it does not bump `updatedAt`:
switching to a session does not change it. `setBase` writes the new base and
bumps `updatedAt`, as does every comment write
([03-storage.md](03-storage.md#read-modify-write)).

`resolveSessionName` is the fallback every command of `docs/SPEC.md` section 8
shares: the session it was given, else the current one, else a refusal. It lives
here rather than in each command.

`listSessions` returns one row per session, most recently updated first, with
the counters the sessions menu shows (`docs/design/HANDOFF.md` section 7):

| Field | Where it comes from |
|---|---|
| `name`, `title`, `base`, `createdAt`, `updatedAt` | `review.json` |
| `current` | whether `current` names it |
| `open`, `resolved` | `comments.json`, by status |
| `repositories` | repositories in `diff.json`, or `null` when nothing has been scanned |

`warnings` beside the sessions carries the directories under `reviews/` that are
not sessions, exactly as storage reported them.

## Session names

A session name is a directory name, so it stays inside what macOS, Linux, and
Windows all spell the same way: **lowercase letters, digits, dot, dash, and
underscore**, at least one character. `.` and `..` are refused separately: they
pass the character set and are a path rather than a name.

## The base argument

`parseBaseArgument(value)` reads the argument of `review new --base` and
`review base`, and is the only place that reading happens — the CLI and the API
share it, so `branch:origin/develop` cannot come to mean two things.

| Argument | Base |
|---|---|
| `head` | `{ mode: "head" }` |
| `branch` | `{ mode: "branch" }` — each repository uses its remote default branch |
| `branch:<name>` | `{ mode: "branch", branch: "<name>" }` |
| anything else | `{ mode: "ref", ref: "<value>" }` |

An empty argument and a bare `branch:` are refused; everything else is a ref,
because a ref is any string git accepts and the tool does not second-guess it.

## Comments

```ts
addComment(dataDir, session, input): Promise<Comment>
reply(dataDir, session, id, message): Promise<Comment>
resolve(dataDir, session, id, verdict): Promise<Comment>
reopen(dataDir, session, id, verdict): Promise<Comment>
get(dataDir, session, id): Promise<Comment>
list(dataDir, session, filter?): Promise<Comment[]>
```

Every write goes through storage's `updateSession`
([03-storage.md](03-storage.md#read-modify-write)), as `createSession` and
`setBase` do: one path holds the session's lock, bumps `updatedAt`, and checks
the lock is still held before writing, so no writer of this module has to
remember any of it.

A comment id is `c_` plus six base36 characters, drawn again if the session
already holds it. A reply id is `r_` plus a counter inside the thread, one past
the highest already there rather than the length of the list — a thread edited
by hand cannot then produce two `r_3`.

`list` returns the comments in the order they were written, filtered by:

| Filter | Values |
|---|---|
| `status` | `open`, `resolved`, `all` — the domain's default is `all`; the CLI picks its own |
| `repo` | a repository path |
| `severity` | one severity |
| `unanswered` | `true` keeps only unanswered threads, `false` drops them |

### Anchor levels

The level is read off the nulls, as `docs/SPEC.md` section 7 defines it:
`repo: null` is the whole review, `path: null` a repository, `line: null` a
file, and a `line` with an `endLine` is a range. `addComment` refuses a
combination that is not a level — a file without a repository, a line without a
file, a range without a first line, a range that runs backwards — because such
a comment is one nothing can place.

`side` defaults to `new` on a line anchor and is `null` above one.

### Anchor capture

A line comment stores the line's own text, the header of the hunk it sits in,
and **three lines of context on each side**, taken from the change set when the
comment is written. This is the input Phase 3 re-anchors from.

The context is the neighbourhood in the file the comment is about, so it is
taken from the lines the anchored side has: `context` and `insert` for `new`,
`context` and `delete` for `old`. A hunk's line list holds both sides, and
context sliced out of it would put text that never existed in that file into
`before` and `after` — which is what re-anchoring later matches against.

The change set comes from `diff.json`, the cache a scan wrote, and is read as
the `RepositoryChange` of [02-git.md](02-git.md) — the hunks with per-line old
and new numbers. It has to come from there: the review response of the server
is read without hunks for speed, so an anchor taken from it would come out
empty.

A line the change set does not have is refused with the nearest hunk named —
"line 42 … is not in the change set on the new side; the nearest hunk is
`@@ -30,8 +38,12 @@`" — because the bare refusal leaves the writer guessing
where the diff is. A file left out of the diff for being binary or too large
carries no lines to anchor to; the refusal says which, and a file-level anchor
on it is still fine.

### Roles

`resolve` and `reopen` refuse any role but `human` and change nothing
([ADR-004](../adr/adr-004-agent-contract.md)). The check is here, not in the
shipped skills: a skill is advice, and an agent that never read it could still
close a thread. `resolve` sets `resolvedAt` and `resolvedBy` from the caller;
`reopen` clears both. A `note` on either is written into the thread as a reply
first — the on-disk format has no other place for it, and a status change with
an unexplained reason is worse than one with a message.

### Derived state

| Name | Meaning |
|---|---|
| `unanswered` | an **open** comment whose last message is from a human: no agent has answered |
| `awaiting` | an **open** comment whose last message is from an agent: nobody has verified it |

The last message of a thread is its last reply, or the comment itself when
there are none. A resolved thread is neither.

`countReview(comments)` gives the counters of the whole review, of every
repository that carries comments, and of every file inside them: `total`,
`open`, `resolved`, `unanswered`, `awaiting`, and `severity` — the worst
severity **among the open comments** of that scope, `null` when none is open. A
critical finding a human has already closed does not keep the file red.

## Markdown export

`exportMarkdown(review, comments)` writes the export of
`docs/design/HANDOFF.md` section 9: a heading with the session name and title,
a line with the base and the number of open comments, then one section per
repository — the whole-review comments first — with the severity, the anchor,
the body, and the replies as block quotes:

```md
# Review ls-240372 — Cargo flags across services

base branch:origin/develop · 5 open comments

## group/service-api — 3 comments

- **warning** · `src/Cargos/CargoService.cs:42-45`

  Null check is unreachable: Flags is non-nullable in the contract.

  > **claude** (agent) — Fixed: removed the fallback.
```

The caller decides what goes in, so `export --status open` and `--status all`
are the same function over different lists.

**The base line deviates from the design on purpose.**
`docs/design/HANDOFF.md` section 9 shows the meta line as `base origin/main` —
the branch name alone. The export writes the argument that produces the base
instead: `head`, `branch`, `branch:origin/develop`, or a ref. A bare branch
name cannot say which of the three modes the review used, and `head` and a ref
have no branch name to print; the argument form says both, and it is the form a
reader can paste back into `review base`.

## What it does not do yet

- Deleting a session (Phase 2, DA-40).
- The counters are read on every `listSessions` call: every session's
  `comments.json` and `diff.json` are opened. On a data directory with hundreds
  of sessions that will matter.
- Re-anchoring and the `orphaned` status (Phase 3). An anchor is captured once
  and never checked again, so a comment whose line has moved keeps the old
  text.
- Nothing re-reads `diff.json` while a comment is being written: the anchor is
  taken from the cache as it stood, so a scan that runs in between is not seen.

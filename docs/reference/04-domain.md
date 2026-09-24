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
| `line-not-in-diff` | a line anchor on a line neither the change set nor, when a source is given, the file itself has — past its end, or on a side that cannot be read |
| `invalid-scope` | a scope that does not add up: a repository the root has not, a repository named twice, a path that is not one inside its repository, an edit a scope cannot express |
| `out-of-scope` | a comment on something the review task is not about |
| `scope-has-comments` | narrowing the scope would delete comments and nothing consented to that; the error carries their ids |
| `severity-not-auto` | `reply` confirming a severity the model did not choose, or one an agent has already confirmed |
| `invalid-author` | `reply` confirming a severity with an author that is empty: the label would name nobody |

## Review sessions

```ts
createSession(dataDir, name, base, title?, { scope?, use? }?): Promise<Review>
useSession(dataDir, name): Promise<Review>
setBase(dataDir, name, base): Promise<Review>
listSessions(dataDir): Promise<SessionList>
readSession(dataDir, name): Promise<Review>
resolveSessionName(dataDir, name?): Promise<string>
```

`createSession` writes `review.json` and an empty `comments.json` under the
session's lock and then makes the session current — unless it is told not to.
`use: false` leaves `current` where it is: an agent that opens a task prints its
address and the human opens it when they are ready
([ADR-010](../adr/adr-010-review-task-scope.md)). The `scope` it is given is
written as it is; what a scope may say is checked against the repositories the
scan found, which this module does not read — see [Scope](#scope) below. Both
files exist from the start on purpose: a reader that has to tell "no file yet"
from "no comments" tells them apart for nothing.

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
| `name`, `title`, `base`, `scope`, `status`, `createdAt`, `updatedAt` | `review.json` |
| `current` | whether `current` names it |
| `open`, `resolved` | `comments.json`, by status |
| `repositories` | repositories in `diff.json`, or `null` when nothing has been scanned |

`warnings` beside the sessions carries the directories under `reviews/` that are
not sessions, exactly as storage reported them.

## Scope

`src/core/domain/scope.ts` holds what a review task is about and everything that
follows from it ([ADR-010](../adr/adr-010-review-task-scope.md)). A scope is one
list of entries, each a whole repository or a repository with the paths the task
names; `null` is the whole root, which is what every session written before that
decision means.

```ts
repositoryInScope(scope, repo): boolean
pathInScope(scope, repo, path): boolean
commentInScope(scope, comment): boolean
assertScope(scope, found): void
assertAnchorInScope(review, repo, path): void
widenScope(scope, change): Scope
narrowScope(scope, change): Scope
setScope(dataDir, name, scope, found, { dropComments? }): Promise<ScopeUpdate>
closeSession(dataDir, name, by): Promise<Review>
reopenSession(dataDir, name, by): Promise<Review>
```

**What is in a scope.** A repository the scope names without paths is the whole
repository, so every file of it is in. A comment on the whole review is always
in — it is about the task itself and hangs under no entry — and one on a
repository the task names is in whichever files that entry lists, because the
entry *is* the repository and a finding about it sits on it.

**What a scope may say.** `assertScope` checks it against the repositories the
scan found and refuses everything by name: a repository the root has not, a
repository named twice, an entry with an empty list of paths, and a path that is
not a path inside its repository — absolute, trailing, or with a `.` or `..` in
it. Whether a file has changes is never asked: a file in the scope with nothing
to show is kept by the task and left off the screen, which is decision 5 of the
ADR.

**Editing a scope.** `widenScope` only ever widens: adding a path to a
repository that is in as a whole changes nothing, because the whole already
holds it. `narrowScope` refuses what it cannot do rather than passing over it —
a repository or a path the scope does not have, and a path of a repository the
scope holds as a whole, since "everything but this file" is not an entry the
format has. An entry whose last path is removed goes with it, and a narrowing
that would leave the task about nothing is refused: an empty scope is not a
state. Both refuse a session whose scope is `null` — the whole root is as wide
as a task gets, and there is nothing in it to remove.

**Writing a scope.** `setScope` replaces it. The comments that would fall
outside the new scope are counted first: without `dropComments` the call throws
`ScopeCommentsError` — a `DomainError` with code `scope-has-comments` carrying
every id — and writes nothing, and with it they are deleted in the same write,
under the same lock, as the scope itself. A scope narrowed while its comments
waited for a second call would be a review with findings nothing can reach. The
comments are read inside the lock rather than taken from the draft, so a scope
change that drops none leaves `comments.json` alone and does not wake the
watcher for nothing ([03-storage.md](03-storage.md#read-modify-write)).

The message of `ScopeCommentsError` names the count, the first twelve ids, and
the CLI flag: the CLI is the contract it is written for. A caller that words its
own question reads `comments` off the error instead — that is what the API's 409
carries ([07-server.md](07-server.md)).

**Writing a comment.** `assertAnchorInScope` is what `addComment` calls before
anything is stored, and every interface therefore goes through it: a comment
outside the scope would be written where `list`, `show`, `export`, and the UI
will not return it, which is the loss product principle 5 forbids. The refusal
names the scope, because an agent that is only told "no" cannot tell whether to
widen the task or open its own.

**What the task shows, it takes a comment on**, and by the same rule: the names
of the scope, matched as they are written. `filterChange` shows the change set
under those names ([02-git.md](02-git.md)) and this refuses everything else, so
a file the task prints is a file it accepts a comment on, and a file it does not
print is one it refuses.

A renamed file is where the two would come apart if either side were cleverer.
Its new name is not in the scope, so the task shows nothing for it and takes no
comment on it; its old name is still what the task is about, so a comment on
that path is taken, the way a comment is taken on a path whose file stopped
changing (decision 5). Matching the old name on the show side instead would put
a file on screen under a name the scope has not, and then every reader of the
comments — `list`, `show`, `export` — would have to resolve the rename again,
from a change set that stops carrying it the moment the rename is committed.
That the scope does *not* follow a rename is a decision, taken by the owner on
2026-09-18 (DA-53.2): a scope is a literal list of paths that only a person or an
agent changes, and a task's definition does not move under its reader.
`review scope add` or `review scope set` is how a task takes the new name.

**Reading comments back.** `list`, `get`, `reply`, `resolve`, and `reopen` all
answer inside the scope: a comment outside it is not in the list, and every one
of the other four says `no-such-comment` — one question, one answer. Nothing
writes such a comment; a `comments.json` edited by hand is where it comes from.
They read `review.json` for the scope, one small file per call. `list` and `get`
read it before anything else, which is what a read is; `reply`, `resolve` and
`reopen` take it from the same `updateSession` draft they write through, inside
the session's lock, so a scope widened while they waited for the lock finds the
thread instead of refusing it (DA-67.1, [03-storage.md](03-storage.md)).

That "nothing writes such a comment" is held by where `addComment` checks the
scope, and it takes two checks to hold it. **Both refuse with `out-of-scope`,
and they say different things**, because the person reading the refusal is
answering a different question in each case.

The first is before the anchor is captured. It fires when the comment was
outside the task all along, and it says so — *"… is not in the scope of review
task X, which is about Y: widen the scope or open a task of its own"* — which is
the answer to "why was my comment refused". Being first is what makes the
refusal cheap (no change set is read for it) and what keeps `out-of-scope` ahead
of `line-not-in-diff` for an anchor that is both.

The second is inside the lock, against `draft.review`. It fires only when the
scope was wide enough when the comment was written and is not any more, and its
message is about that and nothing else — *"the scope of review task X narrowed
while this comment was being written: … is no longer in it … Nothing was
written"* — because "widen the scope or open a task of its own" would be advice
about a task that has just changed under the writer, and the useful fact is that
somebody else changed it and that nothing was kept. It is the one that is the
guarantee: between the first check and the write sit the anchor
capture and the wait for the lock, and a `review scope set` that narrows in that
window would otherwise leave the comment on a path the scope no longer has, seen
by nothing and reported as written. The anchor capture stays **outside** the
lock: it reads `diff.json`, the largest file in the session directory, and
holding the session for the length of that read would make every comment write
cost a parse of the whole change set to the watcher and the server that contend
for the same lock. What the anchor is captured from can go stale either way —
the cache is a cache — while the scope is a rule about whether the comment may
exist at all, and only the rule needs the lock.

**The status of a task.** `closeSession` and `reopenSession` set `status`,
`closedAt`, and `closedBy`, and both refuse any role but `human` through the
same `assertHuman` that `resolve` and `reopen` use — the rule of
[ADR-004](../adr/adr-004-agent-contract.md) reaching from a thread to the task
the threads are in. It lives in `src/core/domain/roles.ts` because both callers
need it and `comments.ts` already imports `scope.ts`. Setting a status that is
already set writes nothing, so the moment a task was closed at stays the moment
it was closed at. Closing is a marker and not a lock: `comment`, `reply`, and
`resolve` all still work on a closed task.

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

`list` returns the comments in the order they were written, inside the scope of
the session ([Scope](#scope)), filtered by:

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
file, a range without a first line, a line below 1, a range that runs backwards
— because such a comment is one nothing can place.

The check is `assertAnchorLevels`, and it is exported for the one caller that
has to make it earlier than `addComment` does: the `comment` command reads the
repository again before it writes, and an anchor that is not a level would pay
for that read on its way to a refusal ([06-cli.md](06-cli.md)). The domain keeps
the check regardless — `addComment` has callers that never touch the CLI, and
the level rule belongs to the comment, not to one entry point.

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

**A file whose hunks are all on the other side is a third answer**, and it names
the side rather than the file: "`repos/core/cargos-api/src/gone.ts` is deleted
and its hunks have lines on the old side only, so line 2 cannot be anchored on
the new side; anchor it on the old side". A deleted file asked about with the
`new` side and an added file asked about with the `old` side both land here, and
the `comment` command defaults the side to `new`, so a deleted file reaches it
from the command line. The measure is the file's own hunks: a hunk with no line
numbers on the side being asked about is not a candidate for "nearest" at all,
which is different from being infinitely far from the line.

**A line the change set does not carry can be anchored from the file itself**,
when the caller gives `addComment` a source to read it with
(`options.source`, a `FileSource`). The server does — it is how a comment on an
unchanged file opened in browse mode, or on a line `↑ N lines` brought in, is
written ([07-server.md](07-server.md)) — and so does the CLI's `comment`
([06-cli.md](06-cli.md)): an agent anchors a line outside the diff the way a
human does, by the amendment of 2026-09-23 to
[ADR-004](../adr/adr-004-agent-contract.md). A caller that passes no source
keeps the change set's refusal, which is what the domain alone does. The
fallback runs only on a
`line-not-in-diff` refusal, and the refusal stands whenever the file has
nothing to give: a file of the change set listed without content, a side whose
revision cannot be read — the `old` side of a repository the change set does
not have, which carries no base — and a file the source cannot read at all,
ignored or absent. `new` is read from the working tree and `old` — under the
name the base has the file by, the old path of a rename — from the
repository's resolved base.

The anchor has **the same shape**: `lineContent` is the line, `before` and
`after` up to three lines on each side of it, and `hunk` is the header git would
print for that window if it were a hunk of context — `@@ -2,7 +2,7 @@` for line
5 of an unchanged file. The other side's start is the anchored side's shifted
by what the hunks above the window added or took away, so line 20 on disk of a
file with two lines inserted at the top is `@@ -15,7 +17,7 @@`. A window that
starts inside a hunk — the line is just below one — starts in its trailing
context, after every change the hunk holds, so that hunk counts whole: new line 8
under `@@ -1,5 +1,7 @@` is `@@ -3,7 +5,7 @@`. A line past the end of the file is still `line-not-in-diff`,
naming how many lines the file has: the refusal stays for a line the file does
not have.

"Has no hunks in the change set" is kept for the file that really has none —
`hunks: []` with `omitted: null`, which a change set read without hunks and a
mode-only change both produce. Saying it about a file that is nothing but hunks
was a false statement about the file, and it named no side to retry on.

### Roles

`resolve` and `reopen` refuse any role but `human` and change nothing
([ADR-004](../adr/adr-004-agent-contract.md)). The check is here, not in the
shipped skills: a skill is advice, and an agent that never read it could still
close a thread. `resolve` sets `resolvedAt` and `resolvedBy` from the caller;
`reopen` clears both. A `note` on either is written into the thread as a reply
first — the on-disk format has no other place for it, and a status change with
an unexplained reason is worse than one with a message.

### Who chose the severity

A comment carries `severitySource` beside its `severity` (DA-36, `docs/SPEC.md`
section 7). `addComment` takes it as `auto` or `manual`, and without it stores
`manual`: the CLI's `comment` never passes it — an agent that names a severity
chose it — and the composer passes `auto` when the reviewer left the choice to
the model. `confirmed:<author>` is never written by `addComment`; the server's
`POST /api/comments` refuses it before the domain sees it.

`reply` with `confirmSeverity: true` is the one way to it. In the same locked
write that appends the reply, an `auto` becomes `confirmed:<author>` with the
reply's author. On anything else — a severity its writer chose, or one already
confirmed — it refuses with `severity-not-auto`, naming which of the two, and
writes nothing, the reply included. So does a confirmation with an empty author
(`invalid-author`): `confirmed:` with nobody after it is a value the parser of
`comments.json` refuses, and writing it would have made the whole session
unreadable to every later command. One command is one write, and a reply that
landed while its confirmation was refused would leave the agent reading a
success in the thread and a failure on its exit code. The check is in the
domain, not the skill, for the reason the role check is. It does not look at
the role: the marker names the author, and whoever it is, the label is theirs
to agree with.

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

"Worst" is the order of storage's `SEVERITIES` — worst first, `docs/SPEC.md`
section 3, decision 7 — and the domain reads that list rather than keeping one
of its own. Two lists of the same words drift the moment one of them gains a
fifth: the schema and the CLI would accept the new value while `worstSeverity`
returned `null` for a scope whose only open comment carried it, and every badge
of that scope would paint as carrying no finding.

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
  of sessions that will matter. The watcher reads every session's `review.json`
  on every burst of the data directory, for the same reason and at the same
  cost ([05-watcher.md](05-watcher.md)).
- The counters of `listSessions` are over the whole `comments.json` and not
  inside the scope. Nothing can write a comment outside a task's scope, so the
  two agree unless the file was edited by hand.
- Re-anchoring and the `orphaned` status (Phase 3). An anchor is captured once
  and never checked again, so a comment whose line has moved keeps the old
  text.
- Nothing re-reads `diff.json` while a comment is being written: the anchor is
  taken from the cache as it stood, so a scan that runs in between is not seen.

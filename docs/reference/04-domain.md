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
deleteSession(dataDir, name, { role }): Promise<{ current, moved }>
assertDeletable(dataDir, name, { role }): Promise<void>
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

`deleteSession` removes the session's directory and everything in it (DA-40).
It asks what `closeSession` asks, in the same order: a name that is not a
session is `no-such-session` before a role that is not `human` is
`role-not-human`, and both write nothing. Deleting is a human's gesture for the
reason closing is, and more so — nothing brings the directory back. The check
is `sessionExists`, not a read: a `review.json` broken by hand is still a
session, and deleting it is the one command that can make it go.
`assertDeletable` is those checks alone, for the CLI, which asks a person before
it deletes and must not ask a question whose answer would be refused.

**When the deleted session was current, `current` moves** to the session with
the latest `updatedAt` that is left — the one worked on last, which is what the
history lists first — or goes, when nothing is left, and the answer says which
(`moved`, `current`). One whose `review.json` cannot be read is passed over: a
pointer to a session nothing can read is a second problem handed to the next
command. `current` is written without a lock, so two deletes at once could leave
it naming the session the other one took; the delete therefore checks, after it
wrote the pointer, that the session named is still there, and chooses again
when it is not. The move follows the removal rather than preceding it: in the moment
between the two, `current` names a session that is not there, which every
reader already answers with `no-such-session`, where moving first and then
failing to delete would leave the pointer moved off a session that stayed.

**The embedding index is left to its reader.** `deleteSession` does not touch
`index/index.bin`: every reader brings the index up to date before it answers
([09-ml.md](09-ml.md#bringing-it-up-to-date)), the update reads the session
list, and a session that is not in it has its rows dropped and the file
rewritten. So no reader ever returns a deleted session's comments, and between
the delete and the next reader `index status` counts them as `gone`. Measured on
2026-09-24 with a function for an embedder (the drop embeds nothing, so the
model does not enter it), three runs each at load averages of 10–16: a data
directory of two sessions of 200 comments, one deleted — `deleteSession` 1.4–3.3
ms, the next reader's update 1.1–1.9 ms against 0.5–2.8 ms for an update that
found nothing new; two sessions of 5 000 — `deleteSession` 2.4–2.7 ms, the next
update 32.7–37.8 ms against 6.7–11.1 ms. A hook in the delete would have moved
the same rewrite into it and made the domain a second writer of a file only the
index module writes today, for a cost the next suggestion pays once.

`resolveSessionName` is the fallback every command of `docs/SPEC.md` section 8
shares: the session it was given, else the current one, else a refusal. It lives
here rather than in each command.

`readSession` turns a `review.json` that is not there into `no-such-session`,
and only that. A file that is there but cannot be read or parsed keeps the
`StorageError` naming the file and the field
([03-storage.md](03-storage.md#validation-and-errors)): "no review session
ls-240372" would send the reader looking for a session that is right there.

`listSessions` returns one row per session, most recently updated first, with
the counters the sessions menu shows (`docs/design/HANDOFF.md` section 7):

| Field | Where it comes from |
|---|---|
| `name`, `title`, `base`, `scope`, `status`, `createdAt`, `updatedAt` | `review.json` |
| `current` | whether `current` names it |
| `open`, `resolved` | `comments.json`, by status |
| `repositories` | repositories in `diff.json`, or `null` when nothing has been scanned |

`warnings` beside the sessions carries the directories under `reviews/` that are
not sessions, exactly as storage reported them. A session whose files are there
but broken is not passed over to keep the list going: the counters come from
files a person may edit, and the listing answers with the `StorageError` of the
read that hit the broken one, which names the file to fix.

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
it. A path is written the way `comments.json` writes one, relative and with
forward slashes, and one that leaves its repository is refused rather than
resolved: the scope decides what is read from a repository, and nothing may name
a file outside the one it belongs to. Whether a file has changes is never asked: a file in the scope with nothing
to show is kept by the task and left off the screen, which is decision 5 of the
ADR.

**Editing a scope.** `widenScope` only ever widens: adding a path to a
repository that is in as a whole changes nothing, because the whole already
holds it. `narrowScope` refuses what it cannot do rather than passing over it —
a repository or a path the scope does not have, and a path of a repository the
scope holds as a whole, since "everything but this file" is not an entry the
format has — and a remove that silently did nothing would read as one that
worked. An entry whose last path is removed goes with it, and a narrowing
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
the CLI flag: a line with two hundred ids on it answers nobody, and the CLI is
the contract it is written for. A caller that words its
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
need it and `comments.ts` already imports `scope.ts`. A task is closed by that
gesture and never by counting its comments (decision 3 of
[ADR-010](../adr/adr-010-review-task-scope.md)). The session is looked for
before the role is judged, the order `resolve` and `reopen` use, so a mistyped
name answers "no review session" rather than "only a human may close". Setting
a status that is already set writes nothing, so the moment a task was closed at stays the moment
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
reopen(dataDir, session, id, verdict, options?): Promise<Comment>
get(dataDir, session, id): Promise<Comment>
list(dataDir, session, filter?): Promise<Comment[]>
```

Every function of the module first checks that the session is there and
refuses with `no-such-session` when it is not. Without that one check a missing
session would get four answers to one question: an empty list from `list`,
`no-such-comment` from `get`, and two different refusals from `addComment`,
depending on the anchor level.

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
| `status` | `open` (orphaned ones included), `resolved`, `orphaned`, `all` — the domain's default is `all`; the CLI picks its own |
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

### Re-anchoring

```ts
reanchorRepositories(dataDir, session, moves, sources, { held?, deadline? }): Promise<Pass>
anchorWarnings(comments): ScanWarning[]
withAnchorWarnings(warnings, comments): ScanWarning[]
```

After code edits a line comment stays on its line (`docs/SPEC.md` section 5,
Phase 3; DA-42). A **move** is one repository's entry of the change set as
`diff.json` had it and as a write replaces it, `null` for no changes. The
comments of a session are anchored against the entries `diff.json` holds, so
**whoever replaces an entry moves the comments**: every writer of `diff.json` —
the watcher's rescan, the server's first read of a task, `diff`, `comment`,
`reopen`, anything that calls `refreshRepository` — writes through
`writeChangeSet` of `src/core/change-set.ts`
([02-git.md](02-git.md#writing-the-change-set)), which reads the entries it is
about to replace, **runs the pass against the new change set in memory and
writes the moved comments first, and only then writes `diff.json`**, all in the
same hold of the session's lock. The hold is what keeps two writers' passes in
the order of their writes, across processes: a pass run after the lock is let go
could meet a second writer's pass that already took this one's `after` for its
`before`. It is also what makes a pass cost the next writer its wait
([05-watcher.md](05-watcher.md#re-anchoring)). With no `diff.json` before the
write there is nothing to say where the lines were, and the first scan of a
session moves nothing.

**A pass that does not finish loses nothing.** For every repository whose
comments it did not all place — the pass failed on a git fault, `comments.json`
could not be read, or it ran out of time — the writer puts that repository's
**old entry** into the `diff.json` it writes, instead of the new one. The file
then still describes the tree those comments are on, and the next writer, whose
`before` it is, moves them. The comments of a repository are written only when
all of them were placed: half a repository is not written, and the next pass
starts it over. The pass has **10 s** of the hold (`PASS_BUDGET_MS`, a third of
the lock's 30 s lease, which is not renewed): past it no comment is started, the
repositories not reached are left the same way, and the lease is never at risk
of being taken over mid-pass. The rescan, `diff`, and the server read their
repositories outside the hold, so the 10 s is all the pass and the two writes
share it with. The cost of a repository left is a stale entry until the next
write: a rescan finds it different from the working tree and announces
`diff-changed` again, and `diff` warns
([06-cli.md](06-cli.md#comments)).

A pass places a `new`-side comment on a file whose entry changed, came or went,
and every comment of the repository once its resolved base moved. An `old`-side
comment is placed only when both entries name a base and the two differ: an
entry of `null` — no changes, before or after — or a base that did not resolve
names no sha, and without both there is nothing to say the base's text moved.
A base mode or a scope changed with `review base` or a scope edit is no reason
of its own to skip: each entry carries the sha it was read against, and the
steps below read each side by its own. An orphaned comment is not placed at all.

Each comment goes through three steps, and the first one that answers wins:

1. **In place.** The anchored line and its three lines each way read exactly
   where the comment is: it stays, and nothing else is asked. This comes first so
   that blame, answering about a history the comment may not have been placed
   on, cannot move a comment that is right onto a copy of its line — `}` closes
   two functions of the test's file, and a comment on the first stays on it.
2. **Blame.** A line the base has is followed through git's own history
   (`blameFrom`, [02-git.md](02-git.md#blame)), and only when the tree the move
   starts from is the tree the comment was put on: that tree — the base with the
   entry's hunks laid over it (`newSideOf`), or the base itself for the old side
   — must read the anchor's seven lines exactly at the comment's line. A comment
   written from a `diff.json` older than its file fails that and skips blame. The
   comment's line is taken back to a base line through the entry (a line in a
   hunk by its `oldLine`, one outside every hunk by the shift of the hunks above
   it; an inserted line has none and skips the step), and blame says where that
   line is now. The landing is taken only when it reads exactly as the anchor's
   `lineContent` and the mean similarity of the six lines around it to the
   anchor's is at least **0.5** (`BLAME_CONTEXT`): an ignore-revs file, or a
   block moved with `-M`, can attribute a line to a place the comment never was,
   and the two checks make that a fall-through to the text rather than a move.
3. **The text.** Every line of the file now is scored against the anchor:
   `similarity` is one less the edit distance over the longer line, with
   indentation and runs of spaces collapsed; a line under **0.6**
   (`LINE_SIMILARITY`) is not a candidate however well its context agrees, and a
   candidate scores `0.7 × its own similarity + 0.3 × the mean similarity of the
   three lines before and after it` against the anchor's `before` and `after`. The
   best candidate is taken when it scores at least **0.7** (`MATCH_SCORE`) and
   no other comes within **0.1** (`MATCH_MARGIN`) of it.

The thresholds were set by the cases `tests/reanchor.test.ts` holds, one test
each: a line with one token changed (`total(items)` to `sum(items)`, 0.81)
follows; a line re-indented follows; a line rewritten into another statement
(`const gross = total(items);` to `throw new Error(…)`, 0.32) is orphaned
though its six neighbours are untouched; so is `const cost = count(rows);`
at 0.59, which its untouched neighbours would lift to a score of 0.72 — the
line's own threshold is what refuses it; a line with one token changed and
every neighbour rewritten scores 0.57 and is orphaned, since nothing then says
it is the same line; the same line with every neighbour
rewritten still follows when it is the only such line (it scores 0.70: the
line's own weight is the threshold, so an unchanged line that is unique is
always found); two copies of the whole window are refused; and one copy with its
context and one without are told apart by the context. A closing `  }` whose
neighbours were all rewritten is the case blame is for: its text is on a dozen
lines, the context of none agrees, and only blame knows which it is — the test
with blame answering nothing orphans it. `BLAME_CONTEXT` sits under what that
case scores and over what a blame told to land on another function's `}`
scores; the test with such a blame keeps the comment where the text puts it.

**A renamed file carries its comments.** When the entry after names the
comment's file by another path — `git mv`, which git's diff reports as a rename —
the comment's `path` becomes the new one and its line is placed in that file.
Blame of a path HEAD does not have is git's refusal, so a rename not yet
committed is placed by the text. A plain `mv` is not a rename to git: the old
path is a deleted tracked file and the new one an untracked addition, the two
never paired, so the comment is orphaned as on a deleted file. Following it
would be rename detection of the tool's own (DA-42.5).

**When the file cannot be read.** The comment is orphaned only when the change
set after the write says the file is deleted, or when the file reads and none of
the steps finds the line. A file that does not read while the change set still
lists it — too large, binary — or that is absent without the change set saying
so — an added file stashed away, a save caught between the rename and the
write — is left as it is for this pass, and the next write that sees it places
it. An added file that is deleted from disk looks the same as one stashed, so
its comments stay where they are until a human resolves them. On the old side,
a file the new base does not have is orphaned, and one it lists without content
is left.

**A range** keeps its length when the lines of the range, as the tree it was put
on had them, read the same at the new start; one that did not move keeps its end
while nothing known of it says otherwise. Otherwise its last line is placed on
its own, by the same three steps, anchored on that tree's window around it and
searched between the new start and as far as the file's growth could have pushed
it — a line inserted inside a range grows it. When the end cannot be placed, the
range is narrowed to the longest run from its start that still reads the same,
and to the start line alone when that is all. Without the tree, what the anchor
itself kept — the line and up to three after it — is all that says what the range
read, so a longer range whose tree is unknown is narrowed to what that proves.

A comment found moves: `path` and `line` are the place found, `endLine` as
above, and the anchor is **captured again** there — from the change set after
the move when it carries that line as the file reads it, otherwise from the file
— so the next pass matches against the context the line has now. **Nothing is
written when nothing but the anchor's `hunk` would change**: an edit elsewhere in
the hunk moves its header and not the comment, and a write for it would bump
`updatedAt` and wake every window for nothing. A pass that places nothing
writes nothing at all.

**A comment not found is `orphaned` and keeps everything else**: its `line`,
`endLine` and `anchor` stay what they were, so the lost text is still there to
show and to match a human's choice against. Only an **open** comment becomes
orphaned. Two things are what the tool does today and **wait for the owner**
(DA-42.4), and neither is a requirement of `docs/SPEC.md`: an orphaned comment
is never placed again by a pass, even when its text comes back where it was; and
a resolved thread whose line is gone stays resolved where it was.

**How an orphaned comment comes back is pending the owner** (DA-42.4); what the
tool does today is this. `reopen` is a human's (`docs/SPEC.md` section 3,
decision 8), and **any human `reopen` of a line comment reads its repository
again first** — the CLI's with or without `--line`, and the server's route,
which does it for a task the watcher does not follow too — so the rewrite of
`diff.json` has moved the comments before the one reopened is judged.
`reopen` with a `line` captures the anchor at that line the way `addComment`
does, opens the comment there, and refuses a comment that is not on a line
(`invalid-anchor`). **`reopen` without a line reopens a line comment as `open`
where its anchor still reads at its line, and as `orphaned` where it does not**
— kept, counted as open, waiting for a `reopen` with a line: an orphaned comment
whose text is not back, a thread orphaned and then resolved, or one resolved and
then left behind by an edit, since a pass does not move a resolved thread it
cannot place. "Reads" is the text step's answer at the stored line. The check
reads the file through the caller's source, which the CLI and the server both
pass; without one — a caller of the domain alone — nothing new is known, and an
orphaned comment stays orphaned while any other opens.

`anchorWarnings(comments)` is one warning per repository holding orphaned
comments, shaped as a scan's warnings are: `{ path: <repo>, message: "2
comments lost their anchor" }` (`1 comment lost its anchor`), shown as the UI
and `diff` show every warning, the path first. It is not stored: `diff.json`
keeps the scan's own list, and `withAnchorWarnings` adds these on the way out —
in the server's review document, in `diff`, and in the watcher's `warnings`
frame — because the count changes with `comments.json`, which the scan never
reads, and with a `reopen` that no scan follows.

### Roles

`resolve` and `reopen` refuse any role but `human` and change nothing
([ADR-004](../adr/adr-004-agent-contract.md)). The check is here, not in the
shipped skills: a skill is advice, and an agent that never read it could still
close a thread. `resolve` sets `resolvedAt` and `resolvedBy` from the caller;
`reopen` clears both. `reopen` with a `line` also moves a line comment there
first ([Re-anchoring](#re-anchoring)); without one, a line comment whose anchor
no longer reads at its line reopens as `orphaned`. A `note` on either is written into the thread as a reply
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
| `open` | `isOpen`: status `open` or `orphaned` |
| `unanswered` | an **open** comment whose last message is from a human: no agent has answered |
| `awaiting` | an **open** comment whose last message is from an agent: nobody has verified it |

**An orphaned comment is open** wherever `docs/SPEC.md` counts or lists open
comments (section 3, decision 8): it is a finding nobody has closed whose line
was lost, not one that went away. So it is in the counters' `open`, in
`unanswered` and `awaiting`, in the severity a scope is painted with, in the
default `list` and `list --unanswered`, and in the default export, where its
line says `· orphaned`; its own `status` is how a reader tells it apart.

The last message of a thread is its last reply, or the comment itself when
there are none. A resolved thread is neither.

`countReview(comments)` gives the counters of the whole review, of every
repository that carries comments, and of every file inside them: `total`,
`open`, `resolved`, `unanswered`, `awaiting`, and `severity`. How many of the
open ones are orphaned has no counter of its own yet (DA-42.2). `severity` is the worst
severity **among the open comments** of that scope, `null` when none is open. A
critical finding a human has already closed does not keep the file red.
Repositories and files come sorted by name, by code point, so two calls on the
same comments give the same order.

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
are the same function over different lists. The UI's `raw` tab shows exactly
this text and `Copy .md` copies it, so it is the export and not a rendering of
one ([08-ui.md](08-ui.md)).

Inside a section the comments are ordered by path and then line, by code point
and never by locale: the export ships from `npx` on Node and from a Bun binary,
and `localeCompare` would order the same review differently in the two,
depending on the machine's ICU data. A reply is quoted line by line rather than
by paragraph, because a `>` on the first line only drops everything after a
blank line out of the quote.

**The base line deviates from the design on purpose.**
`docs/design/HANDOFF.md` section 9 shows the meta line as `base origin/main` —
the branch name alone. The export writes the argument that produces the base
instead: `head`, `branch`, `branch:origin/develop`, or a ref. A bare branch
name cannot say which of the three modes the review used, and `head` and a ref
have no branch name to print; the argument form says both, and it is the form a
reader can paste back into `review base`.

## What it does not do yet

- The counters are read on every `listSessions` call: every session's
  `comments.json` and `diff.json` are opened. On a data directory with hundreds
  of sessions that will matter. The watcher reads every session's `review.json`
  on every burst of the data directory, for the same reason and at the same
  cost ([05-watcher.md](05-watcher.md)).
- The counters of `listSessions` are over the whole `comments.json` and not
  inside the scope. Nothing can write a comment outside a task's scope, so the
  two agree unless the file was edited by hand.
- The third step of re-anchoring, a model's proposal a human confirms, and the
  orphaned card of the UI (DA-43). Until then an orphaned comment is placed
  again only by `reopen --line`.
- An edit made while nothing rewrites `diff.json` — no server running, and no
  `diff` or `comment` since — moves no comment until something does; then the
  write that replaces the entry places them against the tree it replaced.
- A comment written against a `diff.json` older than its file anchors to text
  the file may not have had; the check that the tree before is the tree the
  comment was put on turns that into the text step rather than a wrong move.
- A plain `mv` is not followed (DA-42.5).
- Nothing re-reads `diff.json` while a comment is being written: the anchor is
  taken from the cache as it stood, so a scan that runs in between is not seen.

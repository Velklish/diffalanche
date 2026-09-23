# 07 · Server

`src/server` serves the review to the UI: one document with everything the
review needs, the sessions, the settings, the scan, and the built page. It is a
Hono app over the configuration and the core, running natively on Bun and on
Node through `@hono/node-server` ([ADR-002](../adr/adr-002-stack-and-delivery.md)).

## Starting it

```ts
const server = await startReviewServer({ config, ui, verbose });
// { url: "http://127.0.0.1:4880", port: 4880, review, close }
```

`config` is the loaded `Config` ([03-storage.md](03-storage.md)); `ui` is where
the built page comes from, and without it the page is a 404 naming the command
that builds it; `verbose` turns on request logging; `recursive: false` makes the
watcher walk the reviewed trees instead of watching them, for a filesystem whose
notifications cannot be trusted ([05-watcher.md](05-watcher.md)). `close()` stops the watcher
and the socket.

Starting does four things before the socket opens: it creates the data directory
if it is not there, scans the root, starts the watcher of
[05-watcher.md](05-watcher.md), and has the watcher read the change set of the
current session from the working tree into `diff.json`, which the first document
is built from. The watcher comes before that read, because it is the watcher
that says which session's cache may be trusted, and the read goes through the
watcher's queue so a rescan cannot overwrite it
([The review document](#the-review-document)). A root with no current session
skips the last: the server starts anyway, and `GET /api/review` is what says
so.

The server listens on `127.0.0.1` and nowhere else. There is no host to pass and
no flag that changes it (`docs/SPEC.md` section 11). A port that is taken, and a
port this user may not have, are each refused with the sentence that names it,
as a `ListenError`:

```
port 4880 is already in use: stop the diffalanche that holds it, or run with --port <n>
port 80 is not allowed for this user: run with --port <n> above 1023
```

`ListenError` is a refusal and not a fault, so `diffalanche serve` prints it as
one line with the `diffalanche: ` prefix of every other refusal and exits 1
([06-cli.md](06-cli.md)):

```
diffalanche: port 4880 is already in use: stop the diffalanche that holds it, or run with --port <n>
```

Any other errno from the socket is rethrown as it is and keeps the stack trace
and exit code 2: those two sentences are the whole of what this file words, and
an `EPERM` is exactly what the tool did not expect.

**Which of the two a privileged port gets depends on the runtime.** Binding port
1 as an ordinary user is `EACCES` under Node and `EADDRINUSE` under Bun, so the
same command answers "is not allowed for this user" on one channel and "is
already in use" on the other. Both are a `ListenError` and both exit 1; the
errno is the runtime's and is not translated.

With `--verbose` every request is one line on stderr — method, path, status,
duration. Without it the server writes nothing but its own failures.

### Which host it answers for

Binding to `127.0.0.1` keeps the socket off the network; it does not say who may
talk to it. A page on `attacker.example` can have that name rebound to
`127.0.0.1` after it loads and then fetch `http://attacker.example:4880/api/…`:
the browser calls that same-origin, so there is no preflight and no CORS in the
way, and the connection lands on the loopback socket like any other.

So **every request under `/api/` names the host it arrived on, and the server
answers only for its own**. The names are two, `127.0.0.1` and `localhost`, as
the URL parser normalises them: `127.1` and `0x7f000001` are the first one
written differently and pass, `attacker.example` does not. Anything else is a
`403` `error: "forbidden"` naming the host it turned down and the names it
takes, on a read as much as on a write — what is behind these routes is the
absolute root path and the patch of every changed file, which a rebinding page
reads with a `GET`.

`::1` is not one of the names. The socket binds `127.0.0.1`
([runtime.ts](../../src/server/runtime.ts)), so nothing arrives over IPv6 at
all; and the URL parser gives `[::1]` for the IPv6 loopback, brackets included,
so a set holding the bare `::1` would never have matched anything either way.
The set follows what the socket binds, and both change together.

That is the check that stops rebinding, because a rebinding page has to send its
own name here — and it is the check the origin comparison below rests on. The
built page is not behind it: `/` and the assets are the same bytes for everyone
and say nothing about the review.

Only the name is compared, not the port. The port is not what a rebinding page
controls: a request reached this server at all because it dialled the port the
socket is on, and a browser copies into `Host` the authority it dialled. A
second diffalanche on another port is a different origin, and that is the origin
guard's question rather than this one's.

There is no allow-list and no flag: serving on another interface is not a thing
the tool does (`docs/SPEC.md` section 11), so the set of names is fixed in the
code.

**A `Host` that is not a host, and no `Host` at all, are the runtime's answer
before they are ours** — and the two runtimes differ. Measured with raw HTTP
against `serve` on an empty root, one request per line:

| The request | Node | Bun |
|---|---|---|
| `HTTP/1.1` with no `Host` | `400`, from the HTTP parser | `400`, from the HTTP parser |
| `Host: exa mple` | `400`, from the parser, before Hono | `403`, ours |
| `Host: attacker.example:<port>` | `403`, ours | `403`, ours |
| `Host: 127.0.0.1:<port>` | `200` | `200` |
| `HTTP/1.0` with no `Host` | `200` — the adapter fills in a loopback name | `500` |

So the guard's own "not a host at all" branch is reached under Bun and not under
Node, where the adapter has already refused; and an `HTTP/1.0` request with no
`Host` passes under Node. Neither is a way in for a rebinding page: a browser
speaks `HTTP/1.1` and always sends `Host`. What reaches these two rows is a
client written by hand, which is `curl` and the CLI — the callers the check is
meant to let through. The `HTTP/1.0` `500` under Bun is not this check's: the
base commit answers the same before the guard exists.

## Routes

Every route a window uses takes `?review=<name>` — **reading and writing
alike** — and answers for the current session without it. See
[The task a request is about](#the-task-a-request-is-about).

| Route | What it answers |
|---|---|
| `GET /api/review[?review=<name>]` | the review document: the change set, the session, its comments and counters; without the parameter, of the current session |
| `GET /api/sessions` | every review session with its counters, its scope, and its status, most recently updated first |
| `GET /api/sessions/candidates[?review=]` | the change set of the whole root, the task's scope ignored and its base kept |
| `GET /api/config` | `{ user, port }` — what the UI signs comments with, and where it is |
| `GET /api/scan` | every repository under the root, with whether it has changes |
| `GET /api/repos/branches` | every branch of the root, for the base picker |
| `GET /api/events` | the live stream: what the watcher noticed, as it happens |
| `GET /api/repos/:repo/diff[?review=]` | one repository of the change set |
| `GET /api/comments/:id[?review=]` | one thread |
| `GET /api/warnings[?review=]` | the warnings of the change set |
| `GET /api/activity` | the feed of what the server noticed while it has been running |
| `GET /api/export?status=&format=[&review=]` | the export of a session |
| `POST /api/comments[?review=]` | a new comment; the updated comment comes back |
| `POST /api/comments/:id/replies[?review=]` | a reply in a thread |
| `POST /api/comments/:id/resolve`, `/reopen` `[?review=]` | the status of a thread |
| `POST /api/sessions` | a new review session, with a scope and with or without becoming current |
| `POST /api/sessions/:name/use` | make a session current |
| `PUT /api/sessions/:name/base` | change the base of a session |
| `PUT /api/sessions/:name/scope` | replace the scope of a session |
| `POST /api/sessions/:name/close`, `/reopen` | the status of a review task |
| anything else | a file of the built UI, or `index.html` |

An unknown path under `/api` is a 404 saying so rather than the page: the UI
routes in the browser, so every other path is `index.html`.

### The review document

`ReviewDocument` is defined once, in
[`src/core/types.ts`](../../src/core/types.ts), and the UI imports it from
there. That file has to stay a leaf of pure types: `src/ui/tsconfig.json`
compiles the UI with `"types": []` — no Node globals in the browser bundle — and
it type-checks `src/core/types.ts` through the UI's own imports, so nothing in
that file's import graph may reach a module that uses the Node API.

```json
{
  "root": "/abs/path",
  "repositories": [
    {
      "path": "group/service-api",
      "branch": "main",
      "base": { "mode": "head", "ref": "HEAD", "sha": "…" },
      "files": [
        { "path": "src/a.ts", "oldPath": null, "status": "modified",
          "additions": 12, "deletions": 3, "patch": "diff --git …",
          "hunks": [], "omitted": null }
      ],
      "warnings": []
    }
  ],
  "totals": { "repositories": 21, "files": 300, "lines": 30000 },
  "warnings": [{ "path": "repos/closed", "message": "directory cannot be read: EACCES" }],
  "session": { "version": 2, "name": "ls-240372", "base": { "mode": "head" },
               "scope": null, "status": "open", "…": "…" },
  "comments": [],
  "counters": { "counters": { "open": 3, "…": "…" }, "repositories": [] }
}
```

Repositories without changes are left out. `hunks` is always empty here: the
renderer reads `patch`, and carrying the structured lines as well costs more CPU
per scrolled frame than the budget of `docs/SPEC.md` section 6 has
([ADR-008](../adr/adr-008-diff-rendering-verdict.md)). The hunks live in
`diff.json`, where anchor capture reads them ([04-domain.md](04-domain.md)).

The change set comes from `diff.json`; without one — or with one computed
against a base or for a scope that is no longer the session's — the server reads
every repository of the scope and writes it. A document is built once per
session and serialised once per change — the review is megabytes, and
re-serialising it per request would charge every reload for it.

**A cache that matches on base and scope is not thereby fresh.** `sameBase` and
`sameScope` say that `diff.json` answers the same *question* the session is
asking; neither says it holds the current *answer*, and the working tree moves
under it while nothing compares the two. The only thing that refreshes a change
set is the watcher, and the watcher rescans one session — the current one
([05-watcher.md](05-watcher.md)). So the server trusts `diff.json` for the
session the watcher follows and reads the working tree for every other one. The
cost of opening a task is its scope's repositories rather than the root's, and
the read is written back, so anchor capture reads a file that says what the
screen says ([04-domain.md](04-domain.md)).

**Nor is the followed session's cache fresh when the server starts.** The
exemption holds while the server runs, because only then is the watcher
rewriting that cache; while no server ran, nothing did, and the working tree
moved freely under it — an edit, a commit, a branch switch. So the first
document of a server's lifetime is not built from it: before the socket opens,
`serve` has the watcher read the current session's scope once from the working
tree (`refresh`, [05-watcher.md](05-watcher.md)) and builds the first document
from what that hands over. It is queued like a rescan, so an edit made while it
runs is read after it rather than overwritten by it. The cost is the scope's
repositories, once per `serve`, including the starts where nothing changed; a
task over two repositories of twenty-one reads two, which
`tests/scope-scan.test.ts` counts in processes. The socket stays closed until
that read is done, so **the price grows with the number of repositories in the
scope**. Measured on the synthetic review, whose session has no scope — all
twenty-one repositories — on 2026-09-23 on the 8-core machine this was written
on, under a load average of 21–23 (busy, so an upper bound rather than a
budget), two sets of five starts each: `startReviewServer` to a listening socket
took a median of 552 and 489 ms, against 39 ms for the build before this one,
which trusted the cache; the read itself was 446 and 508 ms of that.

The two cheaper answers were weighed and left. Trusting the cache until the first
rescan repairs it is wrong for as long as nobody touches the affected repository
— on a repository the person has stopped working in, indefinitely. Comparing the
base `sha` each repository records with what `git rev-parse` says now costs one
process per repository instead of five, and catches a commit or a branch switch
but not an uncommitted edit, which is the common case.

**A session that becomes the followed one while the server runs is not covered
by this.** `review use` moves `current`, the watcher follows the new session from
then on, and that session's `diff.json` is trusted from the moment it is
followed — though it was last refreshed when it was last followed or last read
as a named task, and a repository of it may have moved in between. That is
DA-55.6.

**What a rescan does to a document that is not there.** The watcher hands the
change set over *before* it writes `diff.json` — an update the person is waiting
for must not wait for a file of megabytes ([05-watcher.md](05-watcher.md)) — so
between the two there is a moment when memory is newer than the file. `adopt`
therefore records the change set on that session whether or not a document is
held for it to patch, and its answer says which of the two happened; a build
that started before that moment takes the recorded change set on its way out
instead of installing what it read from the file. **After a rescan of the
followed session, the next read of that session's document carries that
rescan** — with the document held, with it cold, and with a build in flight.
An invalidation drops the document and its bytes and leaves the recorded change
set alone: a write to the data directory is not a change of the working tree.

That recorded change set is **the followed session's and no other's**. The
watcher rescans one session, so a cache it handed over is about the session it
was following at the time; once `current` moves on, what it holds is as frozen
as the file, and it is dropped rather than served. Both doors are the same rule:
a build consults it only when it is building the followed session, and so does
the reconciliation on the way out.

### Keeping a held document honest

A held document's change set ages, because only the followed session's is
refreshed by a rescan. Two different things can make it wrong, and only one of
them has a signal today.

**The working tree moved.** The watcher reports every repository that moved,
whatever the current task is about ([05-watcher.md](05-watcher.md)) — its change
set where the current task's scope covers it, its files where it does not — and
the server drops every held document whose task could show that repository,
decided from the scope the document already carries with no disk read. The
followed session is passed over, because the rescan patches it in place. So a
window reloaded after the code changed builds again and shows the change; a
window on a task the change cannot appear in keeps its document and its warm
switch.

A document still **being built** has no scope to be judged by yet, so the names
signalled during the build are kept and the question is asked when it resolves,
against the scope the built document carries. Without that a write anywhere in
the root would discard a build in flight, and a task under continuous unrelated
writes would never hold a document at all — which is the opposite of what
holding one is for.

**The task's own `review.json` changed** — `review base --review X` from a
terminal, say. The watcher compares the metadata of every session a window is
open on, so `session-changed` arrives naming X and that document is dropped. It
is the second half of what a held document needs, and it is why a task with no
window on it is not followed: nothing would read the result.

**A comment write is neither.** `POST /api/comments` and the three routes beside
it re-read the comments of that session and keep its change set, because a
comment does not move the working tree. The document then carries the
`session.updatedAt` of the moment it was built — the same thing the watcher's own
metadata comparison leaves out, and for the same reason: a write bumps
`updatedAt` without changing what the review *is*.

### How many documents are held

`DOCUMENT_CACHE_LIMIT` is four. A document is megabytes and so is the string
beside it, so the server keeps a few and drops the least recently asked-for,
passing over one with a build in flight. Holding one per session is what makes a
switch back to a session the server has already built cost nothing on the server
([11-perf.md](11-perf.md)). `POST /api/sessions/:name/use` invalidates nothing:
moving `current` changes which document a request without `?review=` resolves
to, not what any document says, and the watcher announces it as `current-changed`
— which drops no document, precisely because nothing about that session changed
([05-watcher.md](05-watcher.md)). Every other write names the session it changed,
and only that session's document is dropped.

`warnings` is everything the scan and the reads had to say — `ScanWarning[]`,
the directories that could not be read and the bases that did not resolve
([01-scanner.md](01-scanner.md), [02-git.md](02-git.md)). Under a scope they are
the warnings of the walk, which covers the whole root, plus those of reading the
repositories of the task — a repository the task is not about is not read, so it
has nothing to say — plus one naming a scope entry the walk found no repository
for.

`?review=<name>` answers with the document of that session instead of the
current one: the address `review new --no-use` prints, so a window can open a
task without becoming it ([ADR-010](../adr/adr-010-review-task-scope.md)). Its
document is held like any other, and its change set is read from the working
tree when it is built, because the watcher refreshes no task but the current
one.

### The task a request is about

`?review=<name>` is not the review document's alone. **Every route a window
uses carries it, and the writes carry it too**: `GET /api/comments/:id`,
`GET /api/warnings`, `GET /api/repos/:repo/diff`, `GET /api/export`,
`POST /api/comments`, `POST /api/comments/:id/replies`, and
`POST /api/comments/:id/resolve` and `/reopen`. Without the parameter every one
of them answers for `current`, which is what it always did and what a human
typing a command by hand gets.

The reason is the decision that there is no main task
([ADR-010](../adr/adr-010-review-task-scope.md), decision 7): a window opened on
a task stays on it while `current` names something else, and only `review use`
moves `current`. A window that *read* one task and *wrote* into another would
put a person's comment in a file nothing they can see reads back — the loss
product principle 5 is about — and would patch the screen of one task with the
change set of another when the stream woke. So the name travels with the
request, and `ReviewService.repository()` takes it as well: the repository a
live update fetches is the repository of *that* task's change set.

**`GET /api/repos/:repo/diff?review=<name>` reads git rather than that task's
cache.** The current session's repository comes out of the document the watcher
keeps fresh; a named task's cannot, because the watcher rescans and rewrites
`diff.json` for the current session only ([05-watcher.md](05-watcher.md)), so a
task that is not current holds a change set frozen at the moment it was last
read. Answered from that cache, a live update patched the page with the diff of
a minute ago: the card of an edited file never showed the edit, three times out
of three on the synthetic review, while the same event on the current session
showed it every time. So the route reads the one repository the event names —
five git processes, what the watcher pays for the current session anyway, and
not the whole scope's — and filters it by the task's scope. Measured end to end
on the synthetic review, from the edit to the frame that showed it: 295 ms for a
window on a named task against 235 ms for one on the current session, inside the
300 ms budget of `docs/SPEC.md` section 6 and close to it.

**The path is checked to be under the root before any git process starts.** It
comes from the URL and goes to a `join` against the root, and the scope is not a
containment check — a task created without `--scope` is about the whole root and
lets every string through. Hono decodes the segment before the route sees it, so
`%2e%2e%2f` and `..%2F` arrive as `../` where a literal `../` would have been
normalised away in routing; without a check they read any git working tree the
person can read and come back with the `patch` of every changed file in it.

The check is a **path** one: resolve the path against the root and require it to
stay below it. The alternative — reusing `findRepositories(config)` the way
`POST /api/comments` does — is exact but walks the root on a route the live
stream calls on every event, and the route is on the live path. What a path
check lets through is a path inside the root that is not a repository, which the
route already answers: no base resolves, no files come back, and that is the
404 below. It compares paths and does not resolve symlinks, so a symlink inside
the root that points out of it is still followed
([DA-73](../archive/DA-73-untracked-files-are-read-through-symlinks/task.md)
is the entry about reading through symlinks).

The refusal is the answer the route already gives — `404` with
`error: "no-such-repository"` — rather than a code of its own: from outside, a
path that leaves the root and a path the change set does not have are the same
answer, and telling them apart would say which encodings got through.

The *document* of a named task is not served from that cache either:
`GET /api/review?review=<name>` builds it from a read of the scope's
repositories, so a window opened after the code changed shows the change it was
opened to see. That read is paid once per session for as long as the document is
held, and the document is held only until a repository it could show changes —
see [Keeping a held document honest](#keeping-a-held-document-honest).

The routes that name their session in the path — `PUT /api/sessions/:name/base`,
`/scope`, `POST /api/sessions/:name/close`, `/reopen`, `/use` — need no
parameter, and two answers are about no session at all: `GET /api/scan` and
`GET /api/sessions`. `GET /api/sessions/candidates` used to be the third and is
not: its list is the whole root, but the base it is read against is a task's.

**A window on any task hears about that task's comments**, because the watcher
follows the tasks windows are open on rather than `current` alone
([05-watcher.md](05-watcher.md)). The set comes from the live streams:
`GET /api/events?review=<name>` carries the task its window is on, and
`EventStream.sessions()` is the distinct names of the open connections.

**That parameter is a registry, not a filter.** The frames stay one broadcast
with one sequence of ids and `Last-Event-ID` is untouched; it tells the server
only which tasks have windows, so the watcher knows whose comments to read.
Filtering is the client's, by the session name the frame carries. The two
mechanisms look alike and are not the same one, and a per-connection filter was
rejected for a concrete reason: the ring and its ids are one per server
([The live stream](#the-live-stream)), so filtering per connection would make a
client's ids non-contiguous and leave "what did I miss" unanswerable from one
ring.

A change to a task's own `review.json` now reaches its window too: the metadata
of every followed session is compared each burst, and `session-changed` names the
session it is about.

### The candidates

`GET /api/sessions/candidates` is the change set of the **whole** root, whatever
the session is *about* — the scope editor has to offer what the task is not about
yet — but read against **that task's base**. The scope is ignored and the base is
not: a picker showing a change set computed against another task's base would
offer files the task will never display, and would hide files it does. So the
route takes `?review=` like every other read of the page, and without it answers
for `current` as before. It is the third route that reads git per request, and it carries names
rather than diffs — no `patch`, no `hunks` — because a picker shows paths and
the diff of a whole root is megabytes.

```json
{
  "root": "/abs/path",
  "repositories": [
    { "path": "repos/core/cargos-api", "branch": "main",
      "files": [{ "path": "app/route/route_94.py", "oldPath": null,
                  "status": "modified", "additions": 12, "deletions": 3 }] }
  ],
  "warnings": []
}
```

A repository with nothing to show is not part of a change set, here as
everywhere else.

### The scan

`GET /api/scan` is the one route that reads git per request: it lists every
repository the scan finds, with its branch, its kind, and whether it has
anything to review, and it exists for the screen shown before there is a session
— when there is no change set to answer from.

```json
{
  "root": "/abs/path",
  "repositories": [
    { "path": "repos/core/cargos-api", "kind": "repo", "branch": "main",
      "hasChanges": true, "files": 7 }
  ],
  "warnings": []
}
```

### The branches

`GET /api/repos/branches` is the other route that reads git per request, and it
exists for the base picker (`docs/design/HANDOFF.md` section 5). A base is one
spec per review session applied to every repository separately
(`docs/SPEC.md` section 3, decision 4), so what the picker needs is not one
repository's branches but the union of them:

```json
{
  "root": "/abs/path",
  "branches": [
    { "name": "origin/main", "remote": "origin", "repositories": 21, "default": true },
    { "name": "main", "remote": null, "repositories": 21, "default": false }
  ],
  "warnings": [{ "path": "repos/closed", "message": "branches could not be read" }]
}
```

`name` is what `branch:<name>` takes, read by the domain's own parser, so the
picker and the CLI have one grammar for a base. `remote` is the remote a branch
belongs to and `null` for a local one; `repositories` is how many repositories of
the root resolve that branch, which is what the picker's note says, and `default`
means some repository's remote points its `HEAD` at it. The order is the default
branches, then the ones most repositories have, then the name by code point —
the same order under Node and under Bun.

One `git for-each-ref` per repository over `refs/heads` and `refs/remotes` reads
all of it. The full ref name is what tells a local branch from a remote one, and
`%(symref:short)` is what tells `origin/HEAD` — the pointer, which is not a
branch and is not listed — from a branch, while naming the branch it points at.
A repository whose refs cannot be read is a warning and not a failure; the
review has other repositories.

### Refusals

Every refusal is the domain's own code and message
([04-domain.md](04-domain.md)):

```json
{ "error": "no-current-session", "message": "no current review session: create one with `review new` or name one with --review" }
```

| Code | Status |
|---|---|
| `no-current-session`, `no-such-session`, `no-such-comment` | 404 |
| `scope-has-comments` | 409, with `count` and `comments` beside the message |
| every other `DomainError` | 400 |
| a file of the data directory that cannot be read | 500, `error: "storage"` |

The 409 is the one refusal that is neither "there is nothing here" nor "that
request is wrong": the request is well formed and the state says no, and what it
needs is a decision. Its body carries the count and the ids on top of the
message, so the scope editor words its own question — "delete 3 comments?" —
rather than showing a message written for the CLI
([04-domain.md](04-domain.md)).

A `comments.json` that is not JSON, a `review.json` of another schema version, a
`current` holding a path rather than a name: all of those are the 500, with the
file and the field the storage named. The server starts anyway — the change set
is read at start-up as a warm-up, not as a gate, because a server that refused
to start would leave the person with no way to see why.

`GET /api/review` on a root with no current session is the first of those: the
first-run screen reads that 404 and offers to create a session, while
`GET /api/sessions` answers with an empty list and `GET /api/scan` with the
repositories it found.


## The live stream

`GET /api/events` is Server-Sent Events
([ADR-005](../adr/adr-005-live-update.md)): updates flow one way, and the
browser fetches what an event names rather than being sent it.

| Event | Data |
|---|---|
| `diff-changed` | `{ type, repo, files }` — `files` are the paths that woke the watcher |
| `comment-added` | `{ type, session, id }` — `session` is the task the thread belongs to |
| `reply-added` | `{ type, session, id, commentId }` — `id` is the reply |
| `comment-status` | `{ type, session, id }` |
| `session-changed` | `{ type, name }` — the base, title, name, scope or status of a followed session changed |
| `current-changed` | `{ type, name }` — the `current` pointer moved to this session |
| `sessions-changed` | `{ type, name, status }` — a review task appeared, or a task's status changed |
| `warnings` | `{ type, list }` |
| `activity` | `{ id, verb, author, repo, path, at }` — one line of the feed |
| `reload` | `{ type, reason }` — read the review again; see below |

Every frame carries the name, an id that counts up from one, and the whole event
as its JSON, `type` included, so a client can listen by name or read them all
off one handler. A frame is kept in a ring of the last two hundred: a client
that reconnects sends `Last-Event-ID` and gets what it missed instead of
reloading the review. A client that is new gets the live frames only — the
review it just loaded is the state everything before that id led to.

A client the ring can no longer reach back to gets one `reload` frame and
nothing else. Half a replay is worse than none: the events that would have
brought it up to date are gone, so what it holds cannot be repaired event by
event, and the only honest answer is to read `GET /api/review` again. The frame
carries the newest id, so the stream continues from there. A `Last-Event-ID`
ahead of every id the server has is the same answer — that is what a browser
holding the ids of a server that has since restarted looks like.

The stream opens with a comment line of its own, `: connected`, before the
replay and before anything else. A response head is not on the wire until
something is written into the body, so without it a client cannot tell a stream
that is up from one that is still being made: `EventSource` fires `onopen` when
the head arrives, and the first thing a quiet review would have written is the
heartbeat fifteen seconds later. Nothing is missed in that window either way —
the client is subscribed while the request is handled, before anything is
written — but the silence is invisible, and the page has a state that says so.

A comment line every fifteen seconds then keeps a silent stream open. Stopping the
server ends every open stream before the socket closes, rather than leaving the
browser to notice. Under Bun that needs `idleTimeout: 0` on the server, which is
in [runtime.ts](../../src/server/runtime.ts): Bun closes a connection that has
said nothing for ten seconds, and a stream between events is exactly that.

What the UI fetches once an event names it: `GET /api/repos/:repo/diff` — the
repository as the review document carries it, hunks dropped, 404
`no-such-repository` when it has no changes — `GET /api/comments/:id`, and
`GET /api/warnings`. The repository path goes in the URL as it is, slashes and
all.

`GET /api/activity` is what the feed shows before anything happens: the lines
the server noticed while it has been running, oldest first, in the same shape
the `activity` frames carry. A page that has just connected reads it once and
then follows the stream. The lines live in memory and are gone when the server
stops ([05-watcher.md](05-watcher.md)).

## Writing

The HTTP API is the UI's, not the agents' — that is the CLI
([ADR-004](../adr/adr-004-agent-contract.md)) — but both go through the same
domain and the same lock, so a write from the UI and a write from
`diffalanche reply` interleave without losing each other
([ADR-003](../adr/adr-003-on-disk-format.md)). Every write here is signed with
`user` from `config.json` and `role: human`; nothing in a request can change
either, which is why only a human ever resolves a thread through this server.

| Route | Body | Answers |
|---|---|---|
| `POST /api/comments` | `repo`, `path`, `line`, `endLine`, `side`, `severity`, `body` | 201 and the comment |
| `POST /api/comments/:id/replies` | `body` | 201 and the thread |
| `POST /api/comments/:id/resolve` | `note` | the thread, `resolvedBy` the configured user |
| `POST /api/comments/:id/reopen` | `note` | the thread, open again |
| `POST /api/sessions` | `name`, `base`, `title`, `scope`, `use` | 201 and `review.json` |
| `POST /api/sessions/:name/use` | — | `review.json` of the session now current |
| `PUT /api/sessions/:name/base` | `base` | `review.json` with the new base |
| `PUT /api/sessions/:name/scope` | `scope`, `dropComments` | `review.json` with the new scope, or 409 |
| `POST /api/sessions/:name/close`, `/reopen` | — | `review.json` with the new status |

An anchor level is read from what is absent: no `repo` is the whole review, no
`path` a repository, no `line` a file (`docs/SPEC.md` section 7). A `repo` that
is not a repository under the root is a 400 naming it, and so is an anchor the
task's scope is not about — that one is the domain's own refusal, `out-of-scope`,
because a comment stored outside the scope is one nothing reads back, whichever
interface wrote it ([04-domain.md](04-domain.md)); the repository is not
read again before the anchor is captured, because the comment is on the diff the
person was shown and not on what the file says a moment later. `base` is the
string the CLI takes — `head`, `branch`, `branch:<name>`, or a ref — read by the
domain's own parser, so the two interfaces have one grammar for it. A `note` on
`resolve` or `reopen` is written into the thread as a reply before the status
changes.

Changing the base of a session leaves its `diff.json` where it is and makes it
stale on purpose: the cache records the base it was computed with, so the next
reader — the UI, the CLI, or an agent — sees that it answers a different
question and scans instead of trusting it
([03-storage.md](03-storage.md), [06-cli.md](06-cli.md)). A scope edit does the
same, and for the same reason: the cache records the scope too.

`POST /api/sessions` takes a **scope** and a **`use`**, which is how a task is
made in one write rather than made and then narrowed: `scope` is checked against
the repositories the scan found before anything is written, the same check the
CLI runs, and `use: false` is `review new --no-use` — the session is written and
`current` stays where it is. The UI sends `use: false` for every session but the
first of a root, where there is no `current` and leaving it unset would hand the
person a root whose only session the CLI cannot name without `--review`
([ADR-010](../adr/adr-010-review-task-scope.md), decision 4).

**The scope is replaced whole rather than edited entry by entry.** The editor
holds the list the person sees, and one write is one state. What the new scope
removes takes the comments anchored under it, so the consent is in the body:
without `dropComments: true` a scope that would delete any is a 409 that names
how many, and nothing is written — not the scope and not `comments.json`. The
body's `scope` is a list of entries, each with a `repo` and optionally `paths`,
or `null` for the whole root; what an entry may say is the domain's check
([04-domain.md](04-domain.md)).

The CLI's half of this route is `review scope set` ([06-cli.md](06-cli.md)): the
same body, the same consent, and the same one-write-one-state — except for the
`null`. There is no spelling for it on the command line, so putting a task back
to the whole root is this route's alone, and the editor is what writes it.

`close` and `reopen` are signed like every other write here — `config.user` and
`role: human` — and nothing in the request can change either, which is why only
a human ever closes a task through this server
([ADR-010](../adr/adr-010-review-task-scope.md)). A comment written into a
closed task is not refused: closing is a marker and not a lock.

What the request itself is wrong about is a `400` with `error: "invalid-request"`
naming the field: a body that is not a JSON object, a severity that is not one
of the four, an empty comment. What the *review* is wrong about is the domain's
own refusal with its own code.

### Who may write

The server has no authentication and never will (`docs/SPEC.md` section 11), so
where a write came from is the whole check. The host check above runs first and
covers every request; on top of it a write passes **two more checks, and neither
is the other's duplicate** — they cover different requests:

- Hono's `csrf()` looks only at writes whose content type is one a form can
  send: its `isRequestedByFormElementRe` matches
  `application/x-www-form-urlencoded`, `multipart/form-data`, and `text/plain`,
  and it reads a **missing or empty content type as `text/plain`**, so those are
  checked too. Such a write needs no permission from this server before a
  browser sends it, and `csrf()` refuses it unless `Sec-Fetch-Site` or `Origin`
  says the page is this one.
- What `csrf()` therefore never looks at is `application/json`, which is every
  write this API takes. A browser will not send one cross-site without asking
  this server first, and this server answers no such question — but that is the
  browser's guarantee, not ours. So any unsafe method carrying an `Origin` that
  is not this server's is a `403` `error: "forbidden"` of our own.

"This server's" is the authority the request arrived on, which the host check
has already pinned to a name this server answers for: a page on another local
port names that port in `Origin` and not in `Host`, and a page on another
machine's name never gets past the host check to be compared at all.

A request with no `Origin` at all is not from a page. Removing any of the three
leaves a hole: without the host check a rebound name reads and writes freely,
without `csrf()` a form post from any page writes here, and without the origin
check a page on another loopback port rests on nothing but the browser's
preflight.

A body has to arrive as `application/json`; a body of another type is a `400`.
No body at all is an empty object, which is how `resolve` and `reopen` are
called without a note — and, having no content type, such a write is form-shaped
to `csrf()`, so it carries `Sec-Fetch-Site: same-origin`, which a browser sets
on its own. `curl` writing here has to say the same; the CLI is what agents
write through ([ADR-004](../adr/adr-004-agent-contract.md)).

The write routes drop the built document, so the next read of `GET /api/review`
is the new state rather than the state of a moment ago. The events that tell the
browser about the write come from the watcher, which sees the file change
whoever wrote it ([05-watcher.md](05-watcher.md)).

### The export

`GET /api/export?status=open|all&format=md|json` is `exportMarkdown` of the
domain over the comments of the current session: markdown grouped by repository,
or the comments themselves as JSON. Without the parameters it is the open
comments as markdown, the same default as `diffalanche export`.

## Where the UI comes from

`createApp({ config, review, ui, verbose })` takes the page as a `UiAssets` — a
`read(path)` that returns bytes and a content type, or `null`. There are two of
them, one per delivery channel: `directoryAssets(dir)` reads `dist/ui` from
disk, and `embeddedAssets(files)` decodes the base64 the binary carries inside
itself ([06-cli.md](06-cli.md)). A path that matches no asset falls back to
`index.html`; with no UI built at all the server answers 404 with the command
that builds it.

## The runtime switch

`startServer(app, port, hostname)` is the only module in `src/` that knows which
runtime it is on: `Bun.serve` under Bun, `@hono/node-server` under Node. It
resolves when the socket is listening, not when the adapter returns — the Node
adapter returns before it listens, and with port 0 the real port is only known
then; a listen error rejects the promise instead of becoming an unhandled event.

It answers with the **port and the hostname the socket is actually bound to**,
read back from the runtime rather than repeated from the argument. That is what
makes "listens on `127.0.0.1` and nowhere else" checkable on any machine: the
test that reaches the server from another of the machine's own addresses can
only run where the machine has one, and on a loopback-only host it reports a
skip. Without a value read from the socket, a default changed to `0.0.0.0` would
be reported as verified by a run that verified nothing.

Everything else in `src/` uses APIs both runtimes share, and adding a second such
module is a new decision ([ADR-008](../adr/adr-008-diff-rendering-verdict.md)).

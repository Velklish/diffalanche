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
that builds it; `verbose` turns on request logging. `close()` stops the watcher
and the socket.

Starting does four things before the socket opens: it creates the data directory
if it is not there, scans the root, reads the change set of the current session
into `diff.json`, and starts the watcher of
[05-watcher.md](05-watcher.md). A root with no current session skips the third:
the server starts anyway, and `GET /api/review` is what says so.

The server listens on `127.0.0.1` and nowhere else. There is no host to pass and
no flag that changes it (`docs/SPEC.md` section 11). A port that is taken is
refused with the sentence that names it:

```
port 4880 is already in use: stop the diffalanche that holds it, or run with --port <n>
```

With `--verbose` every request is one line on stderr — method, path, status,
duration. Without it the server writes nothing but its own failures.

## Routes

| Route | What it answers |
|---|---|
| `GET /api/review` | the review document: the change set, the session, its comments and counters |
| `GET /api/sessions` | every review session with its counters, most recently updated first |
| `GET /api/config` | `{ user, port }` — what the UI signs comments with, and where it is |
| `GET /api/scan` | every repository under the root, with whether it has changes |
| `GET /api/export?status=&format=` | the export of the current session |
| `POST /api/comments` | a new comment; the updated comment comes back |
| `POST /api/comments/:id/replies` | a reply in a thread |
| `POST /api/comments/:id/resolve`, `/reopen` | the status of a thread |
| `POST /api/sessions` | a new review session, made current |
| `POST /api/sessions/:name/use` | make a session current |
| `PUT /api/sessions/:name/base` | change the base of a session |
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
  "session": { "version": 1, "name": "ls-240372", "base": { "mode": "head" }, "…": "…" },
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
against a base that is no longer the session's — the server reads every
repository and writes it. The document is built once and serialised once — the
review is megabytes, and re-serialising it per request would charge every reload
for it. What rebuilds it is the watcher: a rescan hands over the change set as
it now stands, and every other event drops the document so the next request
builds it again.

`warnings` is everything the scan and the reads had to say — `ScanWarning[]`,
the directories that could not be read and the bases that did not resolve
([01-scanner.md](01-scanner.md), [02-git.md](02-git.md)).

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

### Refusals

Every refusal is the domain's own code and message
([04-domain.md](04-domain.md)):

```json
{ "error": "no-current-session", "message": "no current review session: create one with `review new` or name one with --review" }
```

| Code | Status |
|---|---|
| `no-current-session`, `no-such-session`, `no-such-comment` | 404 |
| every other `DomainError` | 400 |
| a file of the data directory that cannot be read | 500, `error: "storage"` |

A `comments.json` that is not JSON, a `review.json` of another schema version, a
`current` holding a path rather than a name: all of those are the 500, with the
file and the field the storage named. The server starts anyway — the change set
is read at start-up as a warm-up, not as a gate, because a server that refused
to start would leave the person with no way to see why.

`GET /api/review` on a root with no current session is the first of those: the
first-run screen reads that 404 and offers to create a session, while
`GET /api/sessions` answers with an empty list and `GET /api/scan` with the
repositories it found.


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
| `POST /api/sessions` | `name`, `base`, `title` | 201 and `review.json` |
| `POST /api/sessions/:name/use` | — | `review.json` of the session now current |
| `PUT /api/sessions/:name/base` | `base` | `review.json` with the new base |

An anchor level is read from what is absent: no `repo` is the whole review, no
`path` a repository, no `line` a file (`docs/SPEC.md` section 7). A `repo` that
is not a repository under the root is a 400 naming it; the repository is not
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
([03-storage.md](03-storage.md), [06-cli.md](06-cli.md)).

What the request itself is wrong about is a `400` with `error: "invalid-request"`
naming the field: a body that is not a JSON object, a severity that is not one
of the four, an empty comment. What the *review* is wrong about is the domain's
own refusal with its own code.

### Who may write

The server has no authentication and never will (`docs/SPEC.md` section 11), so
where a write came from is the whole check, and it is two checks over the same
question. Hono's `csrf()` refuses the writes a page on another origin can send
without asking this server first — a form post, a `text/plain` post, a request
with no content type — unless `Sec-Fetch-Site` or `Origin` says the page is this
one. On top of that, any unsafe method carrying an `Origin` that is not this
server's is a `403` `error: "forbidden"`, which is what a JSON write from such a
page would carry if a browser ever let one through without a preflight. A
request with no `Origin` at all is not from a page.

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
Everything else in `src/` uses APIs both runtimes share, and adding a second such
module is a new decision ([ADR-008](../adr/adr-008-diff-rendering-verdict.md)).

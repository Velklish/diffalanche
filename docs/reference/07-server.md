# 07 · Server

`src/server` serves the review to the UI. This is the Phase 0 spike's server:
one route with the data and one with the page. Comments, sessions, the write
API, and the SSE stream are DA-16 to DA-18.

## Routes

| Route | What it returns |
|---|---|
| `GET /api/review` | the whole change set as one JSON document |
| everything else | a file of the built UI, or `index.html` |

The review is scanned once at start-up and serialised once with it: the
document is megabytes, and re-serialising it per request would charge every
reload for it. Nothing is loaded lazily afterwards — `docs/SPEC.md` section 6
requires the whole review to arrive when it opens.

```json
{
  "root": "/abs/path",
  "repositories": [
    {
      "path": "group/service-api",
      "branch": "main",
      "base": "HEAD",
      "files": [
        { "path": "src/a.ts", "oldPath": "src/a.ts", "status": "modified",
          "additions": 12, "deletions": 3, "patch": "diff --git …" }
      ]
    }
  ],
  "totals": { "repositories": 21, "files": 300, "lines": 30000 }
}
```

Repositories without changes are left out. `status` is `added`, `modified`,
`deleted`, or `renamed`; `patch` is described in [02-git.md](02-git.md).

## Where the UI comes from

`createApp({ bundle, ui })` takes the page as a `UiAssets` — a `read(path)` that
returns bytes and a content type, or `null`. There are two of them, one per
delivery channel: `directoryAssets(dir)` reads `dist/ui` from disk, and
`embeddedAssets(files)` decodes the base64 the binary carries inside itself
([06-cli.md](06-cli.md)). A path that matches no asset falls back to
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

The server listens on `127.0.0.1` and takes no `--open`, no port fallback, and
no shutdown signal handling yet; those belong to DA-13 and DA-16.

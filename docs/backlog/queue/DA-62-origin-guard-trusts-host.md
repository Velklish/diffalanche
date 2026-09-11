# DA-62 · Both origin guards derive the expected origin from the Host header, so a rebinding page passes them

- **Order:** 20
- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`docs/reference/07-server.md` states the rule under "Who may write": any unsafe
method carrying an `Origin` that is not this server's is a 403. Two guards
implement it, at [src/server/app.ts:98](../../../src/server/app.ts):

```ts
  app.use("/api/*", csrf());
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!SAFE_METHODS.has(c.req.method) && origin !== undefined) {
      if (origin !== new URL(c.req.url).origin) {
        throw new ForbiddenError(`a write from ${origin} is not this review's own page`);
      }
    }
```

Hono's own `csrf()` compares the same way. Both therefore ask whether the
`Origin` header equals `new URL(c.req.url).origin` — and `c.req.url` is built
from the request's `Host` header by the adapter. So the question the guards
actually ask is "does the client's `Origin` match the client's `Host`", which a
client controls on both sides. "This server's origin" is never established from
anything the server knows: the port is fixed and public
(`DEFAULT_PORT = 4880` in [src/core/config/index.ts](../../../src/core/config/index.ts)),
and `grep -rn "host" src/server/ src/cli/` finds no allow-list.

The reachable attack is DNS rebinding, which needs no bug in the browser. A page
on `attacker.example` rebinds that name to `127.0.0.1` after loading, then
fetches `http://attacker.example:4880/api/review`. The browser treats it as
same-origin, so there is no preflight and no CORS to stop it; the server sees
`Host: attacker.example:4880` and `Origin: http://attacker.example:4880`, the two
match, and both guards pass. What is behind them is the whole review document —
the absolute root path, every repository, every patch of the reviewer's private
code — plus every write route: posting comments, replacing the base or the
scope, closing a session.

Binding to `127.0.0.1` does not help here: rebinding is what defeats it, which
is why the fix is a `Host` check rather than a network one.

## Work to do

- Compare `Origin` against what the server knows it is — the host and port it
  bound — rather than against the request's own `Host`. `startReviewServer`
  knows both.
- Reject a request whose `Host` is not one the server answers for. The set is
  small and known: `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`. This
  is the guard that stops rebinding, since a rebinding page must send the
  attacker's name in `Host`.
- Decide, and record, what a request with no `Origin` means. The current comment
  says "a request with no Origin is not from a page"; the CLI and an agent send
  none, so the `Host` check has to carry those.
- Update `docs/reference/07-server.md`: the rule as written describes a
  comparison that does not establish what it claims.

## Out of scope

- Authentication. A token per review is a different decision; this entry
  restores the guard the reference already promises.
- Serving on an interface other than loopback.

## Verification

- A request with `Host: attacker.example:4880` is refused, on a read route and
  on a write route, whatever `Origin` it carries.
- A request from the real page — `Host: 127.0.0.1:<port>`, matching `Origin` —
  still passes, and so does the CLI's request with no `Origin` at all.
- Tests in `tests/server.test.ts` cover all three, and removing the `Host` check
  turns the first one red.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.

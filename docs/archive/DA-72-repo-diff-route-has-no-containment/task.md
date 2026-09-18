# DA-72 · The named-session diff route joins the URL segment onto the root with no containment check, so an encoded ../ reads git outside it

- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`GET /api/repos/:repo/diff?review=<name>` takes the repository from the URL and
carries it to a `join` against the root without anything on the way asking
whether the result is still under the root.

[src/server/app.ts:145-155](../../../src/server/app.ts):

```ts
app.get("/api/repos/:repo{.+}/diff", async (c) => {
  const repo = c.req.param("repo");
  const change = await review.repository(repo, named(c));
```

With `?review=<name>` present, `named(c)` is defined and
[src/server/review.ts:178-181](../../../src/server/review.ts) takes the
`freshRepository` branch instead of looking the path up in the built document.
The only gate there is the scope
([src/server/review.ts:273](../../../src/server/review.ts)):
`if (!repositoryInScope(review.scope, repo)) return null;` — and
[src/core/domain/scope.ts:30-32](../../../src/core/domain/scope.ts) returns
`scope === null || scopeEntry(scope, repo) !== null`, so a session created
without `--scope` (the default, [src/core/domain/sessions.ts:128](../../../src/core/domain/sessions.ts))
lets every string through. The next line is `readRepositoryChange(config.root,
repo, review.base, …)`, which is `const cwd = join(root, repoPath);`
([src/core/git/index.ts:99](../../../src/core/git/index.ts)); then
[src/core/git/run.ts:24-31](../../../src/core/git/run.ts) `execFile`s git in that
cwd, pinning `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` and checking nothing about
where the cwd is.

Hono decodes the segment before the handler sees it. Reproduced against this
repository's own hono 4.13.7, with a throwaway app on the same route pattern and
no project fixtures touched:

```
/api/repos/%2e%2e%2f%2e%2e%2fother/diff -> 200 {"repo":"../../other"}
/api/repos/..%2F..%2Fother/diff         -> 200 {"repo":"../../other"}
/api/repos/../../other/diff             -> 404
```

A literal `../` is normalised away before routing; the percent-encoded forms
arrive intact. What that reaches is bounded in two ways worth stating exactly: it
needs an existing session name, because the no-session path answers from the
built document and cannot be steered this way, and a target that is not a git
repository resolves no base, produces no files and comes back as the route's
404. What it does reach is any git working tree the user can read, returned with
the `patch` text of every changed file. The failure is read-only — git is only
ever read here — so the rule that the tool never writes to a reviewed repository
holds; the root boundary does not.

The omission is inconsistent rather than deliberate: the write route one screen
down does check, at [src/server/app.ts:204](../../../src/server/app.ts) —
`if (repo !== null && !(await findRepositories(config)).includes(repo)) throw new RequestError(...)`.
And no test exercises traversal on this route: the only containment test in the
suite is on session names, [tests/storage.test.ts:104-113](../../../tests/storage.test.ts).

## Work to do

- Refuse a `:repo` that does not name a repository under the root on the
  `freshRepository` path, before any git process starts.
- Decide which check, and say so in [07-server.md](../../reference/07-server.md)
  next to the route. The candidates: reuse
  `findRepositories(config)` the way the comment route does, which is exact but
  is a filesystem walk of the root per request on a route the live stream calls
  on every event; or a pure path check — resolve `join(root, repo)` and require
  it to stay under the resolved root — which costs nothing but accepts a path
  that is inside the root and not a repository, leaving that case to the
  existing "no base, no files, 404". The route is on the live path, so the cost
  side of this is not incidental.
- Keep the refusal shaped like the route's existing answer — it already returns
  `{ error: "no-such-repository", message: … }` with 404 for a repository the
  change set does not have — or decide deliberately to distinguish a traversal
  attempt (400, a different `error`), which is part of the decision above.
- Check the other consumers of the same parameter shape while the containment
  lands: anything else that hands a client-supplied path to
  `readRepositoryChange` needs the same gate.

## Out of scope

- The origin guard that trusts the `Host` header, which is what would turn this
  from "a local client that could read the filesystem anyway" into a visited web
  page reading it: [DA-62](../DA-62-origin-guard-trusts-host/task.md). That one is the reason
  this is worth fixing rather than a duplicate of it.
- A reviewed repository's `.git/config` executing commands:
  [DA-61](../../backlog/active/DA-61-git-config-of-a-reviewed-repository-executes.md).
- The scope default. `repositoryInScope(null, …)` being true for everything is
  correct for what a scope means; it is simply not a containment check, and this
  task does not change the domain.
- Session-name traversal into the data directory, which `sessionDir` already
  refuses and `tests/storage.test.ts` already covers.

## Verification

- A request to `/api/repos/%2e%2e%2f%2e%2e%2fother/diff?review=<a session>` is
  refused without a git process running outside the root, and the same request
  without `?review=` keeps answering as it does today.
- The test goes where the named-session route is already exercised,
  [tests/write-api.test.ts:373](../../../tests/write-api.test.ts), which drives
  it through `app.request`. It asserts the refusal for both encoded forms and
  that a legitimate repository path still returns its files, so removing the new
  check turns it red.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  and `bun run perf` — the last one matters here rather than as a formality,
  because a per-request walk of the root is a budget question on a route the
  live stream calls.

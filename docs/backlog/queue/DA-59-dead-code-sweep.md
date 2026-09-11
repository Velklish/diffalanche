# DA-59 · Remove the dead code the audit named, and add a gate that keeps it out

- **Order:** 240
- **Scope:** 07-server, 08-ui, 03-storage, 05-watcher, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

An audit sweep over the whole repository looked for dead code in every form it
could take — unreachable registrations, exports nobody imports, unread files,
unreferenced CSS custom properties, dependencies no file imports, npm scripts
nothing runs. Most of those came back empty, which is worth recording as much as
what it found:

| Looked for | Result |
|---|---|
| Custom properties in `src/ui/tokens.css` never used through `var()` | 0 of 33 |
| `devDependencies` with no textual reference in the repository | 0 of 17 |
| npm scripts never invoked by CI, `backslop.json`, docs or `scripts/` | 0 |
| `TODO` / `FIXME` / `HACK` / `XXX` markers | 0 |
| Commented-out code | 0 |

Two things did come back.

**A route registered twice.** `GET /api/repos/branches` is registered at
[src/server/app.ts:140](../../../src/server/app.ts) and again at
[src/server/app.ts:178](../../../src/server/app.ts), each under an identical
three-line comment:

```
$ grep -n "api/repos/branches" src/server/app.ts
140:  app.get("/api/repos/branches", async (c) => c.json(await listBranches(config)));
178:  app.get("/api/repos/branches", async (c) => c.json(await listBranches(config)));
```

Hono answers with the first match, so the second registration never runs. Today
both call `listBranches(config)` and the answer is the same either way, which is
what makes it a trap rather than a bug: a change applied to the lower copy —
caching the refs, adding a query parameter, moving it below
`/api/repos/:repo{.+}/diff` — has no effect at all, and reads as "my edit did
nothing". `docs/reference/07-server.md` lists the route once.

**Thirty symbols exported for nobody.** Each of these is `export`ed and used
only inside its own file; no other `.ts`, `.tsx`, `.md`, `.json` or `.yml` in the
repository — tests, e2e specs, the perf harness, build scripts and `skills/`
included — mentions the name.

| File | Symbols |
|---|---|
| `src/core/config/index.ts` | `DATA_DIR_ENV`, `defaultConfigHome`, `DEFAULT_ROOTS`, `ConfigOverrides` |
| `src/core/storage/index.ts` | `UpdateSessionOptions`, `DATA_DIR_NAME`, `SessionDraft` |
| `src/core/watcher/activity.ts` | `ActivityOptions` |
| `src/core/watcher/index.ts` | `Ready`, `DEFAULT_DEBOUNCE_MS`, `WatcherOptions` |
| `src/core/watcher/tree.ts` | `TreeWatcherOptions` |
| `src/server/errors.ts` | `ScopeConflictBody` |
| `src/server/events.ts` | `RELOAD_EVENT`, `Replay` |
| `src/cli/spec.ts` | `OptionSpec` |
| `src/ui/components/FileCard.tsx` | `FileCardProps` |
| `src/ui/renderers/ReactDiffFile.tsx` | `ReactDiffFileProps` |
| `src/ui/measure.ts` | `THREAD_LINE_HEIGHT`, `THREAD_CHARS`, `THREAD_CHROME`, `REPLY_CHROME`, `WIDGETS_PADDING`, `WIDGET_GAP` |
| `src/ui/search.ts` | `PREVIEW_LINES` |
| `src/ui/perf.ts` | `LongTask` |
| `src/ui/patch.ts` | `PatchHunk` |
| `src/ui/store.ts` | `Theme`, `SelfWrite`, `LoadStatus` |

Spot-checked by hand — `DATA_DIR_ENV`, `DEFAULT_ROOTS`, `RELOAD_EVENT`,
`THREAD_CHARS`, `PREVIEW_LINES` and `SelfWrite` each have exactly one file in
`grep -rlw` over `src tests e2e perf scripts docs skills .github`, their own.

Nothing here misbehaves. The `export` is the dead part: it advertises an API
that nothing consumes, and — because `noUnusedLocals` in `tsconfig.base.json`
does not see exported symbols — it is exactly how an unused symbol escapes the
typecheck that would otherwise have caught it.

## Work to do

- Delete the second `GET /api/repos/branches` registration and its duplicated
  comment. Add a test that the route table has no duplicate method-and-path
  pair, so the next copy fails rather than sits there.
- Drop `export` from the thirty symbols above, keeping them module-private, and
  let `noUnusedLocals` decide whether what is left is used at all. A symbol that
  turns out to be genuinely unused goes entirely; one that is exported on purpose
  for a subsystem's public surface stays exported with a line saying so.
- Decide the standing check. `tsc` will not find the next over-export, so either
  a rule in Biome's configuration covers it or a small check does; whichever it
  is, it joins `gates` in `backslop.json` and the CI `check` job so the count
  stays at zero.
- Record in `docs/reference/07-server.md` that the route table is asserted to be
  duplicate-free, if that is how the first item is closed.

## Out of scope

- The long comments on both copies of the route. The duplicate goes with its
  copy; the surviving one is [DA-58](DA-58-comment-sweep-to-two-lines.md)'s.
- Anything the table above found clean. Re-running those probes is verification,
  not work.
- Types kept deliberately as a subsystem's published surface. If one of the
  thirty is that, the outcome is a line saying so, not a deletion.

## Verification

- `grep -c "api/repos/branches" src/server/app.ts` prints `1`, and a test fails
  when a duplicate registration is added back.
- Every symbol in the table is either module-private or carries a reason to stay
  exported; none is both exported and unreferenced.
- The standing check is in `gates` and in CI, and adding an unused export on
  purpose turns it red.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.

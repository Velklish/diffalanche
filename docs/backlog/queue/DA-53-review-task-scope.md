# DA-53 · Review task scope and status: format, core, CLI, HTTP

- **Order:** 285
- **Scope:** 03-storage, 04-domain, 02-git, 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** none

## Context

Today a review session covers everything under the root: every repository that has changes, every changed file in it. An agent that has just edited three files in two repositories has no way to say “look at these”, and the reviewer opening the tool gets the whole working area instead of the change that was made. The owner asked for a review that carries a **scope** — the repositories and files it is about — and for such a review to live in the history as a task one can come back to while it is not closed.

This task is the foundation the three UI tasks stand on: the on-disk format, the filter in the core, the CLI an agent uses, and the HTTP routes the UI calls. It writes ADR-010 with the decisions below.

**Decisions locked with the owner (2026-09-10 interview), not open for the implementer to revisit:**

1. **Scope is one list, entries of two kinds.** An entry is a whole repository, or a repository with an explicit list of paths. One concept covers both “the diff of these repositories” and “the diff of these files”.
2. **Nothing outside the scope is shown or returned.** No summary line, no collapsed section, no count of what was left out. A change outside the scope belongs to another task, and the history says which tasks exist. This is a deliberate carve-out from product principle 5 (`PRODUCT.md`) and is written into that document in this pass.
3. **A task is closed by a human**, never by counting comments. Status is `open` or `closed`; a closed task is reopened by the same gesture.
4. **Creating a task does not move `current`.** The agent prints a link, the human opens it when they are ready.
5. **A file that is in the scope but has no changes any more is not shown.** The scope keeps it; the screen does not.
6. **Removing an entry from the scope deletes the comments anchored under it**, and the caller is told how many before it happens. In the CLI this means an explicit `--drop-comments`; without it the command refuses and changes nothing.
7. **There is no main task.** Several agents work on several tasks at the same time; each names its task with `--review`. `current` stays as the default for a human typing a command by hand, and only `review use` moves it.

## Work to do

**Format (`03-storage`).** `review.json` gains `scope`, `status`, `closedAt`, `closedBy`:

```json
{
  "version": 2,
  "name": "ls-235557",
  "title": "Кэш тарифов: правки агента",
  "base": { "mode": "head" },
  "scope": [
    { "repo": "repos/core/cargos-api", "paths": ["app/route/route_94.py", "docs/cargo-163.md"] },
    { "repo": "repos/platform/loads-search" }
  ],
  "status": "open",
  "closedAt": null,
  "closedBy": null,
  "createdAt": "2026-09-10T09:00:00Z",
  "updatedAt": "2026-09-10T09:30:00Z"
}
```

- `scope` absent or `null` — the whole root, which is what every session written before this task means. An empty array is refused by the schema: a task that shows nothing is a mistake, not a state.
- `paths` absent or `null` — the whole repository. A path is relative to the repository, exactly as `comments.json` writes it.
- `SCHEMA_VERSION` goes to 2. `review.json` and `comments.json` of version 1 are read (a v1 review is `scope: null`, `status: "open"`) and written back as version 2 at the next write; `diff.json` of a version this build does not know is discarded and rescanned, because it is a cache.

**Core (`04-domain`, `02-git`).**

- `scanReview` takes the session's scope: the file-system walk still finds every repository (it starts no git process), and `readRepositoryChange` runs only for the repositories the scope names. A task over 2 of 21 repositories must not pay for the other 19.
- The path filter is applied to what `readRepositoryChange` returned, so untracked files keep the handling they have now.
- A scoped repository that has no changes, and a scoped path that has no changes, are absent from the change set — the same rule the review already uses for repositories.
- Scope validation: a repository the scan did not find, and a path that is not under its repository, are refused by name.
- Removing a scope entry: a domain operation that counts the comments it would take with it, refuses without an explicit consent flag, and deletes them under the session lock together with the scope write.

**CLI (`06-cli`).**

| Command | Behaviour |
|---|---|
| `review new <name> [--base …] [--title …] [--repo <path>]… [--path <repo>:<file>]… [--no-use]` | repeated `--repo` and `--path` build the scope; `--no-use` creates the task without moving `current`, and prints the URL of the running server (`http://127.0.0.1:<port>/?review=<name>`) alongside the name |
| `review scope [--json]` | print the scope of the session |
| `review scope add [--repo <path>]… [--path <repo>:<file>]…` | widen the scope |
| `review scope remove [--repo <path>]… [--path <repo>:<file>]… [--drop-comments]` | narrow it; without `--drop-comments` and with comments under the entry, exit code 1, nothing written, the message naming the count and the ids |
| `review close [<name>]`, `review reopen [<name>]` | set `status`; `closedBy` comes from `--author`, `closedAt` from the clock |
| `review list [--json]` | each row carries `scope` and `status` |
| `diff`, `list`, `show`, `export` | answer inside the scope of the session they run against |

**HTTP (`07-server`).**

- `GET /api/review?review=<name>` — the review document of a named session; without the parameter, of `current`, as now.
- `GET /api/sessions/candidates` — the change set of the **whole** root, ignoring any scope: what the scope editor of DA-55 offers to pick from.
- `PUT /api/sessions/:name/scope` — replace the scope. The body carries the consent flag; without it the route answers 409 with the comment count under the entries being removed, and writes nothing.
- `POST /api/sessions/:name/close`, `POST /api/sessions/:name/reopen`.
- The live stream gains an event for “a session was created or its status changed”, so an open window can say a new task appeared (used by DA-56).

**Documentation in the same pass.** `docs/SPEC.md` sections 4 (concepts), 5 (Review, Agent), 7 (on-disk format), 8 (CLI), 9 (agent protocol), 10 (Phase 1 acceptance criteria); `PRODUCT.md` — the carve-out in principle 5 and the capability line; `docs/GLOSSARY.md` — `scope` and `review task` as terms, with the ban on calling a scoped session a “filter”; `docs/reference/` 03, 04, 06, 07; `CHANGELOG.md`; `skills/diffalanche-review` and `skills/diffalanche-apply` — an agent proposes a task with `review new --no-use` and always names its own task with `--review`; ADR-010 with the seven decisions and a row in `docs/README.md`.

## Out of scope

- Everything on screen: the SCOPE pill, the scope editor, select mode, the repository bar, the history groups (DA-54, DA-55, DA-56).
- Deleting a session (DA-40, Phase 2).
- Re-anchoring comments after code edits (DA-42, Phase 3).

## Verification

- `review new t --repo repos/core/cargos-api --path repos/platform/loads-search:app/cargo/cargo_404.py --no-use` on the small synthetic fixture: `current` is unchanged, and `diff --json --review t` returns exactly the changed files of `cargos-api` plus that one path.
- The same session through `GET /api/review?review=t` returns the same repositories and files; `GET /api/sessions/candidates` returns all three repositories of the fixture.
- `review scope remove --review t --path repos/platform/loads-search:app/cargo/cargo_404.py` with a comment on that file exits 1, names the count, and leaves `comments.json` byte-identical; with `--drop-comments` the comment is gone and the scope is narrower.
- `review close t` puts `status: "closed"` in `review.json` and in `review list --json`; `review reopen t` returns it to `open`. `resolve`, `reply` and `comment` still work on a closed task — closing is a marker, not a lock.
- A `review.json` written with `"version": 1` is read with `scope: null` and `status: "open"`, and after `review base` is on disk as version 2.
- A scoped session over 2 of the 21 repositories of the synthetic review starts no git process for the other 19: asserted by counting the `git` invocations of the scan, not by wall-clock time.
- Gates from `backslop.json` green, including `bun run perf`.

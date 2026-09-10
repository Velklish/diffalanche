# DA-55 · Scope in the UI: SCOPE pill, scope editor, select mode

- **Order:** 305
- **Scope:** 08-ui, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** DA-53

## Context

DA-53 gives a review task a scope on disk and in the CLI. This task is how a human sees it and builds it: the screen says the review is narrowed, the tree and the reading column carry the scope and nothing else, and a task can be assembled by hand instead of being typed as CLI flags.

Two places, and they are not the same place. The **review screen** shows the scope only — that is the whole point of a task. The **scope editor** shows everything under the root, because a scope cannot be widened from a tree that already hides what is missing; it is an explicit gesture over the full candidate list from `GET /api/sessions/candidates`.

Decided with the owner on mockups over the running UI: a separate `SCOPE` pill next to `BASE`, and a `select` mode in the tree rather than permanent checkboxes — reading is the main scene and the tree must stay quiet the rest of the time.

## Work to do

- **SCOPE pill.** `SCOPE  2 repos · 5 files ▾` next to the `BASE` pill, the same control shape; the session pill carries the task name and title. A session with no scope shows no pill at all. The click opens the editor.
- **Scope editor.** An overlay over the full candidate list: repositories with their changed files, a tick per row, the count of what is picked. A repository tick with some of its files picked is the partial mark. Applying calls `PUT /api/sessions/:name/scope`.
- **Removal is confirmed with a count.** Taking a repository or a file out of the scope while comments hang under it opens a confirmation naming the file, the number of comments and how many of them are open — “Убрать `src/Tariffs/TariffService.cs` и удалить 3 комментария (1 открыт)?” — and only then sends the consent flag. Cancelling writes nothing. This is the only place in the product that destroys review data, and it never happens without that dialog.
- **The review screen carries the scope only.** The tree, the reading column, the counters in the header and the thread rail speak about the task. Nothing on the screen names what was left outside it.
- **Select mode.** A second tab beside `changes` turns the tree into a picking surface: a tick per repository and per file, a bar at the foot of the sidebar with `N repos · M files` and `New task…`, which asks for a name and a base and creates the task with that scope. Outside the mode the tree looks exactly as it does now.
- **The window shows the task from the URL.** `?review=<name>` decides what this window loads; without it, `current`, as now. Switching a task in the menu changes this window's URL and does not move `current` — several agents work on several tasks at once and none of them is the main one. The chip in the session menu says which task this window is showing; the pointer `current` is a CLI default and is marked separately where it is named at all.

**Documentation in the same pass.** `docs/design/HANDOFF.md` — the pill in section 1.1, the tree tab in 1.3, and a new section for the scope editor with its confirmation; `.impeccable/surfaces/src-ui-app-tsx.md` — the scope editor as part of the surface; `DESIGN.md` with `src/ui/tokens.css` if a token moves; `docs/reference/08-ui.md`, `docs/reference/07-server.md`; `CHANGELOG.md`. The Impeccable context loader runs before the first edit under `src/ui`; `audit` and `polish` run on the surface before the task is reported, with every unfixed finding named.

## Out of scope

- The CLI and the on-disk format (DA-53).
- The sticky repository bar and jumps (DA-54).
- Groups and closing in the history (DA-56).

## Verification

- Playwright: a task scoped to two repositories and five files shows five file cards and five rows in the tree; the third repository of the fixture is absent from the document, not merely hidden by CSS.
- The SCOPE pill reads `2 repos · 5 files`; a session without a scope has no pill.
- The editor lists all three repositories of the fixture while the tree lists two.
- Unticking a file that carries a comment opens the confirmation with the right count; cancelling leaves `comments.json` byte-identical; confirming removes the file and its comments.
- Select mode: ticking one repository and three files of another and pressing `New task…` creates a session whose `review.json` scope is exactly that, and the tree returns to its normal look when the mode is left.
- Opening `?review=<name>` in a second window shows that task while the first window keeps its own, and `.diffalanche/current` is unchanged by either.
- `bun run perf` green: the first render of a scoped task is inside the budget, and switching between two tasks stays inside the switching budget.
- Gates from `backslop.json` green.

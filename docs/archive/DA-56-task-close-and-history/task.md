# DA-56 · Closing a review task and the history of tasks

- **Order:** 30
- **Scope:** 08-ui, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** DA-53

## Context

“Come back to this diff while it is not closed” is the half of the feature the history owns. The session menu already lists sessions with their counters; it does not know that a session can be a task with a scope, that a task is open or closed, or that one appeared a minute ago because an agent created it.

Closing is a human gesture and it lives here rather than in the header: it is rare and terminal, and the row it belongs to is the row in the history.

## Work to do

- **Two groups in the menu.** `Открытые задачи` first, `Закрытые` under them, each sorted by `updatedAt` as now. A task carries its scope as a chip — `2 repos · 5 files`, or `все репозитории` for a session with no scope — beside the base chip.
- **Close and reopen from the row.** The action on an open row closes the task, on a closed row reopens it; a closed row keeps its counters and its `CLOSED` chip and stays quieter by tone, the way a resolved thread does. Both go through the routes DA-53 adds, and the author is `config.user`.
- **A task that appeared while the window was open.** The live stream event DA-53 adds arrives and the header shows a quiet mark that the history has something new; opening the menu clears it. No toast, no switch, nothing that moves the reading position — the owner keeps reading and opens the task when they are ready.
- **The row says which window is on it.** The chip on the row this window is showing, and nothing implying a main task: `current` is a CLI default and belongs on the row only where it is named as such.

**Documentation in the same pass.** `docs/design/HANDOFF.md` section 7 (the sessions menu becomes the task history: groups, chips, actions) and section 1.1 for the header mark; `docs/reference/08-ui.md`; `CHANGELOG.md`. The Impeccable context loader runs before the first edit under `src/ui`; `audit` and `polish` run on the surface before the task is reported, with every unfixed finding named.

## Out of scope

- Deleting a session (DA-40, Phase 2).
- Closing a task from the CLI and the routes behind these buttons (DA-53).
- Building or editing a scope (DA-55).

## Verification

- Playwright on a fixture with four sessions, two of them closed: the menu shows two groups, the open ones above; a scoped task carries its scope chip and an unscoped one carries `все репозитории`.
- Pressing the action on the current task writes `status: "closed"` into `review.json`; the row moves to the lower group without a reload; pressing it again on the closed row returns it.
- A session created by the CLI while the page is open raises the header mark within the live-update budget and does not switch the window, does not scroll the column, and does not close an open composer; opening the menu clears the mark.
- Gates from `backslop.json` green.

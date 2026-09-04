# DA-23 · Threads rail

- **Order:** 230
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-21

## Context

`docs/design/HANDOFF.md` section 3: cards with a severity chip, the anchor (`L42–45`, `file`, `review`, `<repo> · L…`), state `awaiting` / `RESOLVED`, body, nested replies coloured by role, `Resolve` / `Reopen`, `Reply` with an inline field, author and relative time; tabs `This file N` / `Review N`; `unanswered` filter chip. `docs/SPEC.md` section 5: reply, resolve, reopen; counters for open and awaiting.

## Work to do

- Thread card component with every state of the handoff except `orphaned` and the `auto` / `labelled by` markers (later phases).
- Rail with the two tabs, counts, and the `unanswered` filter; clicking a card focuses it and scrolls the diff to its anchor; clicking a line's marker focuses the card.
- Inline thread widget under the anchored lines in the file card, sharing the card component.
- Reply, resolve, reopen through the write API; optimistic update with rollback on error.
- Focus model in the store (`focusId`) used by the keyboard map (DA-26).

## Out of scope

- Live arrival of replies (DA-25); orphaned handling (DA-43).

## Verification

- Playwright on the fixture: the rail lists threads of the open file and, on the `Review` tab, of every repository; `Resolve` removes the comment from `diffalanche list --status open --json`; `Reopen` brings it back; a reply from the rail appears with role `human` and the configured author.
- Card colours per role and severity match the handoff's tokens in a screenshot test.

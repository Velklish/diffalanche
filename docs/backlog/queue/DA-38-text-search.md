# DA-38 · Text search in global search

- **Order:** 380
- **Scope:** 08-ui, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-37

## Context

`docs/SPEC.md` section 3, decision 11, tier 1: text search across repositories with no dependencies; section 5 Phase 2: global search also finds text in any file.

## Work to do

- Server: `GET /api/search/text?q=` over `git grep -n` in every repository of the review (working tree), capped and paginated, with a preview of the matched line and its neighbours.
- Global search: a `text` result tag, the preview column showing the match, `⏎` opens the file in browse mode at the line.

## What Phase 1 changed

Phase 1 built global search (DA-26): ranking and the twelve-line preview in `src/ui/search.ts`, the modal through the `Overlay` primitive (DA-26.1, focus contained), and the result tags with `text` named as this task's in [08-ui.md](../../reference/08-ui.md). The `⏎` path for a file lands on its card; the browse mode this task opens files in is DA-37's.

## Out of scope

- Symbols (DA-39).

## Verification

- Playwright: searching a word present in two repositories lists matches from both with previews; opening one lands on the line.


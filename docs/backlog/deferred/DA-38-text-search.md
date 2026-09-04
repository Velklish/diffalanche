# DA-38 · Text search in global search

- **Scope:** 08-ui, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-37

## Context

`docs/SPEC.md` section 3, decision 11, tier 1: text search across repositories with no dependencies; section 5 Phase 2: global search also finds text in any file.

## Work to do

- Server: `GET /api/search/text?q=` over `git grep -n` in every repository of the review (working tree), capped and paginated, with a preview of the matched line and its neighbours.
- Global search: a `text` result tag, the preview column showing the match, `⏎` opens the file in browse mode at the line.

## Out of scope

- Symbols (DA-39).

## Verification

- Playwright: searching a word present in two repositories lists matches from both with previews; opening one lands on the line.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.

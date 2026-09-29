# DA-42 · Re-anchoring after code edits and orphaned status

- **Order:** 800
- **Scope:** 04-domain, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-12

## Context

`docs/SPEC.md` section 5 Phase 3: after code edits, comments stay on their lines; a comment whose place cannot be found is marked `orphaned` and kept. `docs/design/HANDOFF.md` "Orphaned": three levels — `git blame --reverse` from the base commit to the working tree, then fuzzy match on the stored `lineContent` / `before` / `after`, and only then a model proposal that a human confirms; a comment never moves on its own.

## Work to do

- `src/core/domain/anchors`: on `diff-changed`, for every line comment of the changed files, try blame-based mapping, then fuzzy matching with a similarity threshold; update `line` / `endLine` and the stored context when a unique match is found; otherwise set `status: orphaned` and keep the old anchor.
- Status `orphaned` in the schema (`docs/SPEC.md` section 3, decision 8) and in CLI filters; `reopen` returns an orphaned comment to `open` once re-anchored by hand.
- Scanner warning "N comments lost their anchor in <repo>".

## Out of scope

- The model proposal and the UI (DA-43).

## Verification

- Vitest: inserting five lines above a commented line moves the anchor by five; rewriting the commented line beyond the threshold marks it orphaned; the original anchor text is still in the file.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 3 of `docs/SPEC.md` section 10; depends on Phase 1 and Phase 2 artifacts.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.

## Review state (2026-09-29, not merged)

This branch was reviewed in three isolated rounds: 14 findings, then 8, then 9. Every finding of a round was closed in the next. The third round found three major problems in the design the second round introduced, which keeps a repository's old `diff.json` entry when its comments could not all be placed, so the next writer retries:

- **M-A.** A kept entry puts `diff.json` out of step with what the page and `diff --json` show. `addComment` then takes a new anchor from the stale hunks (reproduced: a comment on line 5 stored the old text and was later moved to line 8). A reopen after a pending refresh orphans a comment that a finished pass would have moved. A server restart shows the old diff.
- **M-B.** Nothing guarantees a kept entry is ever retried. Only a writer of that repository retries it, and a pass over 10 s restarts from scratch each time, so it never finishes. After a base change, entries diffed against the old base sit in a cache stamped with the new one.
- **M-C.** The 10 s budget is checked only between comments, and a git child has no timeout. A 40 s `blame -M` loses the 30 s lease, and the whole write is lost, over and over.

Minor findings from round three, not yet fixed:

- help text and README still describe the removed refusal;
- reopen orphans a comment whose file is unreadable, where the pass leaves it alone;
- the server reopen fails when its refresh fails;
- `diff` warnings are unsorted;
- `Rescan.cache` is documented wrongly;
- the unheld `reanchorRepository` path writes without its old guard;
- SPEC:200 reads as an answer to Q2.

**The decision this needs, which is the owner's.** Where the tree the comments were placed on lives:

1. **A record of its own.** The comments' placement tree lives in its own record, for example per repository in `comments.json` or in a file beside it. `diff.json` then always holds the fresh scan, and the pass diffs from that record. This closes M-A and M-B. It is an on-disk format change, so it needs an ADR and a line in 03-storage.
2. **No retry.** Drop "keep the old entry". A pass that fails or runs out of time leaves its comments where they are, flagged as not re-anchored for this change and counted in the warning. They are placed by hand or by the next change of that file. This is simpler, and it loses a move on a failure.

In either case, M-C needs a timeout on the git children the pass starts and a check of the deadline inside a comment's placement.

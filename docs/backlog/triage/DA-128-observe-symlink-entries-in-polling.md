# DA-128 · Observe symlink entry changes in the polling watcher

- **Scope:** [05-watcher](../../reference/05-watcher.md); [02-git](../../reference/02-git.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-102
- **Audit priority:** P2
- **Evidence status:** confirmed

## Context

The polling fallback drops symbolic links from its snapshot even though Git diffs represent their target strings. Creating, deleting, or retargeting a link can leave a live review stale.

## Evidence

- src/core/watcher/tree.ts:414-416 skips every entry for which isFile() is false; the per-directory arming snapshot at :263 also includes only regular files.
- src/core/git/index.ts:166-178 handles mode 120000 as a link target string; tests/git.test.ts:445-487 already establish that product behavior.
- Owned-fixture probe forced recursive:false, retargeted link from one to two, and waited for three completed marker snapshots. Observed target:"two", heard:["marker0","marker1","marker2"], linkReported:false. node /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes.ts; exit 0; raw /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes-http.log.

## Work to do

- Include symlink directory entries in polling and relevant per-directory snapshots using no-follow metadata/target semantics.
- Detect create, delete, and target replacement without traversing target directories or reading target content. Correct the misleading comment that links are not part of the tree.

## Acceptance criteria

- With recursive:false, link creation, deletion, and retarget each produce the expected path notification and refreshed Git patch.
- Changes to an outside target alone do not cause traversal or disclose target content.
- Dangling links remain observable and ordinary file snapshot behavior is preserved.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/watch-tree.test.ts tests/watcher.test.ts tests/git.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run exact forced-polling symlink create/delete/retarget cases with snapshot barriers` — notRun

## Deduplication

DA-110.6 diagnoses native Bun/macOS lifecycle failures; DA-110.4 concerns ignored temporary renames. This deterministic forced-polling omission has a distinct cause.

## Registration boundary

Audit finding PQA-102; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

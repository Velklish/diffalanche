# DA-128 · Observe symlink entry changes in the polling watcher

- **Scope:** [05-watcher](../../reference/05-watcher.md); [02-git](../../reference/02-git.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-102
- **Audit priority:** P2
- **Evidence status:** confirmed
- **Previous order:** 940
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The polling fallback drops symbolic links from its snapshot even though Git diffs represent their target strings. Creating, deleting, or retargeting a link can leave a live review stale.

## Evidence

- src/core/watcher/tree.ts:414-416 skips every entry for which isFile() is false; the per-directory arming snapshot at :263 also includes only regular files.
- src/core/git/index.ts:166-178 handles mode 120000 as a link target string; tests/git.test.ts:445-487 already establish that product behavior.
- Owned-fixture probe forced recursive:false, retargeted link from one to two, and waited for three completed marker snapshots. Observed target:"two", heard:["marker0","marker1","marker2"], linkReported:false. node /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes.ts; exit 0; raw /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes-http.log.

## Work to do

- Include symlink directory entries in polling and relevant per-directory snapshots using no-follow metadata/target semantics.
- Detect create, delete, and target replacement using no-follow entry metadata. Do not traverse stable link targets or read their content. Reject detected path replacements before publication under the concurrency limitation approved below. Correct the misleading comment that links are not part of the tree.

## Acceptance criteria

- With recursive:false, link creation, deletion, and retarget each produce the expected path notification and refreshed Git patch.
- Changes to a stable outside target alone do not traverse it or disclose its content.
- When concurrent path replacement is detected, discard the affected enumeration before publishing its paths. Internal directory-name enumeration during a replacement race is permitted; atomic zero-enumeration is not required.
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

## Owner decision — 2026-11-01 (interactive execution)

The owner selected “Принять явное ограничение” in the completed interactive question. The accepted contract is ordinary no-follow link handling plus rejection of detected replacement before publication. A racing replacement can cause internal directory-name enumeration; document that limit explicitly. Do not claim an atomic no-traversal guarantee, and do not add a native/OS layer in this run. The original evidence is retained; the previous strict race interpretation is superseded by this explicit decision. Regression checks must still prove detected-replacement rejection and the stable-link behavior, with meaningful mutation sensitivity.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

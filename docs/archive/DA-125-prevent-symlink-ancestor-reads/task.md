# DA-125 · Do not read worktree file content through a symlink ancestor

- **Scope:** [02-git](../../reference/02-git.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-100
- **Audit priority:** P1
- **Evidence status:** confirmed
- **Previous order:** 910
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The worktree browser promises to return a symlink target string without following the link. A tracked file can still be reached through a directory that has been replaced with a symlink, and the reader returns content outside the repository.

## Evidence

- At HEAD 087d3330128f8762ff88b0a9f7a7151dca8db028, src/core/git/browse.ts:112-122 accepts a path enumerated by git ls-files; :132-139 lstat checks only the final path component before readFile follows all ancestor components.
- Audit probe: commit nested/file.txt, replace nested with a symlink to an outside fixture directory, then call readFileAt(repo,"nested/file.txt","worktree"). Observed {"text":"OUTSIDE-CONTENT\n","omitted":null}. Command: node /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes.ts; exit 0; raw /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes-http.log. Only owned temporary fixtures were read.
- docs/reference/02-git.md:588-590 says a link is read rather than followed. The distinct named-repository root-link behavior is explicitly documented in docs/reference/07-server.md and is outside this task.

## Work to do

- Prevent worktree file reads through symlink ancestors in the common browse/file-source/symbol-reading path. Define the refusal/omission result consistently with the existing API.
- Preserve direct and dangling symlink target strings, ordinary files, and valid linked worktrees. Do not silently change the documented named-repository root-link policy.
- Account for path replacement between validation and reading; do not claim that a one-time realpath check alone eliminates TOCTOU.

## Acceptance criteria

- A tracked file beneath a symlink ancestor cannot disclose the outside fixture bytes.
- Regression tests cover an ancestor link, a direct link, a dangling link, an ordinary file, and an ordinary linked worktree.
- The fix neither traverses a link target for discovery nor changes the separate documented named-repository policy.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/browse.test.ts tests/git.test.ts tests/write-api.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Add and run exact regression cases for the ancestor-link fixture above` — notRun

## Deduplication

No current backlog card describes ancestor-file reads. The acknowledged named-root symlink limitation is a different compatibility contract.

## Registration boundary

Audit finding PQA-100; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

# DA-131 · Apply Config.exclude to files consistently in initial scans and live updates

- **Scope:** [01-scanner](../../reference/01-scanner.md); [02-git](../../reference/02-git.md); [05-watcher](../../reference/05-watcher.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-101
- **Audit priority:** P2
- **Evidence status:** confirmed_mismatch
- **Previous order:** 970
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

Config.exclude is described as removing files from the change set, while initial scans still include matching files and the watcher ignores their later events. An excluded tracked file can therefore remain visible with a stale patch. The owner selected file exclusion for both initial scanning and live updates; narrowing the documentation is not the selected outcome.

## Evidence

- src/core/config/index.ts:25 and README.md:229 promise file exclusion; src/core/change-set.ts:178-186 passes exclude to directory scanning but does not filter files returned by Git; filterChange at :120-124 applies scope only.
- src/core/scanner/index.ts:67-69 applies exclusion to directories; src/core/watcher/index.ts:869,891 applies the patterns to file events.
- Audit probe with exclude:["**/*.lock"] and a modified tracked package.lock returned {"found":["repo"],"files":["package.lock"]}. node /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes.ts; exit 0; raw /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/backend-probes-http.log.
- Strongest counterevidence: docs/reference/01-scanner.md:100-105 explicitly documents the directory-only scanning limitation. This is a confirmed inconsistent contract, not an undocumented implementation promise.

## Work to do

- Apply Config.exclude to files in initial/full and per-repository/named change-set reads as well as live refreshes. Preserve scope and Git-ignore semantics.
- Make README, config documentation, and scanner reference describe the selected file-exclusion behavior. Remove the current directory-only limitation once the implementation satisfies it.

## Acceptance criteria

- With exclude:["**/*.lock"], a modified tracked package.lock is absent from the initial change set and remains absent after edits and live refreshes.
- The same exclusion contract holds for full, per-repository, named-review, and scoped reads.
- Directory patterns and existing Git-ignore behavior remain covered; README/config/reference no longer contradict the implementation.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/change-set.test.ts tests/watcher.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run the selected initial-read and subsequent-edit exclusion regressions separately` — notRun

## Deduplication

DA-58.2 concerns global core.excludesFile and DA-110.4 concerns ignored temporary renames; neither defines Config.exclude file filtering.

## Owner decision — 2026-11-01

User selected consistent file exclusion in initial scan and live updates via AskUserQuestion during registration.

## Registration boundary

Audit finding PQA-101; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Git policy track owns change-set file exclusion, the read-only Git environment, focused regression tests and references 01/02. Preserve the selected Config.exclude contract for initial/full, per-repository, named, scoped and live reads. Limit watcher edits to passing the exclusion policy at its change-set filter call; coordinate that shared file with the watcher track. Preserve inert Git configuration and existing ignore semantics; documenting the global core.excludesFile boundary is allowed, importing arbitrary global Git configuration is not an implicit requirement. Verify each original minor source separately and keep new findings registration-only.

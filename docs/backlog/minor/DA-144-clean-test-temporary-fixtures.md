# DA-144 · Clean up the temporary directories owned by four test fixtures

- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** minor
- **Audit finding:** PQA-002
- **Audit priority:** P3
- **Evidence status:** confirmed_static

## Context

Several test fixtures allocate temporary directories outside the main test root and never remove them. Repeated runs accumulate owned files even when the tests pass.

## Evidence

- tests/check-comments.test.ts:26,34 allocates two mkdtempSync roots without a cleanup import/finally.
- tests/branches.test.ts:37-38 creates a separate bare remote; afterAll removes only the main root.
- tests/git.test.ts:790 allocates a diffalanche-no-git directory for PATH; :796-799 restores PATH but does not remove that directory.
- This proves unpaired fixture lifetimes in source; it does not establish that any measured test failure was caused by the leaked directories. Backend PQA-108 is merged here.

## Work to do

- Retain each owned path and remove it with local finally/teardown on success and failure.
- Preserve PATH restoration and delete only this run's exact owned paths. Do not sweep shared temporary-directory prefixes or introduce a fixture framework.

## Acceptance criteria

- All four allocated paths are absent after successful completion and after a controlled assertion failure.
- PATH is restored even when the product call throws.
- No other run's temporary files are touched.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/check-comments.test.ts tests/branches.test.ts tests/git.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Inspect the captured owned fixture paths after success and a controlled failure` — notRun

## Deduplication

No current duplicate; merge root PQA-002 and backend PQA-108 into one local cleanup task.

## Registration boundary

Audit finding PQA-002; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

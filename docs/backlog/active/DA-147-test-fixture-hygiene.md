# DA-147 · Test fixture cleanup and meaningful runtime smoke

- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor
- **Previous order:** 830
- **Taken:** 2026-11-01

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Remove arithmetic skeleton while preserving runtime smoke; clean only four fixture-owned dirs.

## Work to do

- [DA-143 — Remove the arithmetic skeleton test while retaining runtime smoke checks](../minor/DA-143-remove-arithmetic-skeleton-test.md)
- [DA-144 — Clean up the temporary directories owned by four test fixtures](../minor/DA-144-clean-test-temporary-fixtures.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-143

# DA-143 · Remove the arithmetic skeleton test while retaining runtime smoke checks

- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** minor
- **Audit finding:** PQA-001
- **Audit priority:** P3
- **Evidence status:** confirmed_static

## Context

The skeleton test checks arithmetic without importing the product. Existing runtime smoke checks already verify the requested runtime and loopback listening.

## Evidence

- tests/skeleton.test.ts:3-5 asserts expect(1 + 1).toBe(2). tests/runtime.test.ts exercises actual runtime/socket prerequisites. The complete audit unit run executed the skeleton test; unrelated unit failures do not make the full run successful.

## Work to do

- Delete only the arithmetic skeleton test file. Keep meaningful runtime smoke and all product assertions.

## Acceptance criteria

- The test runner still executes tests/runtime.test.ts successfully.
- No product behavior check is removed and no test is added solely to verify deletion.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/runtime.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.

## Deduplication

No current duplicate. This is a local useless-test removal with no dependent contract.

## Registration boundary

Audit finding PQA-001; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.


### Retained original DA-144

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

## Execution plan

Verification hygiene track owns only the four original fixture lifetimes, removal of the arithmetic skeleton, and a deterministic check linking the four existing reading-coordinate declarations. Keep the runtime smoke and browser behavior assertions. Do not introduce a fixture or geometry framework; source coordinates and UI behavior stay as specified. Prove owned-path cleanup after success and controlled failure without sweeping shared temporary directories. Keep separate original DA-143 and DA-144 outcomes; no new minor fixes.

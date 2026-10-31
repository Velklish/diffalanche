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

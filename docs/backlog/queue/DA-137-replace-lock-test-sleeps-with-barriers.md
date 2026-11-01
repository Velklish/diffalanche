# DA-137 · Prove lock contention in writer tests with an explicit barrier

- **Order:** 1070
- **Scope:** [03-storage](../../reference/03-storage.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major (hypothesis)
- **Audit finding:** PQA-106
- **Audit priority:** P2
- **Evidence status:** hypothesis


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The lock-writer tests use a calibrated sleep as evidence that a contender has reached the held session lock. Delay before lock acquisition can make a valid writer fail the intended assertion or let an invalid writer escape the intended interleaving.

## Evidence

- tests/lock-writers.test.ts:72,124,171 waits max(150/400ms, 2*uncontendedDuration) before releasing a lock.
- A delayed addComment can reach its cheap scope check only after release; a delayed diff writer can complete its scan after release. The elapsed delay does not prove that either contender was waiting on the lock.
- This is a source-level test risk. No matching failure or false pass was observed during the audit; the calibrated multiplier reduces probability but does not establish ordering.

## Work to do

- First demonstrate the late-contender interleaving deterministically using an owned test seam.
- Replace the guessed wait with proof that the intended operation reached the relevant lock boundary, using existing filesystem/domain seams where possible.
- Keep the existing invariants and bounded cleanup; avoid production sleeps, a generic hook framework, or a stress-only reproduction.

## Acceptance criteria

- Each contention assertion has a barrier proving the contender reached the intended boundary while the lock is still held.
- A deliberately broken lock discipline fails the regression deterministically.
- A correct writer delayed before lock acquisition does not fail merely because an elapsed-time guess expired.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/lock-writers.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run deterministic delayed-before-lock and deliberately broken-lock controls` — notRun

## Deduplication

DA-40.3 concerns a distinct rmSync/mkdir deletion race. DA-60.4 concerns an SSE reader. Neither covers these calibrated contention waits.

## Registration boundary

Audit finding PQA-106; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

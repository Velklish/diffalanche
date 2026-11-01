# DA-58.3 · The header mark's 750 ms ceiling was the runner allowance of 2.5, and the allowance is 2.1 now

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-28
- **Parent:** DA-58
- **Cost:** minor
- **Previous order:** 1240
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Evidence

Finding discovered while working on DA-58, in the sweep of `e2e/`.

The ceiling `e2e/history.spec.ts` holds the header mark against is 750 ms:

<!-- quote:before:../../../e2e/history.spec.ts -->
const MARK_CEILING_MS = 750;
<!-- /quote -->

Its comment before the sweep derived it as "the 300 ms `docs/SPEC.md` section 6 gives a live update, times the allowance a shared runner gets (`RUNNER_ALLOWANCE` in `perf/budgets.ts`)", and called it "2.5× the budget". The allowance was 2.5 when the ceiling was set
(`result.md` of DA-5.1, `npx --no-install backslop show 5.1`, records
`RUNNER_ALLOWANCE = 2.5`) and DA-56.4 recomputed it, "2.5 → 2.1"
(`result.md` of DA-56.4, `npx --no-install backslop show 56.4`):

<!-- quote:../../../perf/budgets.ts -->
export const RUNNER_ALLOWANCE = 2.1;
<!-- /quote -->

So the number and the reason given for it have come apart: 750 is 2.5 × 300, and 2.1 × 300 would be 630. The sweep fixed the comment to state what is true — 2.5 times the 300 ms, the allowance when the ceiling was set — and moved the rest of its text to 11-perf.md, "The header mark's ceiling"; it did not touch the number, since a sweep of comments changes no code.

Nothing is red either way: the mark measured 246 ms and 234 ms when the ceiling was written, well under both. Whether the ceiling is meant to follow the allowance is not established from the code; the assumption is that it was set from it and not tied to it.

## Work to do

- Decide whether the mark's ceiling follows `RUNNER_ALLOWANCE` or stands as a suite deadline of its own. If it follows, derive it from the constant (`300 * RUNNER_ALLOWANCE`, imported) rather than writing the product by hand; if it stands, say so in 11-perf.md and keep 750.

## Verification

- 11-perf.md, "The header mark's ceiling", gives the reason for the number `MARK_CEILING_MS` holds, and that reason matches `perf/budgets.ts`.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

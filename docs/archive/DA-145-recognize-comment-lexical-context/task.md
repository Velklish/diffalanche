# DA-145 · Make the comment gate distinguish source comments from string data

- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-003
- **Audit priority:** P3
- **Evidence status:** confirmed
- **Previous order:** 1060
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The existing comment-length gate claims to inspect every comment block but recognizes trimmed line prefixes without lexical context. It can reject valid fixture data and miss actual multiline comments.

## Evidence

- scripts/check-comments.ts:25,33,40 uses trim/startsWith; :1 states the every-comment-block rule associated with ADR-011.
- Command bun /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/root-probes.ts exited 0. A template string containing three // data rows was reported as {line:2,lines:3}; an actual four-line inline block beginning const answer = 42; /* returned []. Raw: /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/root-parser-probe.log. Exit 0 is successful measurement of both defects, not a passing gate.

## Work to do

- Recognize comments and strings correctly for the supported inputs, or explicitly agree a narrower gate contract that does not reject string fixtures.
- Keep the existing TS/TSX/CSS/YAML/shell, JSX-comment, CRLF, and shebang behavior in scope. Use the existing check:comments trigger; do not add a generic parser framework or dependency without need.

## Acceptance criteria

- The template-string fixture is accepted; the real inline multiline block is detected under the selected contract.
- Existing meaningful check-comments tests remain valid.
- The documented gate promise and diagnostics match the implemented grammar.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/check-comments.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `bun scripts/check-comments.ts src tests e2e perf scripts` — notRun. Proposed non-hidden-root check; the full default includes hidden .github outside the audit read scope.

## Deduplication

No current duplicate. Cost major follows the broken stated automation rule, independently of the audit priority P3.

## Registration boundary

Audit finding PQA-003; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Own scripts/check-comments.ts, tests/check-comments.test.ts, the comment-gate section of reference 11 and any strictly necessary ADR-011 consistency correction. Honor the stronger every-comment contract from AGENTS and ADR-011; do not preserve a stale trailing-comment exclusion by weakening detection. Preserve runtime smoke and unrelated test fixture cleanup for their separate tasks. Validate false-positive and false-negative sensitivity with semantic mutation probes after committing. No parser framework or new dependency without demonstrated need.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

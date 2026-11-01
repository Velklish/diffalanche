# DA-45.8 · A comment left on an unchanged file in browse mode was drawn twice under its line for 5 s

- **Scope:** 08-ui
- **Created:** 2026-09-29
- **Parent:** DA-45.6
- **Cost:** major (hypothesis)
- **Previous order:** 1110
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Evidence

Finding discovered in `UI suite` of Velklish/diffalanche#13, run 36523628489, job 109261780839. That pull request touched nothing the suite runs; the suite passed on the commit before and on main. The failing spec was `e2e/browse.spec.ts:79` › "a comment left on an unchanged file lands in the session with its path":

```
Error: expect(locator).toHaveCount(expected) failed
Locator:  locator('.plain-card').locator('[data-thread-anchor="c_abbji9"]')
Expected: 1
Received: 2
Timeout:  5000ms
  14 × locator resolved to 2 elements
```

The comment was on disk with the right anchor (the assertion before it passed), and the browse card drew its thread twice for the whole 5 s. Hypothesis, not reproduced: the optimistic thread the store adds on submit and the one the server's echo brings are not merged when the file is an unchanged one shown in browse mode, so a race between the `POST` answer and the event frame leaves two. If so, it is a page defect a reader would see, not a test race.

## Work to do

- Reproduce, for example by holding the `POST` answer until after the comment's event frame, and read which two elements carry the anchor.
- If it is the page: one thread per comment id in browse mode, as in the diff. If it is the spec: say why and fix the wait.

## Execution plan

Live thread UI track owns late asynchronous thread read/patch/toast isolation and the separate browse duplicate hypothesis. Bind completion to the originating task generation, including current mode and A-to-B-to-A, preserving valid events/counters and the existing stream queue. Reproduce the duplicate hypothesis with controlled POST/SSE ordering before any fix, retain its separate verdict and do not infer refutation from no reproduction. DA-55.12 addresses dropped new-task frames and remains a distinct authorized source in its own batch, not silently implemented or closed here. Preserve existing UI fixtures, keyboard behavior and exact anchor/severity assertions.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

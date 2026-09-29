# DA-54.6 · Result

**Closed 2026-09-29.** Completed. The spec was at fault, not the page. `focusByKey` in `e2e/focus.spec.ts` asked for `.first()` again after focusing it. The `all files` tab reads each repository's tree with its own request, and a repository's unchanged rows appear only when its tree lands. A tree that landed between the `focus()` and the assertion therefore put rows above the focused one, and the assertion then watched a row nobody had focused until its 5 s timeout. The focused row kept the focus and was not remounted: rows are keyed by path, and it stayed `document.activeElement` and connected. `focusByKey` now takes a handle on the element it focuses and polls until that same element is `document.activeElement`. The card's quote of the old function is now a plain code block, because the function it quoted has changed.

**Verification.** All runs were on the 4-core cloud container.
- **The cause, by forced timing.** Holding the first repository's tree request until just after `focus()` reproduced the card's error exactly (`Received: inactive`, `14 × locator resolved`, at `focusByKey`), 2 of 2, with the old assertion.
- **No natural red.** 60 runs of the step under 8 busy loops (1-minute load up to about 11) gave no red. The first tree was never more than 6 ms behind the others on this machine, so the card's Verification is met by the forced red's trace, not by one that happened on its own.
- **The worker's fix.** With the `.and(":focus")` assertion, the forced timing was green 2 of 2, and 60 runs of the all-files test under load passed.
- **The approver's version.** The handle version passes `e2e/focus.spec.ts`, 18 of 18. Mutation probe: a `blur()` injected after the `focus()` turns both all-files tests red (`Expected: true, Received: false`).
- **Gates on the worker's tree.** `bun run lint`, `typecheck` and `check:comments` exit 0. `test:ui` passed 150 with 2 skipped. `test` and `test:bun` exit 1 with only the eleven embedding reds (huggingface.co is blocked). `perf` was not run, and pull-request CI is the verdict.
- **Review.** One isolated reviewer found three minors and one hypothesis:
  - the commit and CHANGELOG title claimed more than `.and(":focus")` checks;
  - that assertion could not tell a `focus()` that did nothing from one that worked while another match held the focus;
  - 08-ui said "the rows" where only the unchanged rows arrive late;
  - the Verification criterion, answered above.

  All four are closed by the approver's commit: the handle pins the element, and the wording is fixed.

**Documentation in the same pass.** `docs/reference/08-ui.md`, "A focused row in a list still arriving" under "Inside the end-to-end suites"; `CHANGELOG.md`, Fixed.

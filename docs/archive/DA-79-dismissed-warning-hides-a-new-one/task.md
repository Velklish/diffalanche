# DA-79 · A review re-read sets warnings behind the dismissal logic, so a warning found after a dismissal never appears

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The warnings bar has a rule, and the store has two writers of its state that disagree about it. The
live path enforces the rule:

[src/ui/store.ts:1140-1149](../../../src/ui/store.ts)

```ts
  setWarnings: (warnings) => {
    const before = get().warnings;
    if (before.length === warnings.length && before.every(sameWarning(warnings))) return;
    // A warning the scan has just found is news even to a reader who put the
    // bar away: what was dismissed was the list before it (`docs/SPEC.md`
    // section 5 — nothing is silently dropped). The remembered dismiss goes
    // with it, or a reload would hide a bar the reader has never seen.
    writeDismissed(null);
    set({ warnings, warningsDismissedFor: null });
  },
```

The review path does not. `fromDocument`, which builds the store state out of a freshly read
review document, writes the field flat:

[src/ui/store.ts:1508](../../../src/ui/store.ts)

```ts
    session: document.session,
    warnings: document.warnings,
```

No comparison with what was there, and no reset of `warningsDismissedFor`. The bar hides on that
one field and nothing else — `if (warnings.length === 0 || (session !== null && dismissedFor ===
session)) return null;`
([src/ui/components/WarningsBar.tsx:15](../../../src/ui/components/WarningsBar.tsx)) — and the
dismissal is keyed by session *name* (store.ts:1135-1138), which neither a base change nor a scope
change moves.

So: a reader dismisses the bar on session `ls-3`, then changes the base through the picker.
`applyBase` re-reads the whole review, because the change set is computed against the base
([store.ts:617](../../../src/ui/store.ts)). The new base does not resolve in one repository, so
`document.warnings` now carries that repository's `ref does not resolve`. `fromDocument` stores it,
`warningsDismissedFor` is still `"ls-3"` and `session.name` is still `"ls-3"`, and the bar returns
`null`. The reader reviews a repository against a base that silently fell back, with nothing on
screen saying so. `applyScope` ([store.ts:830](../../../src/ui/store.ts)) has the same hole: a
widened scope that pulls in a repository with a warning shows nothing.

Nothing else compensates. A metadata change makes the watcher emit `session-changed`, not
`warnings` ([src/core/watcher/index.ts:322-328](../../../src/core/watcher/index.ts)) — the
`warnings` frame is emitted only from a file-triggered rescan (watcher/index.ts:242) — and both
`applyBase` and `applyScope` call `markSelf("review", name)` before re-reading, so `claimSelf` in
`live.ts` swallows that `session-changed` frame as the page's own write.

The reference states the un-dismiss rule as a property of the live frame only — "a list that says
something new un-dismisses it", [08-ui.md](../../reference/08-ui.md) event table — and justifies
the per-session key by saying a warning is about the base that session resolves, which is exactly
the case that fails here: the session stayed, the base changed. The suite matches the reference and
covers only `setWarnings` (`tests/ui-live.test.ts`), never the `loadReview` path.

## Work to do

- Put both writers behind one rule. The straightforward shape is for `fromDocument`'s caller — or
  `loadReview` around it — to go through the same comparison `setWarnings` already implements
  instead of assigning `warnings` directly, so that a list that says something new clears
  `warningsDismissedFor` and `sessionStorage` alike, whatever produced the list.
- Decide what "something new" means across a session switch, and say it where the field is defined.
  `fromDocument` already knows whether the session changed (`switched`, store.ts:1498), and a
  switch to another session is not the same event as the same session's list growing: the first is
  already handled by the key, the second is this bug. Candidates are to run the comparison only
  when the session is unchanged, or to run it always and let the key do nothing.
- Keep the early return of `setWarnings`: an identical list must not clear a dismissal, or every
  re-read would bring the bar back. Update [08-ui.md](../../reference/08-ui.md) in the same pass —
  the event table makes the un-dismiss rule a property of the `warnings` frame, and after this it
  is a property of the state, whichever path sets it.

## Out of scope

- The dismissal key itself. Keying on the session name is the documented decision, and this entry
  does not reopen it — a warning that changes under an unchanged name is what has to be noticed.
- The watcher not emitting `warnings` on a metadata change. That is the other end of the same gap
  and a bigger decision (the rescan is what computes the list); this fix does not need it, because
  the review re-read already carries the new list to the page.
- The bar's markup, placement and stickiness, which the handoff settles.

## Verification

- A store test dismisses the warnings on a session, then feeds `loadReview` a document for the same
  session whose `warnings` carry an entry that was not there, and asserts the bar's condition is
  false again — `warningsDismissedFor === null` and the stored `sessionStorage` key cleared.
  Restoring the flat `warnings: document.warnings` assignment turns it red.
- A second case asserts the opposite direction: a re-read whose warnings are identical leaves the
  dismissal alone, so an ordinary reload does not resurrect the bar.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.

# DA-36.3 · A suggestion row does not say its severity was the model's, and TAB stores it as manual

- **Scope:** 06-cli, 08-ui, 09-ml
- **Created:** 2026-09-24
- **Parent:** DA-36.2
- **Cost:** minor
- **Previous order:** 1180
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Evidence

Finding discovered while working on DA-36.2. Since DA-36.2 every suggestion
carries its comment's `severitySource`, and a neighbour whose source is `auto`
is listed but does not vote. Neither door says which rows those are. The
composer draws a row's severity the same whoever chose it:

<!-- quote:before:../../../src/ui/Composer.tsx -->
      <span className={`suggestion-sev ${row.severity}`}>{row.severity.toUpperCase()}</span>
<!-- /quote -->

and `suggest` prints `one.severity` in its table the same way
(`src/cli/commands/suggest.ts`, the `rows` of `run`). So the proposal above the
rows can differ from the severity of the nearest row with nothing on the screen
saying why.

The second half is a path around DA-36.2's rule. Taking a row copies its
severity as the reviewer's own:

<!-- quote:before:../../../src/ui/store.ts -->
    // The row's severity is one the reader has just read and taken: theirs, not the model's.
    set({ sev: row.severity, sugIdx: index });
<!-- /quote -->

and the comment is then sent `manual`, which votes. A row whose severity was an
unconfirmed `auto` becomes, one `TAB` later, a `manual` vote for the same label —
the self-confirmation DA-36.2 closed for `AUTO`, reached through the panel.
Whether that matters depends on how often reviewers take a row, which nothing
measures; and it may be the intended reading ("they read it and took it"), which
is a product decision, not a worker's. Not reproduced in the UI: read from the
code on `bfddbc9`.

## What it would take

Mark an `auto` row in both doors (`warning (auto)`, as `show` prints a thread),
and decide whether a row taken from an `auto` neighbour is stored `manual` or
keeps the label it came with.

## Owner's decision (2026-09-24)

A row taken from a neighbour whose severity is an unconfirmed `auto` keeps the source it came with: the comment is stored `auto`, does not vote until an agent or a person confirms it (`reply --confirm-severity`), and the row says its severity is the model's in both doors. The stub in `e2e/composer.spec.ts` that answers `/api/suggest` without `severitySource` is part of this entry.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

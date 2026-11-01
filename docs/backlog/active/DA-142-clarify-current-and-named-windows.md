# DA-142 · Clarify how CLI current changes affect bare and named review windows

- **Scope:** [06-cli](../../reference/06-cli.md); [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-302
- **Audit priority:** P2
- **Evidence status:** confirmed_static
- **Previous order:** 1050
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context
README and the shipped apply skill make a blanket claim that CLI task selection changes the human UI. Named review windows are address-local and ignore current-changed, while bare windows follow current.

## Evidence
`README.md:127–128` says review use switches both UI and CLI. `skills/diffalanche-apply/SKILL.md:195–196` says review new/use change what the human UI is looking at. `src/ui/live.ts:114–117` returns from current-changed when reviewName is non-null. The current window contract is documented in 08-ui and ADR-010.

## Scope
Clarify both entry points: a bare window follows current; a named ?review= window stays on its task; CLI current is its own default selection. Preserve the skill prohibition on unauthorized lifecycle/selection changes and explicit --review guidance. Change prose only.

## Acceptance criteria
- README states the bare-window, named-window and CLI-default cases separately.
- The apply skill retains the no-unsolicited-task-switch rule with an accurate rationale.
- --no-use and explicit --review guidance remain correct; runtime and permission boundaries are unchanged.

## Verification
Proposed, not run: compare with src/ui/live.ts, ADR-010 and the window contract in 08-ui; run documentation lint. Existing targeted UI stream/empty tests may be run if implementation changes enter scope.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

## Related work and deduplication
No current live backlog task covers this documentation discrepancy. This is distinct from client task-switch races because it describes the intended selection model.

Regression requirement: the implementation adds or updates a suitable quote guard, targeted assertion or existing lint rule for the corrected current claim. Show that it rejects the pre-change wording; do not infer success from link lint alone.

## Registration boundary

Audit finding PQA-302; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Documentation currency track. Preserve this card as a separate acceptance subject and keep all original requirements. Coordinate README and CHANGELOG with the safe-content track; root merges shared prose by meaning. Use a durable narrow regression guard that rejects the pre-change normative text and a semantic mutation probe. No runtime or permission contract change is authorized by this documentation correction.

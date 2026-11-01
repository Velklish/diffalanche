# DA-133 · Investigate and expose the selected base in the accessibility tree

- **Order:** 1090
- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major (hypothesis)
- **Audit finding:** PQA-202
- **Audit priority:** P2
- **Evidence status:** hypothesis


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The base picker is a single-choice control. Users of assistive technology need to discover which mode and branch are selected.

## Evidence

Source:

- `src/ui/components/BasePicker.tsx:31-35,84-106`
- `src/ui/components/FirstRun.tsx:110-120`

Observed: Live DOM readback showed the selected mode contains a visible check mark but has no aria-pressed or aria-checked; branch rows likewise have no exposed selected state.

Limits: No actual screen reader was tested; the check mark may be announced. The user impact is a hypothesis.

## Work to do

Check the accessibility tree and at least one supported screen reader; expose a coherent single-selection state for modes and branch candidates if the selection is not reliably conveyed. Keep the visual design and keyboard interaction.

## Acceptance criteria

- The accessibility tree identifies the current mode and branch and updates after keyboard and pointer selection.
- The selected mode and branch can be discovered without relying on colour or a symbol alone.
- Existing focus, Enter and Escape behaviour stays usable.

## Verification

Proposed implementation checks, not run during registration:

- Add targeted accessible-state browser assertions for the base picker and record the screen reader, browser and observed result.
- Run bun run test:ui and the repository gates after implementation.

## Registration boundary

Audit finding PQA-202; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

# DA-134 · Expose the language of Russian and English interface text

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-204
- **Audit priority:** P2
- **Evidence status:** confirmed_markup
- **Previous order:** 990
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The interface intentionally mixes Russian and English. Assistive technologies receive the language of the document for unmarked text.

## Evidence

Source:

- `src/ui/index.html:2`
- `src/ui/components/FirstRun.tsx:36-40,83-85`

Observed: The document is lang=en; a source search found no other lang annotation in src/ui.

Limits: Incorrect pronunciation is plausible but was not measured with a screen reader.

## Work to do

Mark static and generated UI text with the appropriate language without assuming the language of user-authored comment bodies; preserve mixed English product and control names.

## Acceptance criteria

- Representative Russian and English UI strings, including first run and dynamic notifications, expose their correct language.
- User-provided comment text is not falsely assigned a language without a product rule.
- Visual layout and keyboard behaviour remain unchanged.

## Verification

Proposed implementation checks, not run during registration:

- Add DOM/accessibility assertions for representative mixed-language surfaces and dynamic messages; record a manual screen-reader check if available.
- Run bun run test:ui and the repository gates after implementation.

## Registration boundary

Audit finding PQA-204; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

# DA-139 · Align the current design handoff with renderer, review storage and Escape behavior

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-004
- **Audit priority:** P2
- **Evidence status:** confirmed_static

## Context
The design handoff contains current implementation instructions that disagree with production contracts and with another section of the same document. A UI change implemented from it can select the wrong renderer, storage shape or keyboard behavior.

## Evidence
`docs/design/HANDOFF.md:11` names `@git-diff-view/react`; `package.json:56` and `src/ui/renderers/ReactDiffFile.tsx` use `react-diff-view`. HANDOFF:279 shows `reviews/ls-240372.json`, and :325 instructs writes to `.diffalanche/reviews/<name>.json`; storage uses one directory per task containing review.json, comments.json and diff.json. HANDOFF:278 says Escape closes everything and removes the composer; :305 says it closes only the top layer, consistent with the keyboard acceptance contract.

## Scope
Correct the active HANDOFF instructions and illustrative storage message, preserving the historical HTML prototypes and design rationale. Keep the existing top-overlay Escape rule and preservation of the draft below it; this task does not authorize changing keyboard behavior.

## Acceptance criteria
- The renderer named by HANDOFF matches the installed production renderer.
- Current storage instructions describe the task directory and actual files; examples do not present the old single JSON file as current.
- HANDOFF has one unambiguous Escape contract: close the top applicable layer and preserve an underlying draft.

## Verification
Proposed, not run: compare the updated prose with package.json, src/core/storage, src/ui/keys.ts and e2e/keyboard.spec.ts; run the repository documentation lint. Use a narrow quote guard or targeted assertion for the corrected normative claim and demonstrate that the pre-change text is rejected; do not add a test that merely restates unrelated prose.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

## Related work and deduplication
No existing live backlog task covers these three handoff contradictions. PQA-200 is a related implementation fix for a hidden composer shortcut; the documentation task preserves the already accepted overlay rule rather than changing it.

## Registration boundary

Audit finding PQA-004; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

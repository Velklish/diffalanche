# DA-44 · LSP tier: go to definition and find references

- **Scope:** 09-ml, 07-server, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-39

## Context

`docs/SPEC.md` section 3, decision 11, tier 3: LSP through a config table `language → server command`; the tool finds servers on PATH and prints the install command for missing ones. Section 5 Phase 3: go to definition and find references when a server is configured and installed.

## Work to do

- `src/core/lsp`: start a configured server per language on demand with the repository as root, `initialize`, `textDocument/definition` and `textDocument/references` over the working tree; shut down idle servers; the PATH check and install hint.
- UI: a context action on an identifier in the diff (`Go to definition`, `Find references`) that opens the file in browse mode or lists references in the search modal.

## Out of scope

- Any bundled language server.

## Verification

- With `typescript-language-server` configured on the fixture, go to definition from a call site opens the declaring file; a missing server prints its install command and the UI action is disabled with the hint.

## Deferred

- **Deferred:** 2026-09-29
- **Reason:** The UI half, a context action on an identifier that opens browse mode or lists references, needs the Impeccable context loader, `audit` and `polish`, which cannot run in the cloud session. The server half, starting a configured server per language and asking it for definitions and references, could land on its own; that split is the owner's call, since the card's Verification is the UI action.
- **Return condition:** A session where the Impeccable launcher runs, or the owner splits the server half into a card of its own.

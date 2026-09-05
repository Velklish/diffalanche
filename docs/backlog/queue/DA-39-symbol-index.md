# DA-39 · Symbol index with tree-sitter

- **Order:** 390
- **Scope:** 09-ml, 07-server, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-37

## Context

`docs/SPEC.md` section 3, decision 11, tier 2: a symbol index built with tree-sitter; grammars for popular languages ship with the tool, others are added through config; no language is hard-coded. Section 5 Phase 2: jump to a symbol by name in any repository.

## Work to do

- Decide the tree-sitter binding that runs under Node and Bun (WASM grammars are the likely answer; measure) and the bundled grammar set (at least TypeScript, JavaScript, C#, Python, Go, Rust, Java); `config.json` gets a `grammars` table for extra languages.
- `src/core/ml/symbols`: index definitions (functions, classes, methods, types) per repository, updated on `diff-changed` for the changed files; a query by name with fuzzy matching.
- Global search: the `symbol` result tag with the definition preview; `⏎` opens the file at the definition.

## What Phase 1 changed

Phase 1 built global search (DA-26) with the `symbol` tag named as this task's in `src/ui/search.ts` and [08-ui.md](../../reference/08-ui.md). The live stream's `diff-changed` event ([07-server.md](../../reference/07-server.md)) is what re-indexes the changed files. The runtime rule stands: a binding that needs `Bun.*` or a Node-only module outside `src/server/runtime.ts` is a decision ([ADR-008](../../adr/adr-008-diff-rendering-verdict.md)), which is why WASM grammars are the likely answer.

## Out of scope

- References and go-to-definition through a language server (DA-44).

## Verification

- Vitest: the index of the synthetic review finds a known class in C# and a function in TypeScript by name; indexing 300 files completes within a time recorded in the reference.
- Playwright: typing a symbol name lists it with the `symbol` tag and opens its definition.


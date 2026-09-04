# DA-39 · Symbol index with tree-sitter

- **Scope:** 09-ml, 07-server, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-37

## Context

`docs/SPEC.md` section 3, decision 11, tier 2: a symbol index built with tree-sitter; grammars for popular languages ship with the tool, others are added through config; no language is hard-coded. Section 5 Phase 2: jump to a symbol by name in any repository.

## Work to do

- Decide the tree-sitter binding that runs under Node and Bun (WASM grammars are the likely answer; measure) and the bundled grammar set (at least TypeScript, JavaScript, C#, Python, Go, Rust, Java); `config.json` gets a `grammars` table for extra languages.
- `src/core/ml/symbols`: index definitions (functions, classes, methods, types) per repository, updated on `diff-changed` for the changed files; a query by name with fuzzy matching.
- Global search: the `symbol` result tag with the definition preview; `⏎` opens the file at the definition.

## Out of scope

- References and go-to-definition through a language server (DA-44).

## Verification

- Vitest: the index of the synthetic review finds a known class in C# and a function in TypeScript by name; indexing 300 files completes within a time recorded in the reference.
- Playwright: typing a symbol name lists it with the `symbol` tag and opens its definition.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.

# DA-1.2 · One tsconfig gives server and CLI the DOM lib

- **Scope:** 07-server, 06-cli, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-19

## Context

`tsconfig.json` covers `src`, `scripts`, and `tests` with a single `lib`, and it
has to carry `DOM` for the React UI:

```
$ python3 -c "import json,re;print(json.load(open('tsconfig.json'))['compilerOptions']['lib'])"
['ES2023', 'DOM', 'DOM.Iterable']
```

So a `window.fetch`, a `localStorage`, or a `document` reference inside
`src/server` or `src/cli` type-checks clean, although AGENTS.md and
[ADR-002](../../adr/adr-002-stack-and-delivery.md) allow those files only APIs
shared by Node and Bun. `types: ["node"]` is the mirror of the same gap: `src/ui`
gets the Node globals it must not use in the browser. The type checker is the
cheapest place to hold that boundary, and right now it does not.

## Work to do

- Split the configuration: a root config without `DOM` for `src/core`,
  `src/cli`, `src/server`, `scripts`, and `tests`; a separate config for
  `src/ui` with `DOM` and without `types: ["node"]`, wired as a project
  reference so `bun run typecheck` still checks everything in one command.

## Out of scope

- The UI shell itself and its Vite build: DA-19 creates them, and this split is
  cheapest to land in the same pass, when there is UI code to check it against.

## Verification

- A `document.title` reference added to `src/server/index.ts` fails
  `bun run typecheck`; the same reference in `src/ui` passes.
- `bun run typecheck` still exits 0 on the unchanged tree.

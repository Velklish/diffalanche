# DA-25.3 · `tests/ui-live.test.ts` reads `sessionStorage` directly, so `test:bun` is red

- **Scope:** 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-25

## Context

`bun run test` is green and `bun run test:bun` is not. One test of the warnings
bar reads the global `sessionStorage` in the assertion itself:

```
$ bun run test:bun
 FAIL  tests/ui-live.test.ts > the warnings bar > forgets the remembered dismiss
       too, so a reload does not hide it again
ReferenceError: sessionStorage is not defined
 ❯ tests/ui-live.test.ts:358:12

 Test Files  1 failed | 31 passed (32)
      Tests  1 failed | 393 passed (394)
```

The store itself is careful — `src/ui/store.ts:1259` picks its storage behind
`typeof localStorage === "undefined"` and `typeof sessionStorage === "undefined"`
guards, which is why the store under test does the right thing on both runtimes.
The test is not: line 358 calls the global with no guard and no stub.

Node has the two globals (behind `--localstorage-file`, which is why the Node
run also prints `Warning: --localstorage-file was provided without a valid path`
and carries on); Bun's runtime does not, so the same assertion is a
`ReferenceError` there. The suite is meant to run identically on both — that is
what `test:bun` is for, and what `tests/runtime.test.ts` guards
([11-perf.md](../../reference/11-perf.md), *the runtime the unit suite runs on*).

Found while running the gates for DA-28. It is not DA-28's: the file is
byte-identical to the one on `worktree-promptobus-da-run-ui-c-t20260905-011159`
at `db294e3`, and so is `src/ui/store.ts`.

## Work to do

- Assert through the store rather than through the global, or stub the two
  storages for the suite the way the store's own guard expects to find them —
  whichever `tests/ui-live.test.ts` already does for the sibling case at line
  346, which passes on both runtimes.
- Keep the assertion's subject: what it proves is that a dismiss is *forgotten*,
  not that some storage exists.

## Out of scope

- Giving the store a storage abstraction. The guard it has is enough; the test
  is what reaches around it.

## Verification

- `bun run test` and `bun run test:bun` are both green, with the same test count.

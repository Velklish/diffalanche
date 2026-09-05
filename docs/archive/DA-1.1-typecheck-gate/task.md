# DA-1.1 · `bun run typecheck` runs in CI but is not a project gate

- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-1

## Context

DA-1 names exactly two new gates — `bun run test` and `bun run lint` — and that
is what `gates` in `backslop.json` holds. The CI workflow runs a third command:

```
$ sed -n '/bun run/p' .github/workflows/ci.yml
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test
$ python3 -c "import json;print(json.load(open('backslop.json'))['gates'])"
['npx github:Velklish/backslop#v0.3.1 lint', 'bun run lint', 'bun run test']
```

So a change that type-checks red passes the local gate list and only fails after
a push. Whether that gap is intended is the owner's call: adding the command to
`gates` is one line, and it lengthens every task's gate run by the tsc time
(0.3 s on the empty skeleton, `time bun run typecheck`).

## Work to do

- Decide whether `bun run typecheck` joins `gates` in `backslop.json`; if yes,
  add it and name it in the README development section next to lint and test.

## Out of scope

- The Node and Bun smoke matrix and the binary targets (DA-4, DA-15) and the
  performance job (DA-5): CI grows those in their own tasks.

## Verification

- `npx github:Velklish/backslop#v0.3.1 lint` is green, and the gate list matches
  the commands `.github/workflows/ci.yml` runs.

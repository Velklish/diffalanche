# DA-1.3 · The npm package excludes `skills/`

- **Scope:** 10-skills (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-29

## Context

`package.json` ships only the bundle:

```
$ python3 -c "import json;print(json.load(open('package.json'))['files'])"
['dist']
```

`skills/README.md` says the opposite — the skills are shipped with diffalanche —
and `docs/SPEC.md` section 9 calls them "the repository ships two skills". As it
stands, `npx diffalanche` gives an agent the CLI and no skills, so the agent
protocol arrives only for people who clone the repository.

Both fixes are one line and they are not equivalent: adding `skills` to `files`
publishes the markdown as-is, while bundling into `dist` lets the build rewrite
paths and version strings. The choice belongs with the task that writes the
skills and the one that publishes the package.

## Work to do

- Decide where the shipped skills live in the published package, and make
  `package.json` match `skills/README.md` and `docs/SPEC.md` section 9.

## Out of scope

- Writing the skills (DA-29) and the release pipeline itself (DA-31); this entry
  only records that the package contents contradict the documentation today.

## Verification

- `npm pack --dry-run` lists the shipped skills, and a fresh
  `npx diffalanche` install exposes them where the skills' own documentation
  says they are.

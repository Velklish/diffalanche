# DA-25.4 · The live spec's fixture restore lands in the next spec's page

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-25, DA-27
- **Taken:** 2026-09-05

## Context

Finding discovered while running the gates for DA-32 on a quiet machine.
Evidence: `bun run test:ui`, 1 failed of 58 — `e2e/shell.spec.ts:41` "the empty
shell in the dark theme":

```
Expect "toHaveScreenshot(shell-dark.png)" with timeout 5000ms
  - 5975 pixels (ratio 0.01 of all image pixels) are different.
  - Expected an image 1560px by 900px, received 1560px by 17943px.
```

The shell spec stubs `GET /api/review` empty and `GET /api/activity` empty, and
nothing else. The spec before it in file order, `e2e/live.spec.ts`, appends a
line to a fixture file and puts the file back in its `finally`; the restore is
an edit too, and the watcher reports it as `diff-changed` a few hundred
milliseconds later — by which time the shell spec's page has connected to
`GET /api/events`. That page holds a review with no repositories, fetches the
real diff the frame names, inserts the repository as a newly appearing one
(`applyRepositoryDiff`), and grows from 900 px to 17 943 px between two
screenshots. In isolation the test passes three times out of three.

## Work to do

- `e2e/live.spec.ts`: after the restore, wait for the page to have taken it —
  the card no longer shows the appended line — so the spec leaves the stream
  quiet for whoever runs next.

## Out of scope

- Stubbing the stream in the shell spec: the reduced-motion test in the same
  file needs the real `watching` state.

## Verification

- `bun run test:ui` green in file order; the shell screenshot test unchanged.

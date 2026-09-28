# DA-118 · The keyboard spec's R reads the disk as soon as the card turns resolved, which is before the write lands

- **Order:** 190
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-28
- **Dependencies:** none

## Context

The `UI suite` of Velklish/diffalanche#3 (run 36498953778, 2026-09-28) failed on
`e2e/keyboard.spec.ts:365` › "C opens the composer and R resolves the focused
thread": `Expected: "resolved"`, `Received: "open"`. The pull request touched no
UI code. The test waits for the rail card to take the `resolved` class and then
reads `comments.json` at once through the CLI — but `write()` in `src/ui/store.ts`
puts the new status on the card first and posts it after (08-ui.md, "Threads"), so
the class can be on the screen before the file says so.

## Work to do

- Wait for the file, not for the frame: poll the CLI's answer until it says
  `resolved`, within the suite's usual deadline.

## Out of scope

- The optimistic write itself, which is the product's intent.

## Verification

- The test polls the disk; `grep -n "expect.poll" e2e/keyboard.spec.ts` names it.
- `bun e2e/quiet.ts e2e/keyboard.spec.ts` passes.

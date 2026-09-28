# DA-118 · Result

**Closed 2026-09-28.** Completed: `e2e/keyboard.spec.ts` › "C opens the composer and R resolves the focused thread" waits for the disk with `expect.poll` on the CLI's `list --json` answer until the thread's status is `resolved`, after the rail card's class; it used to read the file once, right after the class, and the store turns the card before its `POST` lands (`write()` in `src/ui/store.ts`, 08-ui.md "Threads"). The red it came from: the `UI suite` of Velklish/diffalanche#3, run 36498953778, `Expected: "resolved"`, `Received: "open"`, on a pull request that touched no UI code; its re-run passed.

**Verification.** `bun e2e/quiet.ts e2e/keyboard.spec.ts` in the cloud container: 14 passed. The race is not reproducible on demand, so the red is not re-created; what the change guarantees is read off the code — the assertion now retries until Playwright's expect timeout. Review: one isolated reviewer over DA-117.1, DA-118 and DA-116 in one pass, which checked the diagnosis against `write()` and ran the spec, 14 passed; its five minor findings were fixed before the push (DA-117.1's result lists them).

**Documentation in the same pass.** `CHANGELOG.md`, `### Fixed`.

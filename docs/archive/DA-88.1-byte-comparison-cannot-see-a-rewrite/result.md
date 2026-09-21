# DA-88.1 · Result

**Closed 2026-09-22.** Completed. "This file was not written" is now asserted by the time of the write rather than by its bytes. `tests/cli-comments.test.ts` guarded the `--repo` refusal by reading `diff.json` before the failing command and asserting the same string after it; a rewrite by `refreshRepository` writes the *same bytes* when the repository has not changed since the last scan, which is exactly the state a fixture is in, so the assertion held whether the refusal rescanned or not and the invariant the test is named after was not covered by it. What landed is `tests/helpers/untouched.ts`, a shared helper that stamps the file's mtime back to 2020-01-01 before the command and asserts both the stamp and the bytes afterwards, used in four places: the `--repo` refusal and the anchor-level refusals of `comment`, the refused scope narrowing in `tests/scope.test.ts`, and the write-API comment in `tests/write-api.test.ts`. The card asked whether the invariant deserved a shared helper; the answer taken is yes — it was asserted four ways in four places and the correct way is not obvious, the byte comparison being the trap the card is named after, so one helper makes the correct way the only way.

**One correction to the card, found by running its own mutation.** The card's Verification says the `--repo` case is reddened by moving the `--repo` check after `refreshRepository`. On the card's original input that mutation never reaches a write at all: without `--line`, `refreshRepository` is guarded by `if (line !== null && repo !== null)` and is not called. The case now passes `--path file.txt --line 5`, so the refusal stands in front of the refresh. With the mutation applied it is red — but on the *message* assertion, not on the mtime: `refreshRepository` against a path no repository is at dies with `git could not be started: ENOENT` before writing anything.

```
AssertionError: expected 'diffalanche: git could not be started…' to contain 'no repository "repos/group/gamma" und…'
  tests/cli-comments.test.ts:163
Tests 1 failed | 16 passed (17), exit 1
```

So for the `--repo` case the mtime evidence is defence in depth and not a live probe target. This is recorded rather than smoothed over: the card's stated verification does not fire the assertion it names, and that is what this task leaves open about its own coverage.

**Verification.** Probe P3 — `assertAnchorLevels({ repo, path, line, endLine });` replaced by `void assertAnchorLevels;` in `src/cli/commands/comment.ts` — is where the mtime assertion is the firing one:

```
AssertionError: …/reviews/alpha/diff.json was written: expected 1790011110974.5703 to be 1577836800000
  tests/helpers/untouched.ts:25
Tests 1 failed | 16 passed (17), exit 1
```

Before the change the same mutation exited **0**, 17 of 17, although the refusal did rescan and rewrite — which is the defect this task is about, measured rather than argued. The track's integration gate, the per-commit build and the landing of the four commits into `main` are recorded once, in [DA-67](../DA-67-two-writes-outside-the-session-lock/result.md): `gates 7, green 5` on `e69f21f`, four of four commits typechecking standing alone.

**Documentation in the same pass.** `README.md`, `docs/reference/06-cli.md`, and a `### Fixed` entry in `CHANGELOG.md`.

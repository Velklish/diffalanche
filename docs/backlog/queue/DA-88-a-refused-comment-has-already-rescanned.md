# DA-88 · A comment refused on a bad anchor has already rescanned git and rewritten diff.json

- **Order:** 430
- **Scope:** 06-cli, 04-domain (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`comment` states an invariant in three places and keeps it for one of the two
ways a comment is refused. `docs/reference/06-cli.md:234-235`: "a `comment` that
ends in exit 1 must not have rewritten `diff.json` on its way there." The same
intent is written into the code at
[src/cli/commands/comment.ts:56-62](../../../src/cli/commands/comment.ts) — the
repository check and the scope check both run "before the repository is read
again", so a refusal costs no git process.

The anchor-level checks do not. The CLI refreshes the cache on nothing but
`line` and `repo` ([src/cli/commands/comment.ts:63-70](../../../src/cli/commands/comment.ts)):

```ts
    // The anchor is captured from `diff.json`, so the repository the line is in
    // is read again first: a comment written right after an edit has to point
    // at the line that is there now.
    if (line !== null && repo !== null) {
      await refreshRepository(config, session, review.base, repo, review.scope);
    }

    const written = await addComment(config.dataDir, session, {
```

`path` is absent from that guard, and the checks that reject a `line` without a
`path` (`"a line anchor needs a file"`) or a backwards range
(`"the range 4-2 runs backwards"`) live behind `addComment`: `assertAnchorLevels`
at [src/core/domain/comments.ts:112-133](../../../src/core/domain/comments.ts),
called from [comments.ts:152-158](../../../src/core/domain/comments.ts) — after
the refresh.

`refreshRepository` always writes on the path it takes: the patch branch calls
`writeDiffCache` at [src/core/change-set.ts:243-247](../../../src/core/change-set.ts)
unconditionally, and the stale-base branch does a full `scanReview` and writes at
[change-set.ts:252-256](../../../src/core/change-set.ts).

Reproduced by forcing `diff.json`'s mtime back to 2020 and running one failing
`comment` each:

```
before 2020-01-01-00:00:00
$ comment --repo r1 --line 2 --severity nit --body x                             -> exit=1  "a line anchor needs a file"
after  2026-09-11-03:28:10

before 2020-01-01-00:00:00
$ comment --repo r1 --path f.txt --line 4 --end-line 2 --severity nit --body x   -> exit=1  "the range 4-2 runs backwards"
after  2026-09-11-03:28:11
```

What it costs is bounded and worth stating plainly: a forgotten `--path` or a
transposed `--line 42 --end-line 12` spawns the git processes for that repository
and rewrites `reviews/<name>/diff.json`, so the watcher and any connected UI see
a write produced by a command that wrote no comment. No data is wrong afterwards.
The defect is the false invariant plus the wasted read, not corruption.

The suite asserts the invariant byte for byte, but only for the `--repo` refusal:
[tests/cli-comments.test.ts:144-165](../../../tests/cli-comments.test.ts),
"refuses a --repo no repository is at, before it writes anything". The
anchor-level exits have no such case.

## Work to do

- Decide where the anchor levels are checked for this caller, and say which in
  the entry that closes this. The candidates are: widen the CLI's guard to
  `path !== null` so a line without a file never reaches the refresh; call the
  existing level check from the CLI ahead of the refresh, the way
  `assertAnchorInScope` is already called ahead of it at
  [comment.ts:62](../../../src/cli/commands/comment.ts); or move the refresh
  inside the domain so there is one order for every caller. The middle one keeps
  a single implementation of the rule and matches the shape already there; the
  first duplicates the condition in two files.
- Whichever is chosen, the domain keeps its own check: `addComment` is called by
  more than the CLI, and the reference says the domain checks it "for every
  caller".
- Close the remaining `assertAnchorLevels` cases in the same pass: `line < 1` and
  a range without a first line are reachable the same way, and `endLine` is not
  read until the call itself ([comment.ts:74](../../../src/cli/commands/comment.ts)).
- Leave `docs/reference/06-cli.md:234-235` saying what it says, and check the
  finished change against it rather than weakening the sentence.

## Out of scope

- The refresh itself and whether an anchor should be captured from a freshly read
  repository at all: that behaviour is the point of the command.
- `refreshRepository` writing unconditionally. It is called by paths that should
  write; the fix belongs at the call site, not in the change-set module.
- The `--repo` and scope refusals, which already run before the refresh and are
  already tested.

## Verification

- `tests/cli-comments.test.ts` gains cases modelled on the existing one at line
  144: for `--repo … --line N` with no `--path`, and for `--line 4 --end-line 2`,
  read `diff.json` before and assert the bytes are identical after, alongside the
  exit code and the message.
- Those cases go red on the code as it stands today: run them before the fix and
  they fail on the byte comparison, which is the mutation probe for this change —
  commit first, then reverse the guard and watch them fail.
- The comment count stays zero in both cases, so a fix that skips the refresh by
  also skipping the write of a valid comment is caught.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  `bun run perf` is unaffected — the change removes work from a failing path
  only — but it is part of the gate set.

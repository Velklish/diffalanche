# DA-65 · Every scan writes .git/index in every reviewed repository, and the read-only rule is guarded by one assertion

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The first rule of the project — the tool never writes to a repository it reviews — is broken by the
one call that reads the change set, and the test that guards the rule cannot see it.

[src/core/git/run.ts:87-90](../../../src/core/git/run.ts) runs the porcelain:

```ts
/** The working tree against `base`, in the form the renderer and the parser both read. */
export function diff(cwd: string, base: string): Promise<string> {
  return git(cwd, ["diff", base, "--no-color", "--no-ext-diff", "-U3"]);
}
```

`git diff` refreshes the index on the way out, and refreshing it means taking `.git/index.lock` and
rewriting `.git/index`. Reproduced on git 2.39.5 (Apple Git-154) in a scratch repository, with the
exact argv this line builds, on three files touched but unchanged in content:

```
$ md5 -q .git/index                                                   # dd52d912…
$ GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git diff $(git rev-parse HEAD) --no-color --no-ext-diff -U3       # prints nothing, exit 0
$ md5 -q .git/index                                                   # fe0066e5…  REWRITTEN
```

What changes is the stat cache, not content: no blob, ref, or working-tree file is touched, so this
is a violated invariant and a narrow race — a `git add` running in that repository in the same
millisecond fails with `Unable to create '.git/index.lock': File exists` — rather than data loss.
The environment already in place does not prevent it: `GIT_OPTIONAL_LOCKS=0` still rewrote the index
in the same probe, because only `git status` consults that switch. Every scan of a twenty-repository
root is twenty such writes, and the watcher rescans on every fs event.

A plumbing call answers the same question without writing. On the same probe, with one real content
change, `git diff-index -p -M <sha> --no-color --no-ext-diff -U3` left `.git/index` byte-identical
and produced output byte-identical to the porcelain's (`diff` of the two captures, exit 0).
`git ls-files --others --exclude-standard -z` was checked the same way and leaves the index alone,
so `diff()` is the only writer in the module.

Four places in the repository state the opposite: [src/core/git/run.ts:20-22](../../../src/core/git/run.ts)
("nothing in this module writes an index, a working tree, or history"),
[src/core/git/index.ts:85-88](../../../src/core/git/index.ts) ("never written to — no index, no
working tree, no history"), [docs/reference/02-git.md](../../reference/02-git.md) in its opening
paragraph, and [docs/SPEC.md:294](../../SPEC.md) — "No writes to any repository: no commits, pushes,
resets, index changes, or file edits by the tool itself."

The reason nobody noticed is the guard. The regression test is
[tests/git.test.ts:425-438](../../../tests/git.test.ts), and its whole assertion is
`expect(statusAfter).toEqual(statusBefore)` over `statuses()` (tests/git.test.ts:135-143), which is
`git status --porcelain` in three fixture repositories. The same proxy is the entire guard at
[tests/change-set.test.ts:123](../../../tests/change-set.test.ts),
[tests/comments.test.ts:416](../../../tests/comments.test.ts),
[tests/scanner.test.ts:108](../../../tests/scanner.test.ts) and
[e2e/acceptance.spec.ts:194](../../../e2e/acceptance.spec.ts). `git status --porcelain` reports the
working tree, so it is blind to the index rewrite above, to ref updates, to anything written under
`.git/`, and to a commit made in a repository that started clean — `repos/g/api` is such a fixture.
Nothing else pins the argv: `git(cwd, args)` at src/core/git/run.ts:24 runs whatever it is handed,
there is no allowlist of subcommands, and the one test that installs a `git` shim on `PATH`
([tests/scope-scan.test.ts:88-93](../../../tests/scope-scan.test.ts)) logs the cwd and throws `"$@"`
away. So a later change that added `git fetch` to refresh `origin/main` — the natural fix for a
stale remote default branch — would reach the network from the user's machine and rewrite
`refs/remotes/*` with all five guards still green.

## Work to do

- Decide what `diff()` runs. The candidates are `git diff-index -p -M <base>` (plumbing, no refresh,
  byte-identical on the probe above) and keeping the porcelain while accepting the write as a
  documented exception. If the plumbing is chosen, settle which `diff.*` behaviours the porcelain
  applies by default that the parser in `src/core/diff` depends on — rename detection above all,
  which is why the probe passed `-M` explicitly — and pin them as flags rather than inheriting them,
  since `readOnlyEnv()` already nulls the global and system config.
- Verify the replacement against the fixtures the parser is exercised on, not only the scratch
  repository: renames, binary files, a file with a quote in its name, and the stat-dirty tree that
  produced the rewrite. The comparison to make is output equality against today's `git diff`.
- Strengthen the guard so that it is about writes rather than about the working tree. The cheapest
  form is a snapshot per fixture repository of `.git/index` (hash), `git rev-parse HEAD`, and
  `git for-each-ref`, compared before and after. One trap to avoid while doing it: `git status
  --porcelain` rewrites the index itself under the same conditions (same probe, `3cb74007…` →
  `59d41277…`), so the "before" snapshot must not be taken with it — `git --no-optional-locks
  status` leaves the index alone and today's guard does not pass that flag.
- Pin the argv as well as the effect: the `PATH` shim of tests/scope-scan.test.ts already exists and
  only needs to record `"$@"` for an assertion that the set of subcommands the scan runs is exactly
  the expected read-only set. Decide whether that assertion lives in the git suite or in the scan
  suite, since the shim is currently fixture setup for a different test.
- Correct the four statements above once the code is true again, or correct them to say what is
  actually true if the porcelain is kept.

## Out of scope

- The neighbouring git findings filed on their own: DA-61 (a reviewed repository's `.git/config`
  executes commands), DA-62 (the origin guard trusts `Host`) and DA-87 (an inherited git environment
  defeats the isolation `readOnlyEnv()` sets up). DA-87 touches the same function; none of the three
  is about writing.
- The unbounded fan-out over repositories at src/core/change-set.ts:165, which multiplies the cost
  of whatever `diff()` ends up running. Its nearest filed neighbour is DA-98, which is the same shape
  on the server's scan and candidate routes.

## Verification

- The reproduction above, run against a repository the tool has just scanned, leaves `.git/index`
  byte-identical: hash the file, run a full `diffalanche diff`, hash it again.
- A new assertion covers index, HEAD and refs per fixture repository, and turns red when `git diff`
  is put back in place of whatever replaces it — that is the test to try deliberately before
  calling this closed.
- An argv assertion turns red when a subcommand outside the read-only set is added to any caller of
  `git()`; `git fetch --quiet origin` inserted into `branch()` is the case to try, because it is the
  one the current guard misses entirely.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and `bun run perf` all
  pass; the perf gate matters here because the replacement changes what every repository read costs.

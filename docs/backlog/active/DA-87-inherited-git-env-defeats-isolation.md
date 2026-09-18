# DA-87 · Inherited GIT_* environment variables defeat the git module's documented isolation

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The git module states a guarantee it does not hold. `docs/reference/02-git.md:5-8`
says "`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` point at the null device, so a
developer's own git configuration cannot change what the tool reads", and the
same sentence is repeated as a comment above the code that is supposed to do it,
[src/core/git/run.ts:10-17](../../../src/core/git/run.ts):

```ts
/**
 * The environment every git process here runs in: `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` point at the platform's null device, so a developer's own
 * git configuration cannot change what the tool reads.
 */
function readOnlyEnv(): Record<string, string | undefined> {
  return { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull };
}
```

The spread carries every other `GIT_*` variable of the parent process through,
and two families of them survive the two null files. Stated exactly:
`readOnlyEnv()` neutralises only the two configuration *files*; inherited `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
`GIT_CONFIG_VALUE_n` (and `GIT_CONFIG_PARAMETERS`) are a separate configuration
source git applies anyway, and inherited `GIT_DIR` / `GIT_WORK_TREE` /
`GIT_INDEX_FILE` override the per-repository `cwd` entirely, because no call in
the module passes `-C`, `--git-dir` or `--work-tree` — every exported helper
hands `execFile` nothing but `cwd`
([src/core/git/run.ts:24-31](../../../src/core/git/run.ts)).

Reproduced on git 2.39.5 (Apple Git-154), in two scratch repositories under
`/tmp`, running the module's own diff argv
([run.ts:89](../../../src/core/git/run.ts)) with both null config files in place:

```
$ cd r1 && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.noprefix GIT_CONFIG_VALUE_0=true \
    git diff HEAD --no-color --no-ext-diff -U3 | head -1
diff --git f.ts f.ts

$ cd r1 && GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    GIT_DIR=../r2/.git git diff HEAD --no-color --no-ext-diff -U3 | head -1
diff --git a/other.txt b/other.txt
```

The first line is injected configuration applied despite the null files. The
second is the diff of the *other* repository, produced from inside `r1`.

What each costs the tool. With `diff.noprefix` in force the header parser loses
both paths: `gitLinePaths` finds no ` b/` and returns `{ old: null, new: null }`
([src/core/git/patch.ts:218-219](../../../src/core/git/patch.ts)), and
`withoutPrefix` ([patch.ts:317-320](../../../src/core/git/patch.ts)) would strip a
real leading directory off a path. With `GIT_DIR` set, `revParse`, `diff` and
`ls-files` all read that one repository whatever `cwd` they are given, so a review
shows the same change set under every repository path — and every command exits 0,
so nothing warns.

The trigger is uncommon and was not observed in a real session: it needs
diffalanche started from an environment that exports these — a git hook,
`git rebase --exec`, `git bisect run`, or an agent shell that set `GIT_DIR`. The
false guarantee in the documentation holds either way.

## Work to do

- Decide what the module's environment is, and record the choice where the next
  git command added to the module will read it. The candidates are: build the
  child environment from a copy of `process.env` with every `GIT_*` key deleted
  and only the ones the tool sets put back; delete a named list of the dangerous
  keys; or keep the spread and pin the repository per call with `-C` / `--git-dir`
  instead. Only the first removes the class rather than its known members.
- Whatever the model, `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`,
  `GIT_CONFIG_PARAMETERS`, `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are
  the six proven to matter and must be covered.
- Keep the read that is meant to see the developer's configuration: `resolveUser`
  ([src/core/config/index.ts:191-199](../../../src/core/config/index.ts)) reads
  `user.name` on purpose and does not go through `readOnlyEnv()`, so a scrub
  written as a shared helper must not reach it.
- Rewrite `docs/reference/02-git.md:5-8` and the comment at
  [run.ts:10-14](../../../src/core/git/run.ts) to state what is actually true
  after the change, rather than the guarantee they state now.
- Weigh the overlap before choosing: a `GIT_CONFIG_COUNT=0` model picked for
  DA-61 would close the configuration half of this incidentally, and nothing in
  DA-61 touches `GIT_DIR`.

## Out of scope

- Configuration a *reviewed repository* carries in its own `.git/config`, which
  is DA-61-git-config-of-a-reviewed-repository-executes.md and is a security
  finding rather than an isolation one. This entry is about the environment the
  tool inherits from its parent.
- `resolveUser` reading global git configuration. That is deliberate
  ([ADR-002](../../adr/adr-002-stack-and-delivery.md)) and stays.
- Hardening the header parser against `diff.noprefix`: with the environment fixed
  it cannot see that shape from this module.

## Verification

- A test in `tests/git.test.ts` reads a scratch repository with
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.noprefix GIT_CONFIG_VALUE_0=true`, and
  again with `GIT_DIR` pointed at a second repository, both set on `process.env`
  for the duration, and asserts the change set is that of the repository whose path
  was passed, with its paths intact. Today these variables are set only where a
  test *builds* a fixture ([tests/git.test.ts:29-30](../../../tests/git.test.ts),
  [tests/helpers/fixture-root.ts:25](../../../tests/helpers/fixture-root.ts)), never
  around the tool's own read.
- Removing the scrub turns that test red: the `GIT_DIR` case returns the other
  repository's files, and the `noprefix` case returns a file whose path is null.
- `docs/reference/02-git.md` no longer claims more isolation than the code
  provides, checked by reading it against the new `readOnlyEnv`.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  `bun run perf` — the last because every git read in the perf fixture goes
  through this function.

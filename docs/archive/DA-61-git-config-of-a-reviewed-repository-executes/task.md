# DA-61 · A reviewed repository's own .git/config executes commands on the reviewer's machine

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The product's premise is that a reviewer points diffalanche at a folder of
repositories somebody else produced. `AGENTS.md` states the boundary: the tool
never writes to a reviewed repository, and git is read through the `git` binary
only. Both halves fail together, because git reads configuration the repository
carries.

[src/core/git/run.ts:15](../../../src/core/git/run.ts) neutralises two of the
three configuration scopes:

```ts
function readOnlyEnv(): Record<string, string | undefined> {
  return { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull };
}
```

The third — `.git/config` inside the repository being read — is not neutralised,
and git treats it as trusted. Several of its keys name a program git then runs.
`--no-ext-diff` on [src/core/git/run.ts:89](../../../src/core/git/run.ts) closes
`diff.external` and nothing else.

Reproduced on this machine, git 2.39.5 (Apple Git-154), running the exact
command and environment the tool uses:

```
$ git config core.fsmonitor /tmp/probe/hook.sh
$ GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git diff HEAD --no-color --no-ext-diff -U3 > /dev/null
git diff exit=0
-rw-r--r--  1 … PWNED_BY_FSMONITOR
```

And the second vector, which needs only a tracked `.gitattributes` plus a key in
the same `.git/config`:

```
$ printf '* diff=pwn\n' > .gitattributes && git add .gitattributes && git commit -qm attrs
$ git config diff.pwn.textconv /tmp/probe/tc.sh
$ GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git diff HEAD --no-color --no-ext-diff -U3 > /dev/null
git diff exit=0
PWNED_BY_FSMONITOR
PWNED_BY_TEXTCONV
```

Both hooks ran with the user's own privileges and wrote files. `grep -rn
"fsmonitor\|textconv\|safe.directory" src/ docs/ scripts/` returns nothing —
neither key is considered anywhere in the repository.

There is no click in the path. [src/server/serve.ts:72](../../../src/server/serve.ts)
calls `review.document()` as a start-up warm-up, which reaches
[src/core/git/index.ts](../../../src/core/git/index.ts) `diff(cwd, …)`. Opening
a folder and running `diffalanche serve` is the whole exploit.

This is not only a security finding. It is the clearest possible breach of the
rule at the top of `AGENTS.md`: the command git runs writes wherever it likes,
inside the reviewed repository included.

## Work to do

- Decide the model and record it as an ADR: which configuration a reviewed
  repository is allowed to influence at all. The candidates are not equivalent —
  `GIT_CONFIG_COUNT=0` with the keys the tool needs passed as `-c`, versus an
  allow-list of keys read from the repository, versus `safe.directory`-style
  refusal to read a repository owned by another user. Only the first removes the
  class rather than the two known members of it.
- Close both proven vectors whatever the model: `core.fsmonitor` and
  `diff.*.textconv`, with `diff.external` already closed by `--no-ext-diff`.
- Enumerate the rest of the class before closing. `core.pager`, `core.editor`,
  `core.sshCommand`, `filter.*.clean` / `.smudge`, `uploadpack.packObjectsHook`,
  `core.hooksPath` and the `.git/hooks` directory itself are each a program named
  by data the reviewer did not write. Say in the ADR which of them the chosen
  model covers and which it does not.
- State in `docs/reference/02-git.md` what the git reader trusts and what it
  does not, so the next command added to the module inherits the answer.

## Out of scope

- Hardening against a malicious *patch*. This entry is about configuration git
  acts on, not about content rendered in the UI.
- The `.git` directory as a filesystem target of the watcher.

## Verification

- A repository carrying `core.fsmonitor` and one carrying `diff.*.textconv` +
  `.gitattributes`, both placed under a review root, leave no trace of their
  hook after a full `diffalanche serve` start-up and a rescan. The probe is the
  reproduction above, run against the tool rather than against bare git.
- A test in `tests/git.test.ts` builds such a repository and asserts the hook did
  not run. Breaking the fix on purpose turns it red.
- The ADR names every key of the class and says, for each, covered or not.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.

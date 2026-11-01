# DA-149 · Read-only Git configuration and ignore consistency

- **Order:** 850
- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Read-only Git environment and ignore configuration consistency; retain both distinct requirements.

## Work to do

- [DA-45.2 — readOnlyEnv does not set GIT_CONFIG_NOSYSTEM, and no minimum git version guards GIT_CONFIG_GLOBAL](../minor/DA-45.2-git-config-nosystem-and-min-version.md)
- [DA-58.2 — check-ignore reads the user's ignore file only at its default place, not a global core.excludesFile](../minor/DA-58.2-check-ignore-global-excludes-file.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-45.2

# DA-45.2 · readOnlyEnv does not set GIT_CONFIG_NOSYSTEM, and no minimum git version guards GIT_CONFIG_GLOBAL

- **Scope:** 02-git
- **Created:** 2026-09-29
- **Parent:** DA-45.1
- **Cost:** minor

## Evidence

Finding discovered while reviewing DA-45.1, a hypothesis from the reviewer, not checked:

- git older than 2.32 ignores `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` and reads `~/.gitconfig` and the system file; no minimum git version is documented or checked;
- Git for Windows may also read `%PROGRAMDATA%\Git\config`, which only `GIT_CONFIG_NOSYSTEM` turns off.

The `-c` pins of `INERT_CONFIG` still win over both files, so the keys that run a program stay closed; what could leak through is only the keys the reader does not pin.

## Work to do

- Say which git version the reader needs (02-git), and whether it checks it.
- Consider `GIT_CONFIG_NOSYSTEM=1` in `readOnlyEnv`; `scripts/check-git-null.ts` would show whether the Windows runner reads a `%PROGRAMDATA%` file.


### Retained original DA-58.2

# DA-58.2 · check-ignore reads the user's ignore file only at its default place, not a global core.excludesFile

- **Scope:** git reader, watcher ([02-git.md](../../reference/02-git.md), [05-watcher.md](../../reference/05-watcher.md))
- **Created:** 2026-09-28
- **Parent:** DA-58
- **Cost:** minor

## Evidence

Found while moving the JSDoc of `checkIgnore` in `src/core/git/run.ts` into
[02-git.md](../../reference/02-git.md), "Asking what git ignores". The moved
text says the rules include "the user's ignore file". `checkIgnore` runs git
with `readOnlyEnv()`, which points `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM`
at the null device ([02-git.md](../../reference/02-git.md), "What the reader
trusts"), so a `core.excludesFile` set in `~/.gitconfig` is never read. Git
still falls back to `$XDG_CONFIG_HOME/git/ignore` (default
`~/.config/git/ignore`) when `core.excludesFile` is unset, so "the user's ignore
file" holds only at its default place. The DA-58 review verified it with git
2.43.0 in a scratch repository, `HOME` a temporary directory, `x` in
`$HOME/.config/git/ignore` and `y` in a file named by `core.excludesFile` in
`$HOME/.gitconfig`: `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git
check-ignore --stdin` printed `x` only, and without the two variables `y`.

Cost: a path ignored only by a global `core.excludesFile` is not
suppressed, so a build writing there costs a rescan that finds nothing. The
watcher over-reports; it never misses a change. The fix is a sentence in
02-git.md, or a decision to pin `core.excludesFile` the way the other keys are.

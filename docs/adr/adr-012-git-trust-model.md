# ADR-012: The git reader trusts neither the repository's configuration nor the environment

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Velklish

## Context

The premise of the product is that a reviewer points diffalanche at a folder of
repositories somebody else produced, and `AGENTS.md` states the boundary: the
tool never writes to a reviewed repository, and git is read through the `git`
binary only. Both halves failed, in opposite directions.

**What the repository could do (DA-61).** `readOnlyEnv()` pointed
`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the null device and stopped
there. The third configuration scope — `.git/config` of the repository being
read — git treats as trusted, and several of its keys name a program git then
runs. Reproduced on git 2.54.0 (Apple Git-157) with the argv the reader used,
`git diff HEAD --no-color --no-ext-diff -U3`, in a repository carrying three
keys and a tracked `.gitattributes`:

| Key | What ran |
|---|---|
| `core.fsmonitor` | the named program, on every command that refreshes the index |
| `diff.pwn.textconv` | the named program, once per changed file |
| `filter.pwn.clean` | the named program, once per changed file |

All three wrote files with the reviewer's own privileges. There is no click in
the path: `src/server/serve.ts` warms the review up at start-up, so opening a
folder and running `diffalanche serve` was the whole exploit. `--no-ext-diff`
closed `diff.external` and nothing else.

**What the parent process could do (DA-87).** The same function spread
`process.env`, so every other `GIT_*` variable of whatever started diffalanche
was carried through. Two families survived the two null files, both reproduced
through the reader itself: `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
`GIT_CONFIG_VALUE_n` are a configuration source git applies regardless of the
files, and `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` override the `cwd` the
reader passes — no call in the module passed `-C` or `--git-dir`. With `GIT_DIR`
set, a read of one repository answered with another repository's files and
exited 0, so nothing warned. The trigger is uncommon — a git hook,
`git rebase --exec`, `git bisect run`, an agent shell — but the guarantee the
documentation stated was false either way.

## Options

- **How much of a repository's configuration to trust → an allow-list of keys
  read from it / refusal to read a repository owned by another user, in the
  shape of `safe.directory` / the tool names the configuration and the
  repository names none of it.** An allow-list and an ownership check each close
  the two members that were reproduced and leave the class open: a key nobody
  listed is still read, and a hostile folder the reviewer cloned themselves is
  owned by the reviewer. The third removes the class by construction, at the
  cost of a repository with a legitimate driver seeing its raw content.
- **How to close the keys whose name the repository chooses —
  `diff.<driver>.textconv`, `filter.<driver>.clean` — given that a literal `-c`
  needs the name → read the names from the repository and pin each / leave the
  family open and say so.** Reading them costs one `git config --list` process
  per repository read. It is placed beside the base resolution, which is already
  a group of parallel processes, so it costs the read no wall-clock time; the
  documented process count per repository goes from four to five.
- **What environment to hand the child → the parent's, minus a named list of
  dangerous variables / the parent's, minus every `GIT_*` / pin the repository
  per call with `-C` and keep the spread.** A named list is the same
  whack-a-mole as the allow-list above: `GIT_ASKPASS`, `GIT_SSH_COMMAND`,
  `GIT_EXTERNAL_DIFF` and `GIT_PAGER` are all in the family and none of them is
  among the six DA-87 proved. `-C` fixes the repository and leaves the
  configuration half untouched. Dropping the prefix removes both halves with one
  rule.

## Decision

**The reviewed repository configures nothing that git would execute, and the
environment diffalanche was started in configures nothing at all.**

1. `readOnlyEnv()` builds the child environment from `process.env` with **every
   `GIT_*` key dropped**, then puts back the two the reader sets itself:
   `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM`, both at the platform's null
   device. Nothing a parent exports reaches git, so `cwd` is the only thing that
   says which repository is being read.
2. Every git process the module starts carries `--no-pager` and a fixed list of
   `-c` pins, `INERT_CONFIG` in `src/core/git/run.ts`, one per configuration key
   the tool can name whose value git runs as a program.
3. The keys whose name the repository chooses are read from it —
   `git config --list --name-only -z`, filtered by family: `diff.<d>.textconv`
   and `.command`, `filter.<d>.clean`, `.smudge`, `.process` and `.required`,
   and `merge.<d>.driver` — and each is pinned to nothing on the `diff` that
   follows. `git diff` also
   carries `--no-ext-diff` and `--no-textconv`, which close two of them by flag
   whatever the enumeration saw.

4. **The reader fails closed.** The pins of point 3 are built from the
   repository's own answer, so a `config --list` that does not answer leaves
   nothing to read safely with: the repository comes back with `base: null`, no
   files, and the warning `repository configuration could not be read`, and no
   `diff` is started in it. Degrading to "no pins" would have made a git that
   cannot answer the cheapest way to switch the model off.

`-c` beats every configuration file, so a pin is not a request the repository
can argue with. The rule for the next command added to the module is the one
this ADR is for: a key not in the table below is trusted, and adding a command
means checking the table against what that command reads. The commands the
reader runs today are the table of `docs/reference/02-git.md`.

### The class, key by key

| Key | Reached by the reader's commands | Covered by |
|---|---|---|
| `core.fsmonitor` | yes — `diff`, `ls-files`, `check-ignore` | `-c core.fsmonitor=false` |
| `diff.external` | yes — `diff` | `--no-ext-diff`, and `-c diff.external=` |
| `diff.<driver>.textconv` | yes — `diff` | `--no-textconv`, and the enumerated pin |
| `diff.<driver>.command` | yes — `diff`, as the path's external diff driver | `--no-ext-diff`, and the enumerated pin |
| `filter.<driver>.clean` | yes — `diff` reads the working tree through it | the enumerated pin |
| `filter.<driver>.process` | yes — `diff`, and it is tried before `.clean`; this is git-lfs's path | the enumerated pin |
| `filter.<driver>.smudge` | no — only commands that write a working tree | the enumerated pin |
| `filter.<driver>.required` | it decides what an emptied filter costs: skipped, or fatal | the enumerated pin |
| `merge.<driver>.driver` | no — the reader never merges | the enumerated pin |
| `core.hooksPath`, `.git/hooks` | no — no command the reader runs fires a hook | `-c core.hooksPath=<null device>` |
| `core.pager`, `pager.<cmd>` | no — git pages only onto a terminal, and `execFile` gives a pipe | `--no-pager` |
| `core.editor`, `sequence.editor` | no — the reader opens no editor | `-c core.editor=false`, `-c sequence.editor=false` |
| `core.sshCommand`, `core.askPass`, `credential.helper` | no — the reader touches no remote over the network | the pins of the same names |
| `uploadpack.packObjectsHook` | no — the reader serves no fetch | `-c uploadpack.packObjectsHook=` |
| `core.alternateRefsCommand`, `core.gitProxy`, `gpg.program` | no — no alternate-ref walk, no proxy, no signature check | the pins of the same names |
| `alias.*` | no — an alias cannot shadow a built-in command, and the reader invokes only built-ins | nothing, and nothing is needed |
| `GIT_*` of the parent process | every command | the environment is built without them |
| `EDITOR`, `PAGER`, `VISUAL`, `SSH_ASKPASS` | no — the same rows as their configuration keys | not covered, not reachable |

## Consequences

- A repository with a legitimate filter driver — git-lfs is the common one —
  shows the content that is on disk rather than what the driver would make of
  it. For a review of a pointer file that is the more honest of the two, and it
  is the price of not running a program the reviewer did not write.
- Reading one repository is five git processes rather than four, and
  `docs/reference/02-git.md` says so. The fifth runs beside the base resolution
  rather than in front of the diff, so the wall-clock cost is nil and the
  performance gate's `update` line is unmoved.
- `filter.<driver>.required` is pinned along with the filter itself, and it has
  to be: git-lfs sets it, and under it an emptied filter is fatal rather than
  skipped — `fatal: .gitattributes: clean filter 'pwn' failed`, exit 128, which
  in an unbounded `Promise.all` takes the whole review with it. Measured on this
  machine before the pin was added.
- The flag and the pin are not redundant, and the order matters: with
  `--no-textconv` in place git never consults `diff.<driver>.textconv`, but
  without it the empty pin is a command git cannot run, and the read fails with
  `error: cannot run : No such file or directory` rather than quietly running
  the repository's program. A later change that drops the flag breaks loudly,
  which is the direction a security default should fail in.
- A future git with a new key that names a program is not covered until the
  table above gains a row. That is the residual risk this model accepts: the
  class is closed against the keys git has, not against the keys git will grow.
  The two families whose names the repository chooses are the ones that needed
  reading rather than listing, and a new family of that shape needs the filter
  in `repositoryDrivers` widened, not a new mechanism.
- Nothing here touches `resolveUser` in `src/core/config/index.ts`, which reads
  the developer's own `user.name` on purpose ([ADR-002](adr-002-stack-and-delivery.md))
  and does not go through this module.
- What is **not** covered is a malicious *patch* rendered in the UI, and the
  `.git` directory as a filesystem target of the watcher. Both are their own
  entries.

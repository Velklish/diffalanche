# DA-66 · The git layer has no error taxonomy: a spawn failure reads as "no commits yet", and one refused repository aborts the whole review

- **Order:** 100
- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`src/core/git` has exactly two ways of treating a failed git call, and picks between them by which
helper the caller happens to use rather than by what went wrong. One swallows everything into a
single fixed meaning; the other lets everything escape and take the review with it. Both ends are
wrong for the same reason, and one taxonomy closes both.

The swallowing end is [src/core/git/run.ts:34-40](../../../src/core/git/run.ts):

```ts
/** The same, for a command whose failure is an answer: an unresolved ref, a missing remote. */
export async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}
```

Every base resolution runs through it — `revParse` (:43-45), `currentBranch` (:49), `defaultRemote`
(:58), `remoteDefaultBranch` (:69) and `mergeBase` (:80) — and the `null` is then given one meaning
at [src/core/git/index.ts:45](../../../src/core/git/index.ts):
`warnings: [...warnings, "HEAD does not resolve: no commits yet"]`. A failure to *start* git is
indistinguishable from a repository with no commits. Reproduced by running the module's own
`execFile` shape with `PATH=/nonexistent` against a healthy repository:

```
$ node /tmp/da66probe.mjs
swallowed: ENOENT | spawn git ENOENT
revParse -> null
warning the tool would print: "HEAD does not resolve: no commits yet"
```

The consequence is an empty review that claims success. A repository with `base: null` comes back
with `files: []` (src/core/git/index.ts:101-108), and
[src/core/change-set.ts:193](../../../src/core/change-set.ts) drops every repository with no files
from the cache. The scanner needs no git at all — it finds repositories by stat-ing `.git`
(src/core/scanner/index.ts:93-99, a `stat` in a `try`) — so the repositories are found and then
silently emptied.
`diffalanche diff` writes that empty cache (src/cli/commands/diff.ts:99) and returns 0
(src/cli/commands/diff.ts:105, :111); an agent reading `--json` sees zero repositories and concludes
there is nothing to review, with one warning per repository blaming each repository for having no
commits. The realistic trigger is not only a missing binary: any spawn-level failure does it, and
`EAGAIN`/`ENOMEM` are reachable because the fan-out over repositories at src/core/change-set.ts:165
is unbounded — the same shape on the server's scan and candidate routes is filed as DA-98.

The escaping end is the same module's other helper. `diff()` and `untrackedFiles()` use `git()`,
which rejects on a non-zero exit, and nothing between them and the CLI catches it:
[src/core/change-set.ts:165-172](../../../src/core/change-set.ts) reads every selected repository
with a bare `Promise.all` and no per-repository handler, and the other call sites of
`readRepositoryChange` — src/server/review.ts:276, :297, :327 and src/core/watcher/index.ts:430 —
have none either. One repository therefore takes the review with it.

The trigger is narrower than it first looks, and the narrow version is the one to write down: base
resolution goes through `gitOrNull`, so dubious ownership, a repository with no commits and a
directory that vanished between the walk and the read all already degrade to a warning. What reaches
`diff()` is a repository whose refs resolve and whose object store then fails — a pruned or damaged
object directory, an unreadable one, or output above `MAX_GIT_OUTPUT` (256 MB,
src/core/git/run.ts:8). Reproduced by deleting the loose object of the committed blob:

```
$ git rev-parse --verify --quiet 'HEAD^{commit}'        # ae5a30e9…   exit 0
$ git diff $(git rev-parse HEAD) --no-color --no-ext-diff -U3
fatal: unable to read ce013625030ba8dba906f756967f9e9ca394464a
exit=128
```

In the CLI that surfaces as a raw stack trace and exit code 2
([src/cli/run.ts:102](../../../src/cli/run.ts)), because the generic handler treats it as an
unexpected crash; the healthy repositories' change sets are lost with it.

Everything around this degrades per item instead. An unresolved base is a warning
([docs/reference/02-git.md:51-52](../../reference/02-git.md)), an unreadable untracked file is a
warning (src/core/git/index.ts:165-169), and an unreadable directory is a scan warning naming the
path (src/core/scanner/index.ts:75). The git layer is the one place that does neither consistently.

## Work to do

- Distinguish, at the one point that runs the binary, a failure to spawn git from a non-zero exit of
  git, and give each a type the callers can branch on. Node reports the first as an error with
  `code` `ENOENT`/`EAGAIN`/`ENOMEM` and no `status`; the second carries git's exit code and stderr.
  The `maxBuffer` overflow is a third shape and belongs in the same taxonomy.
- Decide what a spawn failure does, and say so in the entry that implements it. The candidates are
  rethrowing it out of `gitOrNull` so it reaches the operator as itself, and turning it into a
  distinct per-repository warning that does not read as "no commits yet". Rethrowing is the smaller
  change and makes `diff` fail loudly on a machine without git; the warning keeps the review usable
  when one repository is the problem. This is the decision the task needs taken first, because the
  second half depends on it.
- Give `scanReview` a per-repository boundary so that a repository git refuses becomes a warning on
  that path and the other repositories still come back — the shape the scanner already uses for an
  unreadable directory. The same boundary is what the server's three call sites and the watcher's
  one need; decide whether it lives in `readRepositoryChange` or around each `Promise.all`.
- Make the resulting warnings name the cause. "HEAD does not resolve: no commits yet" must be
  reachable only when HEAD genuinely does not resolve, and a repository skipped because git refused
  it must say which git call failed and what git said.
- Update [docs/reference/02-git.md](../../reference/02-git.md) where it documents what a warning
  means, since the set of warnings this produces is part of the module's contract.

## Out of scope

- Bounding that fan-out. It makes `EAGAIN`/`ENOMEM` reachable, but it is a concurrency-limit change
  rather than an error-taxonomy one, and DA-98 already covers the routes with the same shape.
- The CLI's generic handler printing a stack and exiting 2 for anything that is not a known error
  class. Once the git layer degrades properly, fewer errors reach it; whether that handler should
  print a stack at all is DA-99 and DA-71.
- `serve` refusing to start on unreadable data (DA-64). It is the same family of "degrade rather than
  abort" but in the CLI and server, not in the git layer.

## Verification

- With `PATH` stripped of git, a scan no longer reports "no commits yet" for healthy repositories:
  either the failure surfaces as itself, or the warning names the spawn failure. The probe above is
  the test to automate, and it turns red the moment `gitOrNull` goes back to a bare catch.
- Over a root holding one healthy repository with a real change and one whose HEAD blob has been
  removed, `diffalanche diff` prints the healthy repository's patch, prints a warning naming the
  broken one, and exits with a documented code rather than a stack trace. The object-removal recipe
  above builds the fixture in four commands.
- The same two-repository root through the server's review build and through one watcher rescan,
  since those call sites are as uncaught as the CLI's today.
- `bun run lint`, `bun run typecheck`, `bun run test` and `bun run test:bun` pass.

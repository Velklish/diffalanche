# DA-103 · repositoryIgnore prunes only the repository's own .git, so a nested repository's git directory is watched

- **Order:** 580
- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`repositoryIgnore` prunes `node_modules` wherever it sits and `.git` only at the root of the watched repository. The two rules are one line apart:

[src/core/watcher/index.ts:681-691](../../../src/core/watcher/index.ts)

```ts
  return (path, kind) => {
    const segments = path.split("/");
    if (segments.includes("node_modules")) return true;
    if (segments[0] === ".git") {
      // The directory itself is walked into, for the two files at its top and
      // the exclude file one level down, and it is a signal in its own right
      // when that is all a runtime reports.
      if (segments.length === 1) return false;
      if (kind === "dir") return path !== ".git/info";
      return path !== ".git/HEAD" && path !== ".git/index" && path !== IGNORE_RULES_EXCLUDE;
    }
```

`insideGitDir` ([src/core/watcher/index.ts:661-663](../../../src/core/watcher/index.ts)) is anchored the same way — `path === ".git" || path.startsWith(".git/")` — so a path under a nested git directory is not exempt from the `check-ignore` question either. A nested clone is never a watched repository in its own right: the scanner stops at a directory holding `.git` and does not descend ([src/core/scanner/index.ts:50-67](../../../src/core/scanner/index.ts), [01-scanner.md:14-17](../../reference/01-scanner.md)), so everything inside it is covered only by the outer repository's watch.

What the scope of this is: the common nested repository is a modern submodule, and that one is already safe, because its git directory lives in the superproject's `.git/modules/…`, which the anchored branch prunes as a directory. Verified in a scratch repository on git 2.39.5:

```
$ git submodule add ../vendor/lib sub && cat sub/.git
gitdir: ../.git/modules/sub
```

The waste needs a plain nested clone, or an old-style submodule that still keeps a real `.git` directory in the working tree. For that case the cost is real, in both watch modes. Reproduced with an outer repository holding an untracked clone at `vendor/lib`:

```
$ git check-ignore -v vendor/lib/.git/HEAD vendor/lib/.git/index
$ echo $?
1
$ git status --porcelain
?? vendor/
$ git ls-files --others --exclude-standard -z | tr '\0' '\n'
vendor/lib/
```

Git applies no implicit rule to a nested `.git`, so `check-ignore` answers "none of them" and `burstIsIgnored` ([src/core/watcher/index.ts:196-215](../../../src/core/watcher/index.ts)) returns `false`. Every `git fetch` inside `vendor/lib` therefore costs a `check-ignore` process plus a full `rescanRepository`, which re-reads the outer change set through at least four git processes — `currentBranch`, base resolution, `diff`, `ls-files --others` ([src/core/git/index.ts:100-118](../../../src/core/git/index.ts)) — and rewrites `diff.json`, per debounce window. The outer change set cannot move: `ls-files` reports the whole nested tree as the single entry `vendor/lib/`, whatever is written inside its object store.

In the polling fallback the cost is continuous rather than event-driven. `ignore("vendor/lib/.git", "dir")` is `false`, so `snapshot` ([src/core/watcher/tree.ts:151-183](../../../src/core/watcher/tree.ts)) descends and stats every loose object, pack and ref of the nested repository on every tick of `DEFAULT_POLL_INTERVAL_MS = 250` ([src/core/watcher/tree.ts:44](../../../src/core/watcher/tree.ts)).

Configuration does not save a user from it: `config.exclude` defaults to `[]`, and its globs are matched against the last segment or the whole relative path (`index.ts:693-694`), so avoiding this needs one glob written per nested repository.

## Work to do

- Decide what a nested git directory is before pruning it, because the two nested cases are not the same. A plain untracked clone is pure noise. A nested repository the outer repository tracks as a gitlink is not: with the same scratch repository, committing inside `sub` moved the outer diff — `git status --porcelain` showed `AM sub` and `git diff --stat` one changed line — so a rule that ignores everything under a nested `.git` would suppress a change the reviewer is meant to see. The candidates are to prune the whole nested git directory and accept that a gitlink moves without waking the watch, to prune everything but a nested `HEAD` (the file that moves when a gitlink does), or to prune only the paths that are unambiguously internal — `objects/`, `logs/`, `refs/`, `modules/`. Name the choice in the entry before writing it.
- Whatever is chosen, apply it in both places: the ignore predicate and `insideGitDir`, which is what keeps the `check-ignore` process from being spawned for the burst at all. Leaving the second anchored means the process cost stays even once the paths are pruned.
- Keep the root `.git` behaviour exactly as it is — the directory itself reported, `HEAD`, `index` and `info/exclude` let through — since it is what makes a base change visible on a runtime that reports the directory rather than the file.
- Say in [05-watcher.md](../../reference/05-watcher.md) what the watch does with a repository inside a repository, next to where it already explains the `.git` rule; today a reader cannot tell that the pruning is anchored without reading `segments[0]`.

## Out of scope

- Making a nested repository reviewable on its own. The scanner not descending into a found repository is `docs/SPEC.md` section 3, decision 3, and is not reopened here.
- `git ls-files --others --exclude-standard -z` reporting a nested clone as the directory entry `vendor/lib/` with a trailing slash, which `untrackedFiles` ([src/core/git/run.ts:96-100](../../../src/core/git/run.ts)) passes on with only empty strings filtered out. Whether `readUntracked` then produces a file, a warning, or something worse was not traced — that is a hypothesis and belongs in its own entry if someone confirms it.
- The debounce window, the burst cap, and the verdict cache, which are the right shape and are simply being fed work that should never have reached them.
- `node_modules` and the `exclude` globs, which behave as documented.

## Verification

- A watcher test with a nested `.git` directory inside a reviewed repository: writing a file under `vendor/lib/.git/objects/…` produces no rescan of the outer repository, and — under the same test — a write to the outer repository's own `.git/HEAD` still produces one. Reverting the anchoring fix turns the first assertion red; without the second, a change that prunes too much would pass.
- A test for whichever gitlink decision was taken, asserting the behaviour that was chosen rather than the one that happens to fall out of the implementation.
- Polling mode covered too, since it is the mode where the cost is continuous: `snapshot` over a tree with a nested git directory does not contain any path under it.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, and `bun run perf` — the watcher's budgets are in `docs/SPEC.md` section 6 and this change is on the path they measure.

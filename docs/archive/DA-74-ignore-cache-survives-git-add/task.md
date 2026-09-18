# DA-74 · The ignore-verdict cache is not invalidated when the burst names the bare .git, so a git add -f leaves later edits suppressed

- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The watcher keeps git's ignore answers per repository between bursts, and drops
them when a burst names a path that changes what git ignores. Both halves are in
[src/core/watcher/index.ts](../../../src/core/watcher/index.ts):

```ts
// src/core/watcher/index.ts:196-202
const cache = ignoredPaths.get(repository.path) ?? new Map<string, boolean>();
ignoredPaths.set(repository.path, cache);
if (paths.some(changesWhatGitIgnores)) {
  cache.clear();
  return false;
}
if (paths.some(insideGitDir)) return false;
```

```ts
// src/core/watcher/index.ts:655-663
function changesWhatGitIgnores(path: string): boolean {
  if (path === IGNORE_RULES_EXCLUDE || path === ".git/index") return true;
  return path === ".gitignore" || path.endsWith("/.gitignore");
}

/** Whether the path is git's own directory, or anything the watch reports inside it. */
function insideGitDir(path: string): boolean {
  return path === ".git" || path.startsWith(".git/");
}
```

`changesWhatGitIgnores` matches four literal shapes, and the bare `.git` is none
of them. A burst whose only name is `.git` therefore falls through to line 202,
returns `false`, and the repository's verdicts survive untouched — the rescan
runs, the cache does not move.

That the bare `.git` is a name the watch really delivers is this module's own
statement, not an inference. `repositoryIgnore` lets it through deliberately
(index.ts:684-688: `if (segments.length === 1) return false`, under a comment
saying the directory "is a signal in its own right when that is all a runtime
reports"), the doc-comment at index.ts:666-670 says "a runtime that reports the
directory rather than the file inside it (Bun does) would otherwise never say
that HEAD moved", and the test refuses to assert the name for that reason —
[tests/watcher.test.ts:519-525](../../../tests/watcher.test.ts) asserts only
`path === ".git" || path.startsWith(".git/")`, with the comment "Bun hands back
the bare `.git` where Node names the file".

The rule this defeats is the one the code documents at index.ts:648-654: `.git/index`
is in `changesWhatGitIgnores` because "a tracked file is never reported as
ignored — without it, one `git add -f` on a build output would leave every later
edit of a now-tracked file suppressed by a cached verdict". On a runtime that
collapses the name to `.git`, that protection is not there. A build writes
`dist/out.js`, the burst is asked and `cache.set("dist/out.js", true)` is stored
(index.ts:209); `git add -f dist/out.js` moves the index, the burst arrives as
`.git` alone, and the verdict stays. Every later edit of that file — now tracked,
now in the diff — arrives as `["dist/out.js"]`, `paths.every((path) => cache.get(path) === true)`
is true at index.ts:213, and the watcher returns without a rescan, with no event
and no warning. The stale `true` is only evicted once 4096 other paths of that
repository push it out (`trimVerdicts`, index.ts:637-642, `IGNORE_CACHE_LIMIT = 4_096`
at index.ts:68), or once some burst happens to name `.git/index` in full.
Nothing else clears it: `ignoredPaths` is written only at index.ts:197 and
cleared only at index.ts:199, and index.ts:203 filters cached paths out of the
re-ask, so a stale verdict is never re-asked.

The demonstrated hole is the one above: an index move reported as the bare
`.git`. That a `.gitignore` edit reported as its containing directory has the
same effect is a hypothesis — it has not been reproduced, and a rules file at
the repository root would be reported as the root itself, which is a different
case from the `.git` collapse.

[docs/reference/05-watcher.md](../../reference/05-watcher.md) carries the same
gap in prose: the paragraph on the kept answers names the same three paths as
the ones that drop what was kept, and the row above it says `.git` itself is
reported as a signal, without connecting the two.

## Work to do

- Decide where the invalidation belongs, and say why in the change. The
  candidates: treat the bare `.git` as rules-changing in `changesWhatGitIgnores`;
  or clear the cache in the `insideGitDir` branch as well, keeping the two
  predicates as they are; or stop keying invalidation on path names and drop the
  repository's verdicts whenever a rescan of it actually runs. They differ in
  what a plain HEAD move costs: the first two make every commit and every branch
  switch discard the repository's verdicts, so the build writing into `dist/`
  pays one `git check-ignore` again afterwards; the third makes the cache serve
  only bursts that were suppressed, which is close to discarding it.
- Whichever is chosen, make the fix independent of which runtime the tests run
  on. A burst of `[".git"]` has to be exercisable directly, which means lifting
  the decision out of the `burstIsIgnored` closure (index.ts:194) into a module
  function that can be exported, the way `trimVerdicts` and `repositoryIgnore`
  already are and are tested at tests/watcher.test.ts:697 and :726.
- Update the paragraph in [docs/reference/05-watcher.md](../../reference/05-watcher.md)
  that lists the three paths dropping the kept answers, so the rule it states is
  the rule the code has.
- Either reproduce the `.gitignore`-reported-as-its-directory case and cover it
  by the same change, or record in the entry that it was looked for and not
  reproduced. Do not close it on the strength of the `.git` case alone.

## Out of scope

- What reaches the burst at all. `repositoryIgnore` (index.ts:676-696) is
  correct as it stands and lets the bare `.git` through on purpose; this task is
  about what `burstIsIgnored` does with the name, not about the filter.
- The 4096-path cap and `trimVerdicts`. The eviction is the thing that
  eventually repairs the stale verdict, not the thing that causes it.
- The flakiness of the watcher suite, which is DA-60. A new test written here
  should not depend on real filesystem timing, and if it must, DA-60 is where
  that is argued.

## Verification

- A test that stores a verdict for a path, delivers a burst whose only name is
  `.git`, and then delivers the path again, observes a rescan. Reverting the
  fix turns it red — that is the check, and it must fail on both runtimes rather
  than only on the one whose watch collapses the name.
- `docs/reference/05-watcher.md` names the same set of invalidating paths as the
  code does, and a reader of either arrives at the same rule.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  and `bun run perf`, since a wider invalidation adds `git check-ignore`
  processes to bursts that used to be answered from the cache.

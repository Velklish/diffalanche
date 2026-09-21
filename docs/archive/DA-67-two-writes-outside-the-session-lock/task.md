# DA-67 · Two writes skip the session lock: the scope check in addComment, and diff.json in the diff command

- **Order:** 80
- **Scope:** 03-storage, 04-domain, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The storage module states the rule these two break, in the doc comment of the one write path
([docs/reference/03-storage.md:155-156](../../reference/03-storage.md)): "Reading outside the lock
and writing inside it is what loses a reply written in between, so the read is inside too." Two call
sites do the opposite, in two different ways.

**The scope check of `addComment`.** [src/core/domain/comments.ts:167](../../../src/core/domain/comments.ts)
reads `review.json` for the scope and decides on it:

```ts
  assertAnchorInScope(await readReview(dataDir, session), repo, path);
```

The write happens later, at comments.ts:174 — `updateComments` → `updateSession` → `withLock`
(src/core/storage/index.ts:250-265) — and between the check and the lock sit `captureAnchor` and
`changeSet`, which reads the whole of `diff.json` (comments.ts:141), the largest file in the session
directory. The other writer of the scope takes the opposite care for exactly this reason:
[src/core/domain/scope.ts:304-310](../../../src/core/domain/scope.ts) does its read of the comments
*inside* `updateSession`, with the comment "Read rather than taken from the draft".

So a scope narrowed while a comment is being written lands between the check and the write: `setScope`
takes the lock, sees no comment to drop because the comment is not written yet, narrows the scope and
releases; `addComment` then takes the lock and appends a comment on a path the scope no longer has.
Nothing revalidates on the way in — `updateSession` re-checks only that the session exists
(src/core/storage/index.ts:269-275). What comes out is a comment that `list` filters away
(comments.ts:306) and that `get`, `reply`, `resolve` and `reopen` answer `no-such-comment` for
(comments.ts:206), while the CLI has already printed `${written.id} opened on …`
([src/cli/commands/comment.ts:81](../../../src/cli/commands/comment.ts)) and exited 0.

Two corrections to how that is easy to overstate. The comment is not lost: it stays in
`comments.json` and becomes visible again if the scope is widened to include its path — the damage
is an invisible comment while the narrowed scope stands, plus a success line that was not true. And
the placement is not forced: the scope is available inside the lock as `draft.review`
(src/core/storage/index.ts:280), which is what makes the fix small. The reference currently asserts
the stronger claim — [docs/reference/04-domain.md:160-161](../../reference/04-domain.md): "Nothing writes
such a comment; a `comments.json` edited by hand is where it comes from" — and that sentence is
false until this closes.

**`diff.json` in the diff command.** [src/cli/commands/diff.ts:99](../../../src/cli/commands/diff.ts)
is a bare write:

```ts
    await writeDiffCache(config.dataDir, session, scanned.cache);
```

It is the only one of six. The other five take the lock and call `assertHeld` first:
src/core/change-set.ts:243 and :255, src/core/watcher/index.ts:478 and :488, and
src/server/review.ts:243. Three places say why it must:
[src/core/watcher/index.ts:405-407](../../../src/core/watcher/index.ts) ("under the session's lock:
the CLI writes the same directory, and a rescan that read outside the lock would overwrite what it
wrote"), src/core/change-set.ts:211-214, and
[docs/reference/05-watcher.md:167](../../reference/05-watcher.md) ("The write goes through the lock
all the same, because the CLI writes the same directory").

The interleaving that loses work is the reverse of the obvious one, which is why `assertHeld` cannot
catch it: the CLI never contends for the lock at all. With `serve` running, the watcher takes the
lock and reads the cache (src/core/watcher/index.ts:434); `diffalanche diff` finishes a full scan and
writes a fresh cache covering every repository; the watcher then writes `{...cached, repositories:
cached minus this repo plus the new one}` (src/core/watcher/index.ts:454-478) and passes `assertHeld`
honestly, because it does hold the lock. Everything the CLI's scan added for the other repositories
is gone. `diff.json` is a cache rather than user data, so what is lost is freshness, not content —
but the cache then answers for the same `base` and `scope`, so `build()`
([src/server/review.ts:212-215](../../../src/server/review.ts)) serves it unchanged and no rescan
happens until an fs event fires for those repositories. That is precisely the case `diff` is run by
hand for. A comment written next reads the same stale cache through `changeSet` and either refuses
with `line-not-in-diff` or anchors to a pre-edit hunk.

Neither case is covered: `tests/storage-concurrency.test.ts` is the twenty-writers gate on
`comments.json` replies, `tests/storage-lock-race.test.ts` is about the lease, and neither mentions
the scope or the diff cache.

## Work to do

- Move the scope check of `addComment` inside the lock. The shape `setScope` already uses is the
  model: do the check in the `updateSession` body against `draft.review`, which is read under the
  lock. Decide whether `updateComments` stays the entry point — it deliberately exposes only the
  comments — or whether `addComment` moves to `updateSession` for access to the review; that is the
  one design choice in this half.
- Decide what the anchor capture does about the widened window. Capturing the anchor inside the lock
  keeps `readDiffCache` under it, which lengthens the critical section by the largest file in the
  directory; capturing outside and only re-checking the scope inside keeps the lock short. Name the
  choice in the task result, because it decides how long every comment write holds the session.
- Wrap src/cli/commands/diff.ts:99 in `withLock` + `assertHeld` like the other five sites. The
  repetition across six call sites is itself worth a look while in there, but see below.
- Re-check the two sentences that are currently untrue once the code is: docs/reference/04-domain.md:160-161
  and, if the wording needs it, the lock section of docs/reference/03-storage.md.

## Out of scope

- The duplicated one-repository patch logic shared by the watcher and `refreshRepository`, filed as
  DA-80. It is the natural place to put a single locked `writeDiffCache` helper, and it is a
  different task.
- The lock's own mechanics: release is not atomic (DA-78) and a stale lock can outlive the wait
  (DA-89). This entry assumes the lock works as documented and is about two writers that do not use
  it.
- A comment refused on a bad anchor having already rescanned git and rewritten `diff.json` (DA-88):
  the same file, but about work done before a refusal rather than about the lock.
- Making a scope change reject or rewrite comments that are already out of scope. `setScope` has its
  own contract (`ScopeCommentsError`, `dropComments`), and this task must not quietly change it.

## Verification

- A test that writes a comment while a scope narrowing runs between the check and the write — the
  window is wide enough to hit deterministically by making `changeSet` slow, or by driving the two
  operations from two processes the way `tests/storage-concurrency.test.ts` does — ends either with
  the comment refused or with the comment inside the scope, never with a comment `list` cannot see.
  Reverting the check to its current place turns that test red.
- A test in which the watcher's locked read predates a `diff` write asserts that no repository
  disappears from `diff.json`. Removing the `withLock` from diff.ts:99 turns it red.
- `bun run lint`, `bun run typecheck`, `bun run test` and `bun run test:bun` pass; `bun run perf` is
  worth a run if the anchor capture moves inside the lock, since that changes what a comment write
  costs under a concurrent watcher.

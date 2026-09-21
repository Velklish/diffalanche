# DA-55.1 · Live update follows only the current session, so a window on a named task never hears about its comments

- **Order:** 260
- **Scope:** 05-watcher, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** none
- **Cost:** major

## Context

Found while implementing DA-55, and deliberately left alone there: it is a different subsystem and a different kind of defect from the one that task had to fix.

The watcher keeps one session's comments and metadata, and that session is `current`. `reloadComments` ([src/core/watcher/index.ts:289](../../../src/core/watcher/index.ts)) opens with `if (session === null) return;` and reads `readComments(config.dataDir, session)`; `reloadMetadata` (line 322) does the same; `session` is whatever `readCurrent` last returned (line 255).

Until DA-55 every window was on `current`, so this was invisible. DA-55 gives a window `?review=<name>`, and decision 7 of [ADR-010](../../adr/adr-010-review-task-scope.md) says several agents work on several tasks at once and nothing but `review use` moves `current`. From then on a window is routinely on a task that is not `current`, and for that window `comment-added`, `reply-added` and `comment-status` never arrive: an agent answers in a thread of task X, and the person reading X sees it only after a reload.

Two neighbouring events are **not** affected, which is what keeps this a limitation rather than a break: `diff-changed` is about a repository rather than a session, and `sessions-changed` already walks every session (lines 272–287).

This is not the same class as the defect DA-55 did have to fix. That one wrote a person's comment into another task's file — data going to the wrong place. This one costs a page reload. The distinction is why it is a task of its own rather than more scope for DA-55, which had already taken on seven routes beyond its card.

## Work to do

- Let the watcher follow more than one session: the sessions windows are actually open on, rather than `current` alone. The server knows which those are — every request now carries `?review=<name>` — so the set is discoverable rather than guessable.
- Keep the cost in mind that DA-53 already noted: the watcher reads every session's `review.json` on each burst in the data directory, and a data directory with hundreds of sessions feels it. Whatever follows several sessions should not turn that into reading every session's `comments.json` too.
- The baseline rule that exists for a session switch — "the comments of the session being switched to are not news: they are read as the new baseline" (line 256) — has to hold for each session that joins the watched set, or a window will get a burst of its whole history as new comments the moment someone opens it.

## Out of scope

- `diff-changed` and `sessions-changed`, which already work across sessions.
- The scope editor and the URL routing themselves (DA-55).

## Verification

- Two windows, one on `current` and one on `?review=<other>`: a comment written by the CLI into the second task reaches its window inside the live-update budget, and the first window does not show it.
- A window opened on a task with existing comments does not announce them as new.
- `bun run perf` stays green with several sessions watched, including the update budget it already measures.

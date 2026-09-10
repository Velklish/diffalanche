# ADR-010: A review session carries a scope and a status

**Status:** Accepted
**Date:** 2026-09-10
**Deciders:** Velklish

## Context

A review session covers everything under the root: every repository that has
changes, every changed file in it (`docs/SPEC.md` sections 4 and 5). That is the
right answer for "show me the working area" and the wrong one for the loop the
tool exists for. An agent that has just edited three files in two repositories
has no way to say "look at these", and the reviewer opening the tool gets the
whole working area instead of the change that was made.

The cost is not only on the screen. `scanReview` reads every repository the walk
finds, which is four git processes each; on the synthetic review of twenty-one
repositories a task about two of them pays for the other nineteen on every scan
and every rescan.

The owner asked for a review that carries a **scope** — the repositories and the
files it is about — and for such a review to live in the history as a task one
can come back to while it is not closed. The seven decisions below were settled
with the owner in an interview on 2026-09-10; this ADR records them and what
follows from them in the format, the core, the CLI, and the HTTP API.

## Options

- **The shape of a scope → one list of entries of two kinds / two lists, one of
  repositories and one of files.** Two lists make "this repository, and one file
  of that one" two concepts that have to agree; one list of entries, each a
  repository with an optional list of paths, says the same thing once.
- **What happens to changes outside the scope → nothing is shown / a summary
  line naming what was left out.** A summary line is a carve-out from product
  principle 5 either way: either the change is left out silently or it is
  half-shown. The owner chose "nothing", on the ground that a change outside the
  scope belongs to another task and the history says which tasks exist.
- **What closes a task → a human / a counter over its comments.** A counter
  makes "closed" a derived value that flickers as comments are written, and it
  gives an agent a way to close what a human has not verified.
- **Where the scope is applied → in the walk / after it.** The walk finds
  repositories by reading directories and starts no git process, and it is what
  tells "a repository the scope names but the root has not" from "a repository
  that is simply quiet". So the walk stays whole and the scope decides which of
  the found repositories are read.
- **What a comment outside the scope does → refused / stored.** Stored, it is
  written where `list`, `show`, `export`, and the UI will not return it: a
  finding lost silently, which is what principle 5 forbids.

## Decision

1. **A scope is one list, entries of two kinds.** An entry is a whole
   repository, or a repository with an explicit list of paths. `scope: null` is
   the whole root, which is what every session written before this decision
   means; an empty list is refused, because a task that shows nothing is a
   mistake and not a state.
2. **Nothing outside the scope is shown or returned.** No summary line, no
   collapsed section, no count of what was left out. `diff`, `list`, `show`,
   `export`, and the review document all answer inside the scope. This is a
   deliberate carve-out from product principle 5 and is written into
   `PRODUCT.md`. It covers what a task **shows**, not what it may **write**: a
   comment on something outside the scope is refused by name, because a stored
   comment nothing can read back is the loss principle 5 is about. **The two
   sides use one rule** — the names of the scope, matched as they are written —
   so what a task shows is what it takes a comment on. A file renamed since the
   scope was written is at a name the scope has not: the task shows nothing for
   it and refuses a comment on it, while the path it does name goes on being the
   task's own, with nothing to show (decision 5). A scope that followed renames
   would be a further decision, and one nobody has taken; `review scope add` is
   how a task takes the new name.
3. **A task is closed by a human**, never by counting comments, and never by an
   agent: the rule of [ADR-004](adr-004-agent-contract.md) reaches from a thread
   to the task the threads are in, and it is the same check —
   `resolve`, `reopen`, `review close`, and `review reopen` all refuse any role
   but `human` and change nothing. Status is `open` or `closed`; a closed task
   is reopened by the same gesture. Closing is a marker and not a lock:
   `comment`, `reply`, and `resolve` all still work on a closed task.
4. **Creating a task does not move `current`.** `review new --no-use` writes the
   task and prints its address; the human opens it when they are ready. The UI
   creates every session that way, and switching a task in it moves that
   window's address rather than the pointer. **One exception, taken with the
   owner in DA-55:** the first session of a root, created from the first-run
   screen, becomes current. What decision 4 protects is a screen a human is on
   from an agent that takes it away; on that screen there is no `current` at all
   and the human is doing it to themselves, and leaving the pointer unset would
   hand them a root whose only session the CLI cannot name without `--review`.
5. **A file that is in the scope but has no changes any more is not shown.** The
   scope keeps it; the screen does not — the rule the review already uses for
   repositories.
6. **Removing an entry from the scope deletes the comments anchored under it**,
   and the caller is told how many before it happens. The count and the deletion
   are one write under one lock; without consent — `--drop-comments` in the CLI,
   `dropComments` in the API — the call is refused and nothing is written.
7. **There is no main task.** Several agents work on several tasks at the same
   time; each names its task with `--review`. `current` stays as the default for
   a human typing a command by hand, and only `review use` moves it.

## Consequences

- `SCHEMA_VERSION` goes to 2. `review.json` and `comments.json` of version 1 are
  read — a version 1 review is `scope: null`, `status: "open"` — and written
  back as version 2 by the next write. `diff.json` of a version this build does
  not know is discarded and scanned again, because it is a cache and not
  something a person wrote.
- **The change-set cache is keyed by the scope as well as by the base.**
  `diff.json` records both, and a cache computed for another scope is read again
  rather than trusted: without that, a scope edit would leave the review reading
  the answer to the question it used to ask.
- A task over two repositories of twenty-one starts git in two of them.
  `tests/scope-scan.test.ts` asserts it by counting the git processes a scan
  starts, not by wall-clock time.
- The watcher watches every repository under the root and rescans only the ones
  in the scope. Watching what is out of scope costs no git process and is what
  makes a scope that widens while the server runs take effect without a restart.
- The live stream gains `sessions-changed`: a task appeared, or a task's status
  changed. It is not `session-changed`, which is the *current* session or its
  metadata — an open window has to hear about a task it is not on.
- Two answers still cover the whole root on purpose: `GET /api/scan`, the screen
  before there is a session, and `GET /api/sessions/candidates`, what the scope
  editor picks from. Both are lists of repositories and files rather than a
  review, so neither shows the diff of what a task is not about.
- Deleting a session (DA-40) and re-anchoring comments (DA-42) are unchanged by
  this decision and stay where they are.

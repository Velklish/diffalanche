# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is one developer or tech lead reviewing work that coding agents
produced across several independent git repositories at once. They run the tool
on their own machine, in the folder that holds those repositories, and read the
whole change set as a single merge-request-style review: read a diff, mark what
is wrong, close what they verified. There is one of them; the tool serves
`127.0.0.1` and has no accounts.

The second audience is the coding agents themselves. They do not open the UI.
They read the review through the CLI, fix the code, and answer inside the
comment threads; the CLI is the only contract they get.

## Product Purpose

diffalanche turns a folder of many independent repositories into one review. It
computes each repository's change set against a chosen base, shows them
together, stores every comment on disk as plain JSON, and hands coding agents a
CLI to read those comments, reply to them, and open their own.

Success is that a reviewer stops opening one diff tool per repository and stops
copying findings into a chat window: the finding lands where the agent will read
it, and the agent's answer comes back in the same thread.

## Positioning

Neighbouring tools each solve one part. difit reviews one repository and hands
off by clipboard; diffx keeps comments in a running server's memory; difftray
spans many repositories but hands off by clipboard prompt. None of them combines
many repositories in one review, comments that live on disk as plain JSON, and a
CLI that is a real contract for agents. That combination is the product.

## Operating Context

The reviewer works in a terminal and a browser side by side, on one machine,
offline. They start diffalanche in the root folder; it finds every git working
tree under it, resolves a base per repository — the working tree against `HEAD`,
the merge base with a branch, or an explicit ref — and serves the review on
`127.0.0.1`.

A review session is a named unit of work with its own base mode and comments.
Sessions accumulate and are never deleted automatically. Comments live in
`<root>/.diffalanche/reviews/<name>/` as JSON a human can read and edit. A
finding carries a severity (`critical`, `warning`, `nit`, `question`) and a
status (`open`, `resolved`; Phase 3 adds `orphaned`); only a human sets
`resolved`.

While the review is open, agents edit code in those same repositories. The diff
and the threads update live, without losing the reading position.

## Capabilities and Constraints

- Many repositories in one review; three base modes; untracked files included;
  comments anchored to a review, a repository, a file, a line, or a line range.
- Threads with agent replies, an activity feed of what changed while the review
  is open, review sessions with history, global search, markdown export, a
  keyboard map.
- **The tool never writes to a reviewed repository.** No commits, index changes,
  resets, or file edits; git is read through the `git` binary only. The only
  writable location is the data directory.
- Storage is JSON files, not a database. One person, `127.0.0.1`, no
  authentication, no cloud.
- No custom diff parser, renderer, or syntax highlighter: the diff comes from a
  library.
- No model training or fine-tuning on the user's data. Suggestions come from
  retrieving the reviewer's own past comments.
- Server, core, and CLI code use only APIs shared by Node and Bun. Two delivery
  channels: npm (Node >= 22) and prebuilt binaries.
- Performance budgets are a gate, not an aspiration: first render 500 ms,
  scrolling at 120 fps with no long tasks, opening the form and jumping to a
  file 50 ms, switching a session 100 ms, updating after an edit 300 ms —
  measured on the synthetic review of 21 repositories, 300 files, 30 000 diff
  lines, and 200 comments.
- The tool works offline. Fonts and the embedding model ship with it, and the
  page asks no external host for anything.

## Brand Commitments

- The name is `diffalanche`, lower case, always one word.
- The mark is three 9x9 squares (2.5 px radius) stepped along a diagonal in the
  accent, warning, and nit colours, built in markup. No raster asset and no icon
  font; icons are text symbols (`▾ ▸ ⌕ ☾ ☀ ✓ ↑ ↓ ↵ ⏎ ⌘ ⇧ ◆`).
- Two themes, dark by default, light on the header's toggle. The choice is
  remembered and applied before the first paint.
- Instrument Sans for the interface, JetBrains Mono for code, identifiers,
  numbers, and labels — bundled locally so the tool stays offline.
- The interface carries both English and Russian strings; the monospace family
  ships cyrillic subsets for that reason.

## Evidence on Hand

- `docs/SPEC.md` — the approved requirements: base modes, on-disk format, CLI,
  agent protocol, performance budgets.
- `docs/design/HANDOFF.md` — the approved high-fidelity UI design: exact tokens
  for both themes, eleven screens, interactions, keyboard map.
  `docs/design/prototype.dc.html` is its working prototype and the reference for
  behaviour; `variants.dc.html` records why this direction was chosen.
- `src/ui/tokens.css` — the tokens as implemented; the normative source of every
  colour value, and what `DESIGN.md` is checked against.
- `docs/GLOSSARY.md` — the normative vocabulary. Project texts use only names
  from it.
- There are no customers, testimonials, benchmarks, press, or pricing. The
  project is pre-1.0 and in development; nothing may be written that implies
  otherwise.

## Product Principles

1. **The reviewed repository is read-only.** Everything the tool produces lands
   in the data directory. A design that implies the tool edits code is wrong.
2. **The disk is the contract.** Comments are plain JSON a human can read and
   edit, and the CLI is what agents get. The UI and the HTTP API are
   conveniences on top, not the source of truth.
3. **One review, many repositories.** The repository is a grouping inside one
   change set, never a separate session the reviewer has to switch between.
4. **The human closes, the agent answers.** Agents open comments and reply; only
   a human marks a finding resolved, and the interface never blurs which of the
   two wrote a message.
5. **Nothing is silently lost.** A repository the scan skipped, a base that did
   not resolve, a comment whose anchor is gone — each one is shown and named,
   never dropped.

## Accessibility & Inclusion

No formal standard was established for the project. Two needs are specific to it
and hold for every screen: the review loop of the handoff's keyboard map is
usable from the keyboard alone, and both themes keep code legible, because
reading diffs is the whole task.

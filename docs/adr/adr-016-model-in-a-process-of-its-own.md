# ADR-016: The embedding model runs in a process of its own

**Status:** Accepted
**Date:** 2026-09-24
**Deciders:** the owner chose the direction on 2026-09-24 — the model in a process of its own — from the candidates DA-34.2 lists; the `ml3` worker of the run of 2026-09-23 designed it within that, by the task brief, and the orchestrator accepted the design under that direction on 2026-09-24

## Context

[ADR-014](adr-014-embedding-model-and-npm-delivery.md) caps "a process that loads
the model and embeds 200 comments" at 768 MiB peak resident size. Until DA-34.2
the model loaded in the process that asked for a vector: a command, or the
server on a worker thread (DA-34.1). DA-34.2 measured both crossing the ceiling
on Bun, the binary channel: a query over 50 000 comments at 803 MiB, and `serve`
after its first suggestion on the synthetic review of 240 comments at 742 and 764
MiB. Two weights sit in one process there. The model's is 697–714 MiB alone on
the day of those measurements; the index's is about 1.5 KB of vectors a comment
plus its entry, and the server's own is the review it holds.

A second constraint comes from DA-34.1: a run of the model holds the thread that
runs it, and with the index rebuilt on the server's own thread the update after
an edit took 422–435 ms against 272–297 ms without it. Whatever holds the model,
it is not the server's event loop.

The candidates listed when the owner decided were the model in a process of its
own and unloading the model when it is idle; for the index's own share, mapping
the vectors file instead of reading it, or keeping the vectors in `float16`. A
lighter model would be another model, which is ADR-014's to decide. The owner
chose the first. The rest of this record is how.

## Options

**Decision 1 — what the child holds.**

- **1A. The model alone; the index, its update and its search stay in the parent.**
  The child is then exactly ADR-014's process — it loads the model and embeds —
  and its peak does not move with the index; the parent holds the vectors and
  never the model.
- **1B. The model and the index, the parent only asking.** One process would
  again hold both weights, and a query over 50 000 comments would cross the
  ceiling in the child as it did in the command.

**Decision 2 — how the two speak.**

- **2A. A line of JSON each way on the child's standard input and output.**
  Pipes are what Node and Bun share without condition, and `JSON.stringify`
  escapes every newline in a string, so a line is one message. A vector travels
  as the base64 of its `float32` bytes, so the parent gets the bytes the model
  made.
- **2B. The `ipc` channel of `node:child_process`.** Framing for free, but its
  serialization differs between the runtimes and between a Bun parent and a Bun
  child, which the binary is; nothing measured here needs it.
- **2C. An extra pipe past the three standard ones.** Keeps stray output off the
  channel, but depends on each runtime's support for a fourth descriptor in the
  child; 2A reads a stray line as a fault instead.

**Decision 3 — how long the child lives.**

- **3A. As long as the process that started it wants it.** The server keeps it
  from its first suggestion to its `close()` and starts another when one ends; a
  command ends it once it has answered. It ends when its standard input closes,
  which `close()` does and the parent's end does however it came.
- **3B. It ends when idle.** Frees 630–750 MiB between suggestions, and makes the
  first suggestion after every pause pay the model's load again, 0.6–1.1 s; the
  ceiling does not ask for it once the model is apart.

**Decision 4 — how the child is started.**

- **4A. `process.execPath` with the child's entry file; a binary starts itself.**
  From the sources and in the npm package the runtime runs
  `src/core/ml/embed/child-entry.ts` or `dist/embed-child.js`. A binary has no
  script to hand a runtime, so it runs itself with `DIFFALANCHE_EMBEDDER=1` and
  no argument, the way DA-41 has it write its files out through a child of
  itself; its entry serves the model only then, so a user who sets the variable
  still runs a command.
- **4B. A hidden subcommand of the CLI.** One way for every channel, but the
  npm package would load the whole CLI into the model's process, and a command
  that is not in the CLI's contract would still be in its command table.

## Decision

**1A, 2A, 3A, 4A.** Every way the child can fail — it cannot be started, it ends
before the model is loaded, the model is not there, or it ends under a request —
is a `ModelError`: one line from a command, a 503 from `GET /api/suggest`, as a
model that is not there always was. The worker thread of DA-34.1 is removed: the
process is off the server's event loop as the thread was.

Measured on 2026-09-24 (development machine, Apple M1 Pro; [09-ml.md](../reference/09-ml.md#in-a-process-of-its-own)):
each process's own peak stays under 768 MiB on Bun and on Node — a query's parent
71–343 MiB to 100 000 comments, the server 383–585 MiB to 50 040, and the model's
process at most 751 MiB on Bun in ADR-014's own shape of 200 texts. With the
model in the same process, alternating on the same machine, the query over 50 000
peaked at 846–853 MiB on Bun and the server at 871–995 MiB on both runtimes. The
update after an edit with the index rebuilt in a loop stayed at the baseline: 305
ms at the median of six through the process, 292 without a model, 304 through
the thread it replaces.

## Consequences

- ADR-014's ceiling now meets the model's own weight and nothing else: the
  model's process peaks at up to 751 MiB on Bun, 17 MiB under it, and no change
  to the index or to this split lowers that. The levers are ADR-014's — another
  model, another runtime, or the ceiling restated for the model's process
  (DA-34.3).
- A suggestion now takes two runtimes, so the memory of the two together is
  more than one process held; the ceiling is for a process, and nothing bounds
  the sum.
- The index's own share is the parent's and grows by about 2.6 KB a comment on
  Bun. Mapping the vectors or keeping them in `float16` is what lowers it, if a
  history ever grows past a quarter of a million comments.
- Whatever starts the model goes through `openEmbedder` (a command) or
  `openServerEmbedder` (the server) in `src/core/ml/embed/open.ts`; a third
  caller that loads `embedder()` in its own process takes the model's weight
  into it again. The model's tests load it in the test process on purpose, one
  file at a time.
- `perf/index-scale.ts query` and `serve` print each process's peak from its own
  `maxRSS`, since `/usr/bin/time -l` on macOS reports the highest of the tree.

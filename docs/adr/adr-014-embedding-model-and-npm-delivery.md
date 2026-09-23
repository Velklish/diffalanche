# ADR-014: The embedding model, its runtime, and how it reaches the npm channel

**Status:** Accepted
**Date:** 2026-09-23
**Deciders:** Velklish — accepted as proposed on 2026-09-23, with the one-second budget not yet measured on a quiet machine; DA-33.2 measures it, and a miss returns the budget to the owner

## Context

`docs/SPEC.md` section 3, decision 10, asks for a multilingual embedding model
of about 118M parameters and 120 MB in int8 that ships with the tool, works
offline with nothing to install, and runs in the server process. Open question 1
of section 12, removed when this was accepted, asked how the npm channel gets
it: a download on first run, or a separate `@diffalanche/model` package. DA-33
asks for the model and a runtime
that works under Node and Bun, measured for load time and memory, and verified
three ways: 200 comments embed in under a second after warm-up, the same text
gives the same vector under both runtimes (cosine above 0.999), and a cached
model loads and embeds with the network off.

Three constraints come from what is already decided. Runtime-specific code lives
in `src/server/runtime.ts` alone ([ADR-008](adr-008-diff-rendering-verdict.md)),
so a runtime that needs `Bun.*` or a Node-only module is a new decision. The npm
package is one bundle, `dist/cli.js`, with no runtime dependencies at all — every
package in `package.json` is a development dependency because the bundler
inlines it. And there are six binaries, built by `bun build --compile` into
single files of 62–99 MiB (the figure in DA-41's card).

### How the numbers were taken

Everything below was measured on 2026-09-23 on the development machine — Apple
M1 Pro, 8 cores, 16 GB, Node 25.2.1, Bun 1.3.14, `onnxruntime-node` and
`onnxruntime-web` 1.30.0, `@huggingface/tokenizers` 0.2.0 — **while three other
agent runs shared it**: the 1-minute load average stood between 29 and 132 on 8
cores for every run. Wall-clock times are therefore upper bounds, and the
comparisons between candidates use the CPU time a process spent on the work
(`process.cpuUsage()`), which a busy machine inflates far less. No run was taken
on a quiet machine; the verification that needs one is named under
Consequences.

The corpus is 200 review comments, half English and half Russian, 31 tokens on
average and 48 at most, built from 50 hand-written bases in four framings; each
process loaded the model, warmed up, then embedded the 200 three times. The
quality probe is 20 queries — paraphrases and translations of comments among the
50 bases — scored by whether the intended base ranks first (top-1) and by mean
reciprocal rank. Twenty queries tell a broken model from a working one; they do
not rank two good ones. Peak memory is the `maximum resident set size` of
`/usr/bin/time -l`, which also moves with the memory pressure of the
neighbours.

### Candidates

Two models, both 118M parameters with the XLM-R vocabulary, both the int8
export (`onnx/model_quantized.onnx`, 118.3 MB) of the `Xenova/…` repositories at
a pinned commit: **multilingual-e5-small** (upstream `intfloat/…`, MIT, a
512-token window, trained for retrieval with a `query: ` prefix) and
**paraphrase-multilingual-MiniLM-L12-v2** (upstream `sentence-transformers/…`,
Apache-2.0, trained on 128 tokens). Two runtimes that load under both Node and
Bun: **onnxruntime-node**, ONNX Runtime's N-API addon, and **onnxruntime-web**,
the same runtime compiled to WebAssembly. The tokenizer for all four is
`@huggingface/tokenizers`, plain JavaScript with no dependencies.

CPU is one thread, batches of 32; peak memory is over every run of the pair,
4 to 18 of them, the first exploratory runs included — onnxruntime-web's 718 MiB
is its first run on Node, four threads, in a series that began at a load average
of 33.6.

| Runtime | Model | CPU for 200 comments | Node vs Bun | Probe top-1, MRR | Peak RSS |
|---|---|---|---|---|---|
| onnxruntime-node | e5-small | 2.2–2.6 s on Node, 2.3–2.6 s on Bun | identical | 18/20, 0.942 | 265–651 MiB |
| onnxruntime-node | MiniLM-L12 | 1.9–2.2 s on Node, 2.0–2.6 s on Bun | identical | 18/20, 0.919 | 367–601 MiB |
| onnxruntime-web | e5-small | 10.5–12.5 s on Node, 10.3–11.0 s on Bun | identical | 18/20, 0.950 | 346–718 MiB |

"Identical" is byte for byte: every one of the 200 vectors from Node equals the
one from Bun, for every runtime and model measured. Between the two runtimes
the same text differs — onnxruntime-node against onnxruntime-web came out at
0.9958 cosine at worst — because their int8 kernels are different code. The
JavaScript tokenizer produced the same ids as the Rust `tokenizers` reference
for all 277 texts tried with e5-small — the corpus, its bases, the queries, and
seven edge cases (combining marks, CJK, emoji, 600 characters of one letter);
MiniLM-L12 differed on the 600-character text only, where its `tokenizer.json`
asks Rust to truncate at 128 and the JavaScript library leaves truncation to
the caller.

### What batching does to a vector

The export quantizes activations at run time with one scale per tensor, so in a
batch the scale a text is multiplied by depends on the other texts. Embedding
the 200 comments in batches of 32 and one at a time gave vectors as far apart
as **0.9947 cosine** — further than the two runtimes are from each other. One at
a time cost 2.6–2.9 s of CPU against 2.3–2.7 s in batches, one thread each.

### Threads

onnxruntime-node's pool threads spin while they wait for work. One text per
run with the default thread count spent 7.4–11.2 s of CPU on the 200 comments;
with `session.intra_op.allow_spinning` at `0` it spent 2.6–2.9 s, and one thread
2.0–2.1 s. Thread count and spinning changed no vector: all four settings
produced byte-identical output. In this series the best wall time was 2.1–2.5
s, with four threads and no spinning at a load average of 42.

The module as committed — one text per run, default threads, no spinning —
measured over six processes at load averages of 21–44:

| | Node | Bun |
|---|---|---|
| load, wall (CPU) | 2.8–4.8 s (1.0–1.2 s) | 0.7–4.5 s (0.8–1.0 s) |
| 200 comments after warm-up, wall | 1.9–15.3 s | 1.9–12.9 s |
| the same, CPU | 2.5–2.9 s | 2.5–2.8 s |
| one comment, median of 20 | 6–27 ms | 6–16 ms |
| peak RSS | 503–567 MiB | 476–650 MiB |

The peak comes with the load — parsing the 17 MB `tokenizer.json` is most of it
— and the resident size after the 200 comments was 167–236 MiB.

### Delivery facts

| What | Size | Source |
|---|---|---|
| The model's three files | 135.4 MB | pinned revision, SHA-256 in `src/core/ml/embed/model.ts` |
| The same as an npm tarball (`npm pack` of the three files) | 85.0 MB | measured |
| `onnxruntime-node` 1.30.0 tarball | 113.5 MB, 301 MB unpacked | registry |
| its native files for one platform | 25.5 MB (linux-arm64) to 46.2 MB (linux-x64); on Windows 29–30 MB plus 38–43 MB of DirectML files beside them | the package's `bin/` |
| its CUDA provider, fetched by its `postinstall` on linux-x64 | 236.0 MB | NuGet `Microsoft.ML.OnnxRuntime.Gpu.Linux` 1.30.0 |
| `onnxruntime-web` 1.30.0 tarball | 33.1 MB; the one WebAssembly file needed is 14.2 MB | registry |
| `@huggingface/tokenizers` 0.2.0 | 0.36 MB unpacked | registry |

Four findings about onnxruntime-node decide more than its speed does:

- **It has no build for Intel Macs since 1.24.** The 1.30.0 package ships
  darwin-arm64, linux-x64, linux-arm64, win32-x64 and win32-arm64, and so does
  every release from 1.24.1 on — all eight were checked; 1.23.2 is the last with
  darwin-x64 as well. 1.23.2 is no drop-in: on Node 25.2.1 a process that
  created a session and then called `process.exit()` aborted with `libc++abi:
  terminating due to uncaught exception of type std::__1::system_error: mutex
  lock failed: Invalid argument`, exit code 134, in 2 runs of 2, where 1.30.0
  exited 0 in 2 of 2; and its vectors differ from 1.30.0's by up to 0.0032
  cosine.
- **Its install script downloads the CUDA provider on linux-x64.**
  `script/install-metadata.js` of 1.30.0 lists `cuda12` as the requirement for
  `linux/x64`, and `script/install.js` fetches the files from NuGet whenever
  they are missing and no `ONNXRUNTIME_NODE_INSTALL=skip` is set. As a
  dependency of diffalanche, every `npm install` or `npx` on linux-x64 would
  fetch 236 MB the tool never uses. Bun does not run the script — `bun add`
  reported "Blocked 1 postinstall" — and npm does. This is read from the
  source; it was not observed on Linux.
- **`bun build --compile` does not carry its library.** A compiled script
  embeds `onnxruntime_binding.node` and fails at start:
  `dlopen(…): Library not loaded: @rpath/libonnxruntime.1.dylib`. The binding is
  extracted to a temporary file and its sibling, the 44.6 MB ONNX Runtime
  library, is not there.
- **`session.run` holds the event loop.** `dist/backend.js` of 1.30.0 runs the
  native session synchronously inside a `setImmediate`, so a run blocks the
  thread that called it for as long as it takes.

## Options

**Model → 1A multilingual-e5-small / 1B paraphrase-multilingual-MiniLM-L12-v2.**
The same size and the same speed within the noise. 1A has the larger window
(512 against 128 tokens), was trained for retrieval rather than paraphrase, and
scored a slightly better MRR on a probe too small to separate them; 1B needs no
prefix. The upstream licences are MIT and Apache-2.0; both allow shipping the
weights inside a binary.

**Runtime → 2A onnxruntime-node / 2B onnxruntime-web.** 2B is one WebAssembly
file on every platform, Intel Macs included: nothing native to install, nothing
for `--compile` to lose, 14.2 MB into the tarball. It costs 4 to 5.7 times the
CPU of 2A — 10.3–12.5 s against 2.2–2.6 s for the 200 comments on one thread —
so on the CPU time measured here the one-second budget would take ten cores
working in perfect parallel, and on Bun it runs one thread unless told otherwise
(`self.crossOriginIsolated` is undefined there). 2A is the fast one and brings
the four findings above.

**Intel Macs, if 2A → 3A onnxruntime-node 1.23.2 everywhere / 3B 1.30.0 on the
five platforms it ships, and no model on darwin-x64 / 3C 1.30.0 on five and
onnxruntime-web on darwin-x64.** 3A keeps one runtime on all six targets at the
price of a release frozen before the drop and the abort on `process.exit()`
measured above. 3B keeps one runtime and one version; on an Intel Mac `model
status` would have to say the runtime is not available there, and suggestions
would not work on that one target. 3C covers all six at the price of a second runtime path
and vectors that differ on that platform by up to 0.0042 cosine.

**Model to the npm channel → 4A download on first use into the user cache /
4B a `@diffalanche/model` package.** 4A costs nothing to anyone who never uses
a Phase 2 feature, survives an npx cache that was cleared or a version upgrade
that kept the same pin, and is what decision 10 and DA-41 already describe; it
needs the network once, a source the project controls, and its own checksum. 4B
is offline the moment the install finishes and gets npm's integrity and
provenance for free; it costs 85.0 MB on every cold `npx diffalanche`, whether
or not suggestions are ever used, and a new package release for every new pin.

**The runtime to the npm channel, if 2A → 5A `onnxruntime-node` as a dependency
/ 5B its native files downloaded with the model.** 5A is one line in
`package.json` and 113.5 MB — plus 236 MB of CUDA on linux-x64 through npm —
for every install, and it leaves the binary channel's missing library unsolved.
5B bundles the runtime's JavaScript into `dist/cli.js`, points its binding at the
cache directory, and fetches the native files of the running platform next to
the model. Nothing native is installed by npm, and the binary can use the same
directory: it embeds the same files and writes them there on first use, which
is exactly the library `--compile` fails to carry. It costs build work —
redirecting a `require` the addon makes itself — and loads a native library
from a directory the user can write, which is the trust `node_modules` already
asks for.

**Batching → 6A one text per run / 6B batches.** 6B makes a vector depend on its
neighbours by up to 0.0053 cosine; 6A makes it a function of the text for the
same CPU.

## Decision

Accepted as proposed:

- **1A**, pinned to `Xenova/multilingual-e5-small` at `761b726dd34f`, with the
  `query: ` prefix and a 512-token window.
- **2A**, onnxruntime-node 1.30.0, with pool threads that do not spin. It loads
  under Bun as it is, so it adds no runtime-specific module.
- **3B**: the five platforms onnxruntime-node ships; darwin-x64 gets no model
  until the owner asks for 3C. 3A was measured and is not proposed.
- **4A**: the npm channel downloads the model on first use into
  `$XDG_CACHE_HOME/diffalanche/models/<name>-<revision>/` (`~/.cache` without the
  variable) from an asset the project publishes, checked against the SHA-256 the
  manifest pins. The binary embeds it, as decision 10 says.
- **5B**: the runtime's native files travel the same way as the model and land
  in the same directory — downloaded by the npm channel, written out of the
  binary by the binary.
- **6A**: one text per run.
- **Memory ceiling: 768 MiB** peak resident size for a process that loads the
  model and embeds 200 comments. The highest of the 16 runs of this pair was 651
  MiB, and the ceiling is 18 % above it.

2B was the closest alternative. It is the right choice if the owner prefers one
file on every platform, Intel Macs included, to the one-second budget — the
budget would then have to be restated for it.

## Consequences

- **Not yet measured on a quiet machine: the one-second budget.** The best wall
  time for 200 comments was 1.86 s on Node and 1.94 s on Bun, the module as
  committed at load averages of 21–28; one thread spent 2.0 s of CPU on them. Whether four to six quiet cores bring that under a
  second is unmeasured. The owner accepted this without it: DA-33.2 measures it,
  and a miss returns the budget to the owner.
- DA-41 builds 4A and 5B: the published assets and their checksums, the
  download with progress and a clear message when offline, `model pull
  --embedding`, the binding redirected at build time for the npm bundle and for
  the binaries, and the binary writing its embedded files into the cache. Until
  then `dist/cli.js` contains no runtime and embeds nothing — no command reaches
  `src/core/ml/embed/embedder.ts` — and `onnxruntime-node` and
  `@huggingface/tokenizers` are development dependencies like every other.
- DA-34 and DA-35 embed in the server process and must not hold its event loop
  for long: one text per run keeps a stall to one text, and a rebuild of many
  comments either yields between texts or moves to a worker.
- A vector belongs to the model, its revision, the runtime's version and the
  platform together: 1.23.2 and 1.30.0 differ by up to 0.0032 cosine,
  onnxruntime-web by up to 0.0042, and the four texts of
  `tests/snapshots/embedding-e5-small.json` embedded on linux-arm64 and on
  linux-amd64 (Docker `node:22`, amd64 through emulation with AVX2) came out up
  to 0.0013 from darwin-arm64's. The index records the first three and
  re-embeds when one changes; an index is local to one machine, so the platform
  never meets another.
- `model status` reports the model's name, revision and cache directory today;
  the generative model joins it in Phase 4 (DA-46).

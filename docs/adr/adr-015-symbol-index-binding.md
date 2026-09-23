# ADR-015: The symbol index runs web-tree-sitter with VS Code's WASM grammars, built in the background

**Status:** Accepted
**Date:** 2026-09-23
**Deciders:** the `browse` worker, by the task brief of DA-39; accepted by the orchestrator of the run of 2026-09-23, since the rules force it — ADR-008 rules out 1A, `docs/SPEC.md` section 3 decision 11 ships the grammars with the tool, section 6 asks for 3B

## Context

`docs/SPEC.md` section 3, decision 11, tier 2 asks for a symbol index built with
tree-sitter, grammars for popular languages shipped with the tool and others
added through configuration, no language hard-coded. DA-39 names the languages
that must ship: TypeScript, JavaScript, C#, Python, Go, Rust, Java.

Two rules decide what "built with tree-sitter" can mean here. The server and the
CLI use only APIs Node and Bun share, and a runtime-specific module outside
`src/server/runtime.ts` is a decision of its own
([ADR-008](adr-008-diff-rendering-verdict.md)). And the tool ships twice — an
npm bundle for Node ≥ 22 and a single-file binary per platform
([ADR-002](adr-002-stack-and-delivery.md)) — so whatever parses has to travel in
both.

## Options

**Decision 1 — the binding.**

- **1A. The native `tree-sitter` package.** A Node addon: one prebuilt binary
  per platform and Node ABI, loaded through `require` of a `.node` file. Under
  Bun it depends on Bun's N-API coverage, and in a compiled binary on embedding
  a native library per target. It is a Node-only module in the sense of ADR-008,
  so choosing it would be a second runtime decision next to `runtime.ts`. Not
  measured: the rule rules it out before speed can argue for it.
- **1B. `web-tree-sitter`**, the same C library compiled to WASM with a small JS
  wrapper. Plain JS and `WebAssembly`, which Node and Bun both have; its own
  `.wasm` and each grammar's are bytes the caller hands in
  (`Parser.init({ wasmBinary })`, `Language.load(bytes)`), so nothing depends on
  where a file sits.

**Decision 2 — where the grammars come from.**

- **2A. Build them** with `tree-sitter-cli` and emscripten in this repository: a
  toolchain in CI for every grammar bump.
- **2B. `tree-sitter-wasms`**, one package with prebuilt WASM for many
  languages: 49 MiB unpacked (0.1.13), built with `tree-sitter-cli` ^0.20.8 by
  its own `package.json`, five minor versions behind the runtime.
- **2C. `@vscode/tree-sitter-wasm`**, the grammars VS Code ships, built with
  `tree-sitter-cli` 0.25: all seven languages and TSX, 21 MiB unpacked for the
  whole set, maintained by a team that ships it to every VS Code install.

**Decision 3 — when the index is read.**

- **3A. On the first question** to the symbol route: nothing is parsed until
  someone searches, and that person waits for the whole review to be read.
- **3B. In the background once a review has been read**: the same work, spent
  while the person reads the review rather than while they type a search.

**Measured** on the development machine (Apple M1 Pro) on 2026-09-23 with
`web-tree-sitter` 0.27.0 and `@vscode/tree-sitter-wasm` 0.3.1, the machine
shared and busy (load average 15–22 on 8 cores; the numbers are indications, not
budgets):

| what | Node 25.2.1 | Bun 1.3.14 |
|---|---|---|
| `Parser.init` | 8.5 ms | 22.1 ms |
| grammar load (TypeScript / Python / Go / C#) | 18 / 7 / 2 / 20 ms | 91 / 42 / 3 / 35 ms |
| parse and query 252 files, 2 MiB — the code files of the full synthetic review | 1 315 ms, 5.2 ms a file, 4 561 definitions | 2 787 ms, 11.1 ms a file, 4 561 definitions |
| the first `GET /api/search/symbols` over that review, index built inside it | 1 072 ms (`node dist/cli.js`) | 1 000 ms (`dist/diffalanche-darwin-arm64`) |
| a second query, index built | 44 ms | 61 ms |
| `tests/symbols.test.ts`, 300 generated files in four languages | 494 ms | 346 ms |

Every query of the bundled table compiles against its grammar of 2C and finds
the definitions of a sample of each language (`function`, `class`, `method`,
`type` captures).

## Decision

**1B with 2C.** `web-tree-sitter` is the runtime, `@vscode/tree-sitter-wasm`
supplies the grammars, both as dev dependencies bundled at build: the JS of the
runtime goes into `dist/cli.js`, and the eight WASM files it reads — the runtime
and TypeScript, TSX, JavaScript, C#, Python, Go, Rust, Java — are copied into
`dist/grammars/` for the npm channel and embedded into each binary as files
(`with { type: "file" }` in the generated binary entry, which only the Bun
build compiles). `src/core/ml/symbols/grammars.ts` reads them from whichever of
the three places has them: what the binary handed over, `dist/grammars/` beside
the bundle, or the two packages in a checkout. The runtime is imported the
first time the index is asked for, so a CLI command that never searches never
loads it.

**The index is read in the background once a review is open (3B), not on the
first question (3A).** `GET /api/review` hands the repositories of the document
it just served to the index, which starts reading every one not read yet and
answers nothing until asked. `docs/SPEC.md` section 6 says nothing loads lazily
while the user works; the first question of 3A waited about a second on the
synthetic review, and longer on large repositories, in the middle of a search the
person was typing. 3B spends that second while the review is being read and
answers the question from what is already there. A question that arrives while
a repository is still being read waits for that repository alone. The runtime is
initialised once a process: `Parser.init` a second time, under a parser another
index is using, corrupts the WASM memory both share, which is what the suite hit
when the server's index and a test's own ran side by side.

A read that fails — a build whose listing git refuses, a rereading that throws —
drops the repository, so the next question reads it again rather than failing
with it until the server restarts.

The index keeps itself current twice over. Each `diff-changed` frame has the
files it names read again — or the whole repository, when the frame names
nothing (a fallback rescan) or a path that is not on disk (the temporary name of
an atomic write, which Bun reports). And every question and every review read
compare the change set of each repository with the one the index last saw: a
file whose content moved differs from the base, so it is in the change set, and a
patch that changed or a file that entered or left it is read again. That covers
a repository whose frames never come — one outside the scope of the task the
watcher follows, which another window's task can still show. A language whose
grammar or query would not load costs its own files and nothing else, and the
route says which in `failed`.

The language table is data (`src/core/ml/symbols/languages.ts`): a grammar file,
the extensions it owns, and a query whose captures name the kind. A language
`config.json` adds under `grammars` is an entry of the same shape with its own
WASM path, so no language is hard-coded and a configured entry of the same name
replaces a bundled one.

2A would own a toolchain to produce what 2C already publishes; 2B is twice the
size for grammars built with a CLI 0.20. 1A buys parse speed the index does
not need — the first query of the full synthetic review is a second either way,
and every later one tens of milliseconds — at the price of the runtime rule.

## Consequences

- **Size.** Measured with `bun run build -- --target current` and
  `npm pack --dry-run` against the base commit `5a5f8e8`: the npm tarball grows
  from 318 374 to 1 327 118 bytes (+0.96 MiB packed, +10.3 MiB unpacked, of
  which C# alone is 4.9 MiB); `dist/cli.js` from 283 071 to 443 420 bytes; the
  `darwin-arm64` binary from 62 503 506 to 73 566 546 bytes (+10.6 MiB). The
  other five binaries embed the same bytes and grow by the same amount, not
  measured one by one.
- **Memory.** The index holds its definitions in the server process, and the
  WASM heap of the runtime with them: 131–204 MiB of resident memory while the
  252 files were indexed in the measurement above.
- **Opening a review pays for the index, in the background.** A repository is
  read whole once, one file after another in the server's own event loop,
  between reads of the disk; the time scales with the code of the review. A
  question that comes before a repository is read waits for it.
- **A grammar bump is a dependency bump.** The queries name node types of each
  grammar; a new grammar version that renames one makes that query fail to
  compile, and `tests/symbols.test.ts` is what notices: it compiles every query
  of the table against its grammar and finds a definition of each kind the query
  names in a sample of every language. A language without a
  query in the table is not indexed, rather than guessed at.
- **The binary entry is generated.** `scripts/build.ts` writes the imports of
  the WASM files into `.build/binary.ts`; a grammar added to the table is
  embedded by the next build without further change.

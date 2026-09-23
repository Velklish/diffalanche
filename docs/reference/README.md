# Reference

How diffalanche works today — from the code, not intention. Intent and rationale are in [ADRs](../README.md); this reference describes only the behaviour of the running version. It is organised by subsystem so each file can be edited independently. The “Scope” field of tasks links here.

The table names the subsystems the task cut expects; each section file is written by the task that creates the subsystem. Every section is written: `09-ml.md` describes a subsystem of which only the embedding model exists yet and says so, because a gap in the middle of a reference reads as a page someone forgot.

| Section | About | Planned path |
|---|---|---|
| [01-scanner.md](01-scanner.md) | Finding repositories under the root: roots, depth, exclude, worktrees, warnings | `src/core/scanner` |
| [02-git.md](02-git.md) | Reading the change set: base modes, merge base, untracked files, patch parsing, one scan of the whole review | `src/core/git`, `src/core/change-set.ts` |
| [03-storage.md](03-storage.md) | Data directory, session directories, locking, atomic writes, schema version, configuration | `src/core/storage`, `src/core/config` |
| [04-domain.md](04-domain.md) | Sessions, the scope and status of a review task, comments, anchors, roles, unanswered and awaiting, export | `src/core/domain` |
| [05-watcher.md](05-watcher.md) | Watching repositories and the data directory, incremental rescans, activity events | `src/core/watcher` |
| [06-cli.md](06-cli.md) | Commands, flags, exit codes, JSON output | `src/cli` |
| [07-server.md](07-server.md) | HTTP routes, the review document, SSE stream, static UI | `src/server` |
| [08-ui.md](08-ui.md) | Screens, store, keyboard map, live patching | `src/ui` |
| [09-ml.md](09-ml.md) | Embedding model, index, suggestions, generative model (Phase 2 and later) | `src/core/ml` |
| [10-skills.md](10-skills.md) | Shipped agent skills and the reply protocol | `skills/` |
| [11-perf.md](11-perf.md) | Synthetic review generator, the performance gate, the CLI smoke matrix, the runtime the unit suite runs on, and the release pipeline | `scripts/`, `perf/` |

## Checks that read the code

Some properties of the source are held by the unit suite, because neither Biome nor the typecheck has a rule for them. They read TypeScript as a syntax tree through tree-sitter's grammar (`tests/helpers/typescript-syntax.ts`), the one the symbol index already ships ([ADR-015](../adr/adr-015-symbol-index-binding.md)). TypeScript 7 is not the parser: its package root exports only its version, and the parser lives in the native `tsgo` binary, reached through `typescript/unstable/sync`, which spawns that process and talks to it over a synchronous pipe under a name that says the API may change in any release. The unit suite runs on Node and on Bun, and tree-sitter is plain WASM on both.

### Every export has an importer

`tests/exports.test.ts` (DA-59). `noUnusedLocals` does not look at an exported symbol, so an `export` nothing consumes is how an unused symbol escapes `bun run typecheck`, and Biome 2.5 has no rule that sees it. The test reads every TypeScript file git would commit — tracked, or untracked and not ignored, declaration files aside — and fails on each export no other file imports. What counts as a use:

- a named import, of a value or a type;
- a re-export, by name, by `export *` or as `export * as ns`, which uses its source;
- a namespace import, which takes every name;
- a dynamic `import()`, which takes the names destructured from it or read off the binding it lands in, and every name when it is neither.

A name a file re-exports is an export of that file, and it needs an importer of its own: a barrel such as `src/core/domain/index.ts` publishes only what something takes from it. So a barrel's unused name goes red first, and once it is gone from the barrel, its source's export does — two passes to converge. A use inside the exporting file does not count, and a default export is not checked: the configurations that have one are read by their tools, not imported.

An entry point's re-exports are its published surface and are not held to an importer; its own declarations are. The entry points are read, not listed: the TypeScript paths in `bin`, `main`, `exports` and the scripts of `package.json`, the `src` of a `<script>` in a page under `src/`, and the plain string literals of the top-level `.ts` files of `scripts/`, `e2e/` and `perf/` and of the root `*.config.ts` — where the build, the Playwright web server and the perf gate name theirs. A module specifier is an import rather than an entry, and a template string is not read at all: in `scripts/build.ts` it is generated code, whose imports are uses and not entries. The cost is that an entry named only inside a template is not found — `e2e/fixture.ts`, which `e2e/acceptance.config.ts` runs through `` `bun e2e/fixture.ts ${FIXTURE}` ``; it re-exports nothing, so nothing turns on it, and one that did would keep its re-exports in `KEPT`. The package's `bin` names `dist/cli.js`, a build output; its source, `src/cli/index.ts`, is found in the `build:cli` script, and `src/ui/main.tsx` in `src/ui/index.html`; the test asserts it finds both.

A red run lists the file, the line and the symbol of each export nobody imports. There are three ways out: drop the `export`, or the name from the barrel, and let `noUnusedLocals` say whether the symbol is used at all; import it where it was meant to be used; or add it to `KEPT` in the test with the reason it stays public. `KEPT` holds what an import in no checked-in file takes: `useGrammarSource`, `embeddedAssets` and `EmbeddedAsset`, which the entry `scripts/build.ts` generates for the compiled binary imports; and `HEARTBEAT_MS` and `ModelFile`, which another track's code imports until both tracks land. A reason that stops being true, because the symbol got an importer or is gone, fails the test beside it.

The check runs inside `bun run test`, which is already in `gates` in `backslop.json` and in the CI `check` job, so it has no gate line of its own.

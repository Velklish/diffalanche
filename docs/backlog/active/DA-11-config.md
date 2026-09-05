# DA-11 · Config: defaults, flags, user fallback

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-8
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 7, `config.json`: `roots`, `depth`, `exclude`, `user`, `port`, `lsp`. Defaults without a config: `roots: ["."]`, `depth: 2`, port 4880, empty `lsp`. The server listens on `127.0.0.1` only. `--root`, `--data-dir`, `--port` override.

## Work to do

- `src/core/config`: load `config.json` from the data directory, apply defaults, validate types, merge command-line overrides; export a typed `Config`.
- `user` fallback when absent: `git config user.name` from the root, then the OS user name ([ADR-002](../../adr/adr-002-stack-and-delivery.md) assumption).
- Path resolution: `roots` relative to the root; `--data-dir` relative to the current directory.
- Errors name the file and the field.

## Out of scope

- LSP execution (Phase 3); writing config from the UI.

## Verification

- Vitest: no config file → defaults; a config with `port: "x"` → error naming `port`; `--port 5000` overrides the file; `user` resolves from git config on the fixture and from the OS when git has none.

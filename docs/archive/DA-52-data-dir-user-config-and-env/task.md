# DA-52 · Data directory from the user config and DIFFALANCHE_DATA_DIR

- **Scope:** 03-storage, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-06
- **Dependencies:** none
- **Taken:** 2026-09-06

## Context

`docs/SPEC.md` section 3, decision 5: the data directory is `<root>/.diffalanche/`,
overridable with `--data-dir`. The flag is the only way to move it, and it has
to be repeated on every command — one forgotten flag creates `.diffalanche/` in
the root again. The owner's workspace (2026-09-06) keeps the root free of
per-tool state directories and does not list them in the shared `.gitignore`:
the data directory should live under a directory the workspace already
ignores, `.agents/diffalanche/`, and the tool should find it without a flag.

`config.json` cannot carry the answer, because it lives inside the data
directory itself. Two sources outside the root can: the process environment
and a configuration file of the user.

## Work to do

- `loadConfig` resolves the data directory in this order: `--data-dir`
  (relative to the current directory, as today) → `DIFFALANCHE_DATA_DIR`
  (relative to the root) → `dataDir` in the user config
  `$XDG_CONFIG_HOME/diffalanche/config.json`, `~/.config/diffalanche/config.json`
  without the variable (relative to the root) → `<root>/.diffalanche`. An empty
  variable counts as unset. Only `dataDir` is read from the user config; a
  `dataDir` that is not a string is refused naming the file and the field, the
  way `config.json` values are.
- The environment and the user config directory are parameters of
  `loadConfig`, so tests never read the developer's own.
- `--help`, the README's global flags table, [06-cli.md](../../reference/06-cli.md),
  [03-storage.md](../../reference/03-storage.md), `docs/SPEC.md` section 3
  decision 5 and section 8 name the new sources and the order; CHANGELOG under
  Unreleased.

## Out of scope

- Other settings in the user config: `roots`, `depth`, `exclude`, `port` stay
  in `config.json` of the data directory.
- Moving an existing data directory: the tool does not copy `.diffalanche/`
  to the new place.

## Verification

- `tests/config.test.ts`: the variable relative to the root; the user config
  relative to the root; the flag above the variable; the variable above the
  user config; an empty variable ignored; a non-string `dataDir` refused
  naming the user config file.
- `bun run test`, `bun run typecheck`, `bun run lint`, the README/CLI parity
  test in `tests/readme-cli.test.ts`.

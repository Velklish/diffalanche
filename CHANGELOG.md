# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Agent skills: `skills/diffalanche-apply` reads the unanswered threads, groups
  them by repository, stops for the human's confirmation, edits
  `<root>/<repo>/<path>`, and replies to every comment;
  `skills/diffalanche-review` reads `diff --json` and opens findings anchored to
  the lines that carry them. Each is a `SKILL.md` beside a `references/cli.md`
  whose commands and JSON shapes are captured from a run on the small synthetic
  review. Neither calls `resolve` or `reopen`, and both say not to reach for
  `--role human` when the CLI refuses. `package.json` now lists `skills` in
  `files`, so the published package carries them beside `dist`. See
  [10-skills.md](docs/reference/10-skills.md) and the README's agent skills
  section.
- The write API: `POST /api/comments`, `/api/comments/:id/replies`,
  `/api/comments/:id/resolve` and `/reopen`, `POST /api/sessions`,
  `POST /api/sessions/:name/use`, `PUT /api/sessions/:name/base`, and
  `GET /api/export`. Every write goes through the same domain and the same lock
  as the CLI, signed with `user` from `config.json` and `role: human`, and
  answers with the comment or the session it changed. A request that is wrong
  about itself — a body that is not an object, a severity that is not one of the
  four — is a 400 naming the field; a request the domain refuses keeps the
  domain's code and message. A session whose base changed is served from a fresh
  scan rather than from the cache that was computed against the old one. A write
  has to come from the review's own page — the server has no authentication, so
  the origin of a write is the whole check — and a body has to arrive as
  `application/json`. See [07-server.md](docs/reference/07-server.md).
- The review server: `startReviewServer({ config, ui, verbose })` scans the
  root, reads the change set into `diff.json`, starts the watcher, and serves
  `GET /api/review` — the change set of the current session with the session,
  its comments and its counters in one document — plus `GET /api/sessions`,
  `GET /api/config`, `GET /api/scan`, and the built UI with an `index.html`
  fallback. The wire shape is `ReviewDocument` in `src/core/types.ts`, which the
  UI imports; the response carries no hunks, and the document is built and
  serialised once per change rather than once per request. Refusals are the
  domain's own code and message, and a root with no current review session
  answers `GET /api/review` with 404 `no-current-session` instead of refusing to
  start. The server listens on `127.0.0.1` only and says so in one sentence when
  the port is taken. See [07-server.md](docs/reference/07-server.md).
- Watcher and activity events: `src/core/watcher` watches every reviewed
  repository and the data directory, rescans one repository about 100 ms after
  its last change — and at most a second after the first change of a burst —
  replaces that repository's entry in `diff.json` under the session lock, and
  puts `diff-changed`, `comment-added`, `reply-added`, `comment-status`,
  `session-changed`, and `warnings` on an in-process event bus. A rescan whose
  result is what the cache already held announces nothing, and without a cache
  the whole change set is read rather than one repository. Comment events come
  from comparing `comments.json` with the last read, so a write from the UI and
  a write from `diffalanche reply` are one event each. Recursive `fs.watch`
  where the runtime honours it — asked with a probe rather than assumed, and
  dropped for the walk on a timer when the watch fails; `.git` internals except
  `HEAD` and `index`, `node_modules`, the `exclude` globs, and the data
  directory are left out. The activity feed keeps the last 200 lines in memory
  and names the agent that is editing a repository. See
  [05-watcher.md](docs/reference/05-watcher.md).
- CLI comments: `list`, `show`, `reply`, `comment`, `resolve`, `reopen`, and
  `export`, the commands an agent works a review through. Defaults are
  `--author agent` and `--role agent`; `resolve` and `reopen` refuse anything but
  `--role human` and change nothing. `--body -` reads standard input. A line
  anchor is captured from `diff.json` with the repository read again first, so a
  comment written right after an edit points at the line that is there now, and
  `--repo` may be left out for a comment on the whole review. Every write goes
  through the domain and its lock, so two CLI processes and the UI interleave
  without losing a message. See [06-cli.md](docs/reference/06-cli.md).
- CLI core: `review new`, `review use`, `review list [--json]`, and `review base`
  over the review sessions, and `diff [--repo] [--json|--patch]`, which scans the
  whole root against the session's base, rewrites `diff.json`, and prints the
  same set it wrote — as JSON, or as a unified patch with a `#` line naming each
  repository. `serve` gains `--open`. Every command takes `--review`,
  `--data-dir`, and `--root`; every command's flags and its `--help` come from
  one set of definitions that `util.parseArgs` is configured from. Exit code 0
  is success, 1 a user error with one line on stderr, 2 anything unexpected with
  its stack trace, and JSON goes to stdout with nothing mixed into it. `diff.json`
  now records the base it was computed with, so a session whose base changed is
  rescanned rather than patched, and a `--repo` no repository sits at is refused
  instead of printing an empty review. See
  [06-cli.md](docs/reference/06-cli.md).
- Impeccable in the project: `PRODUCT.md` records the durable product truth a
  design pass needs — users, purpose, positioning, operating context,
  constraints, brand commitments, and the evidence that does not exist and must
  not be invented. `DESIGN.md` records the visual system as `src/ui/tokens.css`
  implements it: 56 colours across both themes byte-for-byte from the token
  file, seven typography roles, the radius and spacing scales, 25 components,
  and the named rules the handoff implies. `.impeccable/design.json` carries
  what that format cannot — the two shadows, the two keyframes, the focus
  rings, the 1560 px floor, and eight component snippets — and
  `.impeccable/surfaces/src-ui-app-tsx.md` is the review workspace's own brief.
  The design detector hook is enabled for the repository in
  `.impeccable/config.json`; each developer wires their own harness manifest,
  which `README.md` spells out. See [08-ui.md](docs/reference/08-ui.md).
- A file whose name git does not write literally keeps the name it has on disk:
  a name outside ASCII, which git C-quotes with octal escapes, and a name with a
  space, which git pads with a tab. The path is the id a comment anchors to and
  the file an agent opens, so a mangled one could be commented on and then never
  found again.
- Git diff reader: `src/core/git` resolves the base of a review session in each
  repository for all three modes — `head`, `branch` against the merge base with
  the named or the remote default branch, and an explicit `ref` — and reads the
  change set against it, untracked files included. Every fallback is a warning,
  a repository whose base does not resolve is skipped with one, and each file
  carries both the raw patch the renderer needs and the hunks `diff.json` stores.
  Binary files and files over a size limit are listed without content. See
  [02-git.md](docs/reference/02-git.md).
- Repository scanner: `scan(root, config)` in `src/core/scanner` walks the
  `roots` of `config.json` to `depth` levels, reports every repository by its
  path relative to the root with its kind — an ordinary repository or a linked
  worktree — and never descends into one, so nested submodules and worktrees
  stay out of the review. `exclude` globs skip directories, symbolic links are
  not followed, and a scan warns about a worktree whose main repository is also
  under the root and about a directory it cannot read. See
  [01-scanner.md](docs/reference/01-scanner.md).
- Package skeleton: `package.json`, strict `tsconfig.json`, Biome, Vitest, the
  `src/core`, `src/cli`, `src/server`, `src/ui`, `scripts`, and `skills`
  directories, and a GitHub Actions workflow running lint, typecheck, and tests.
- `scripts/synth.ts`, the generator of the synthetic review: 21 repositories,
  300 files, 30 000 changed lines, and 200 comments, deterministic for a given
  seed, with a small profile for unit tests. Run it with
  `bun run synth -- --out <dir>`; it refuses an output directory it did not
  write itself, because it erases that directory before filling it.
- Phase 0 spike of the diff rendering: `src/core` reads the change set of every
  repository through the `git` binary, `src/server` serves it as one response on
  Hono, `src/ui` renders it with a diff library in split view, and `perf/`
  measures the page in headless Chromium. `react-diff-view` with virtualisation
  by file card meets the budgets of the specification; see
  [ADR-008](docs/adr/adr-008-diff-rendering-verdict.md).
- Both delivery channels on a CLI with `version`, `serve`, and `--help`:
  `bun run build` produces `dist/cli.js` for npm and six binaries — macOS,
  Linux, and Windows on x64 and arm64 — each carrying the UI inside itself. The
  runtime switch between Bun's server and `@hono/node-server` is the only place
  in `src/` that knows which runtime it runs on.
- `src/core/storage`, the data directory: session directories, the `current`
  pointer — one line naming the session — and reading and writing `review.json`,
  `comments.json`, and `diff.json` as JSON with `version: 1` and two-space
  indentation. Every write is a temporary file, `fsync`, and a rename over the
  target; every write to a session goes through `withLock`, a `.lock` directory
  with a bounded wait and takeover of a lock past the deadline recorded in it.
  A broken file is refused with the file and the field named. The synthetic
  review now writes the `current` pointer too.
- `src/core/config`: `config.json` with defaults, type checking, and the
  `--root`, `--data-dir`, and `--port` overrides, resolved into one typed
  `Config`. `roots` is relative to the root, the two flags to the current
  directory. Without a `user` the name comes from `git config user.name` read in
  the root, and from the operating system user after that.
- `src/core/domain`: review sessions. `createSession` writes the session and
  makes it current, `useSession` switches, `setBase` changes the base and bumps
  `updatedAt`, and `listSessions` gives the history most recently updated first
  with open and resolved counts and the repositories of the last scan.
  `parseBaseArgument` reads `head`, `branch`, `branch:<name>`, and a ref in one
  place for the CLI and the API alike; a session name is lowercase letters,
  digits, dot, dash, and underscore.
- Comments in `src/core/domain`: `addComment`, `reply`, `resolve`, `reopen`,
  `get`, and `list` with filters by status, repository, severity, and
  unanswered. A line comment's anchor is captured from `diff.json` — the line
  text, the hunk header, and three lines of context on each side — and a line
  the change set does not have is refused with the nearest hunk named. Only a
  human resolves or reopens. `countReview` gives the open, resolved,
  unanswered, and awaiting counts per file, per repository, and per review with
  the worst open severity, and `exportMarkdown` writes the export grouped by
  repository. The synthetic review now keeps three lines of anchor context, as
  the tool does.
- Performance gate: `bun run perf` measures the page on the synthetic review
  three times in headless Chromium and fails when the median of any line of the
  budget table is over budget. It runs in CI as the `perf` job, prints the table
  into the run summary, and is one of the `gates` of `backslop.json`. The two
  budget lines Phase 0 cannot measure — switching sessions and updating after an
  edit — are printed as pending until DA-9 and DA-25.
- UI shell: the review workspace of the handoff — header, sidebar, centre panel,
  right column, and status bar with their fixed widths and the 1560 px threshold
  below which the window scrolls sideways; every design token of both themes,
  the theme toggle remembered in `localStorage`, Instrument Sans and JetBrains
  Mono as local assets so the page needs no network, the logo and the favicon
  built from markup, the overlay and toast primitives, and the loading skeleton
  that keeps the panels at their final widths. State moved into a zustand store
  split into the handoff's slices, typed on the on-disk shapes of the
  specification. `GET /api/review` now also returns the current session and its
  comments, read straight off disk until DA-16. The TypeScript configuration is
  split so `src/server` and `src/cli` no longer see `DOM` and `src/ui` no longer
  sees Node, and `bun run test:ui` runs the Playwright screenshot tests of the
  shell in both themes.
- Diff view: one `react-diff-view` per file card in the handoff's tokens — card
  header with the caret, the path, the comment badge, the state chip and the
  `split` / `unified` segments remembered per file; hunk headers that hide and
  restore the context lines the bundle carries; the slots the composer, the
  range highlight, and the inline threads of DA-22 and DA-23 plug into; and
  binary or oversized files listed with a chip instead of an empty diff. The
  height of an unseen card is counted from its patch against fixed row heights,
  so the scrollbar does not drift, and the table is given an explicit width so
  unwrapped code costs no intrinsic measurement — 2.5 ms of CPU per frame on the
  synthetic review. `@git-diff-view/react` and the renderer query switches are
  gone with the dependency, and the performance harness measures the one page
  that ships.
- Sidebar navigation: the tree of repositories with changes and their files,
  with open-comment counters in the colour of the worst severity, `+N` / `−N`,
  collapse per repository, and a keyboard order that walks the filter, a
  repository, then its files. The filter is a substring over repository and file
  paths with the number of matches inside the field and a line when nothing
  matches. Choosing a file scrolls its card into view, and the current file
  follows the reading position once the scroll has stopped.

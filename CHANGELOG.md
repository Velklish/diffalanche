# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

One section per version, newest first, under `## [x.y.z] - YYYY-MM-DD`, and an
`## [Unreleased]` section that is always present: every change lands there
first, and a release renames it and opens an empty one above it. The release
workflow reads the section of the version it is publishing and uses it as the
release notes, so an entry missing here is missing from the release page too —
and `bun run release` refuses a version that has no section. See
[Releases](README.md#releases).

## [Unreleased]

### Changed

- The session-switch budget is measured over the whole wait — the press, the
  `POST` that makes the session current, the read of the review that follows,
  and the render — where it used to start after that review had already been
  parsed and so left the server's share outside the number. Only the
  first-render row of `docs/SPEC.md` section 6 is qualified with "after the
  server responds". The line is printed with DA-24.1 named rather than failing
  the build: it says a warm switch is just over the budget and a cold one about
  five times over, which is a question about where the built document is cached.
  See [11-perf.md](docs/reference/11-perf.md).

- Small text clears WCAG AA, and motion has an alternative (DA-22.1). `--tx3`
  and `--ln` are raised in both themes until every token pair the interface
  actually sets text in is at least 4.5:1 — the gutter's line numbers were the
  worst of them at 2.87:1 in the light theme, and they are the one thing on the
  screen a reviewer types back. `prefers-reduced-motion: reduce` takes the
  travel out of `dcin` through a token rather than a second keyframe, so an
  arrival still fades, and stops `dcpulse` with the dot lit rather than caught
  mid-fade. A resolved thread steps back by tone instead of `opacity: 0.55`,
  which had been multiplying the contrast of everything on the card down to
  about 4.4:1. `tokens.css`, `DESIGN.md` and `.impeccable/design.json` change
  together, and `tests/design-contrast.test.ts` is what holds the ratios.

### Added

- The release pipeline. One annotated tag, `v0.1.0`, made by `bun run release`
  and pushed by hand, publishes both delivery channels:
  `.github/workflows/release.yml` takes the version from the tag and checks it
  against `package.json`, reads the release notes out of this file, builds the
  UI, `dist/cli.js`, and all six binaries in one job — `bun build --compile`
  cross-compiles, so a matrix of six would rebuild the same UI six times —
  attaches the binaries and a `SHA256SUMS.txt` to a GitHub release — the step
  counts its lines against the six targets, so a build short of a binary stops
  the release rather than shipping a page missing a platform — and publishes to
  npm with provenance from the `NPM_TOKEN` secret. The release is a draft until
  its binaries are on it, and it is made before the npm publish, because it can
  be made again and a published npm version cannot be taken back; a pre-release
  version goes to the `next` dist-tag. `scripts/release.ts` is the local
  preflight — the declared version, a clean tree, the branch `main`, a free tag,
  this file's section with something under it, and `bun run test` — and it makes
  the tag and nothing else: pushing is the owner's step. `files` in
  `package.json` now excludes `dist/diffalanche-*`, so the npm tarball is the
  bundle, the UI, and the skills rather than 490 MB of binaries that are release
  assets. `ci.yml` gains a `concurrency` group that cancels superseded pull
  request runs — a push to `main` gets a group per commit, because a shared
  group cancels what is queued in it as well — and a note of the check-run names
  the branch protection rule has to list, which are not the job ids. See
  [11-perf.md](docs/reference/11-perf.md).

- The acceptance list of specification section 10 as a suite (DA-28). Every
  line of it that involves the UI is one named test in `e2e/acceptance.spec.ts`
  — the repositories with changes, the sibling worktree that is a repository of
  its own, the submodule and the worktree nested inside one that are not, the
  untracked file in the diff, the scan that leaves `git status` alone, `branch`
  mode on a feature branch ahead of the remote default branch, the comment
  written in the UI that `list --json` reads back without a restart, the reply
  from `reply` that reaches the page without a refresh, `resolve` in the UI
  taking a comment out of `list --status open`, the reply in the activity feed
  under its `--author`, and `review use` switching both sides at once.
  `bun run test:e2e` runs it against the binary: the suite builds the target of
  the machine it is on, makes its own fixture, serves it on a free port and
  stops it again, and the CLI the tests read back with is that same file.
  `bun run test:ui` keeps the fast path over the sources; the two have their own
  fixture and their own port but share `dist/`, so they run one after the other.
  The fixture adds what the generator does not make — a clone with a remote, a
  feature branch one commit ahead, a clean working tree, and a worktree checked
  out inside it — in `e2e/fixture.ts` rather than in `scripts/synth.ts`, whose
  profiles are what the performance gate measures. The `e2e` job of
  `.github/workflows/ci.yml` runs it on ubuntu and macOS and puts one row per
  criterion in the run summary. See [08-ui.md](docs/reference/08-ui.md) and
  [11-perf.md](docs/reference/11-perf.md).

- An open overlay holds the focus (DA-26.1). `Tab` and `Shift+Tab` cycle inside
  the panel instead of walking the page behind the scrim, the scrim itself is no
  longer a tab stop, and closing an overlay puts the focus back on the control
  that opened it. It is one treatment in `components/Overlay.tsx`, which global
  search now uses like the base picker and the export do. See
  [08-ui.md](docs/reference/08-ui.md).

- The live stream answers as soon as it is subscribed, with a `: connected`
  comment line (DA-25.1). A response head is not on the wire until something is
  written into the body, so a quiet review used to leave `EventSource.onopen` —
  and with it the sidebar footer — waiting fifteen seconds for the first
  heartbeat. Nothing was ever missed in that window; the silence was what could
  not be seen. See [07-server.md](docs/reference/07-server.md).

- The header (DA-24): the session menu of handoff section 7 with the history
  from `GET /api/sessions`, its metrics, a `CURRENT` chip and a create form that
  takes a name and a base in the CLI's own grammar; the base picker of section 5
  with its three modes and the branches of the whole root from the new
  `GET /api/repos/branches`; the two counters as buttons that filter the rail —
  `awaiting you` becomes a chip beside `unanswered` while it is on; the export
  of section 9, rendered and raw, with `Copy .md` — both tabs group and sort the
  export the same way the markdown does; the scanner warnings bar with a dismiss
  remembered in `sessionStorage` per session; and the status bar's context line.
  A whole review arriving replaces a whole review: no draft, selection, open
  reply or focused thread survives a session switch or a change of base.
  The performance budget for switching review sessions is measured rather than
  pending: the harness makes a second session out of the fixture and times the
  swap of the thread set. `src/ui/base.ts` is the one place that writes a base
  as the argument the domain parses and reads it back as a label. See
  [08-ui.md](docs/reference/08-ui.md).
- `GET /api/repos/branches`: every branch of the root, with the remote it
  belongs to, how many repositories resolve it, and whether a remote points its
  `HEAD` at it. One `git for-each-ref` per repository, read-only; `name` is what
  `branch:<name>` takes, so the picker and the CLI have one grammar for a base.
  See [07-server.md](docs/reference/07-server.md).


- The empty states (DA-27). A root nobody has opened a session in is no longer a
  review that failed: `GET /api/review` refuses it with `no-current-session`,
  the store reads that by its code, and the first-run screen of handoff section
  10 takes the body — the mark, the three metrics counted from `GET /api/scan`
  (repositories found, with changes, worktrees), a name with its base, `Create`,
  and the line that does the same from a terminal. Creating a session there
  posts it and opens the review it made; a refusal keeps the screen and says
  why. A session whose base resolves to what the working trees already hold gets
  the no-changes screen in the centre panel, naming the session and offering the
  two things that would change the answer — the base and the session. See
  [08-ui.md](docs/reference/08-ui.md).

- The keyboard map and global search (DA-26). Every row of the handoff's table
  is wired — `⌘K` and `⇧⇧` for search, `J` / `K` between the open threads of the
  whole review, `C`, `R`, `B`, `⌘⏎`, `esc` — as one listener over actions of the
  store (`keys.ts`), with the hints in the status bar naming them. Three rows
  wait for what they act on rather than for a key: `↑` / `↓` and `TAB` in the
  composer move through Phase 2's suggestions, and `⏎` in the base picker
  belongs to DA-24's picker. `esc` closes in one order and stops at the first
  thing it found, so it never throws away a comment being written under a modal.
  `J` and `K` order the open threads by repository, file, and line, wrap at both
  ends, and bring the rail and the diff with them. Global search is the modal of
  handoff section 6 over the files of the change set and the comments of the
  session: ranking by substring and word overlap, a twelve-line preview with the
  target line marked and the deletions kept beside what replaced them, the
  pointer selecting as well as opening. See
  [08-ui.md](docs/reference/08-ui.md).

- Live update in the UI (DA-25). The page holds one `EventSource` on
  `GET /api/events` and patches what an event names instead of reading the
  review again: a repository's new diff is merged into the one on screen file by
  file and hunk by hunk, so a file that says the same thing keeps the object it
  was rendered from and its card is not re-rendered at all — asserted with a
  `MutationObserver` over both cards, the edited one and its neighbour. A hunk
  that did change takes the accent border and `updated 12s ago`. Every patch is
  bracketed by the scroll anchoring, so content that grows above the reader does
  not move what is under their eyes; an open composer on another file is left
  alone, and one on the edited file is re-validated — when the edit took its
  line away the form drops to the file anchor with what was typed still in it
  rather than disappearing when the renderer can no longer key it to a row.
  Threads are patched from `GET /api/comments/:id`, and an agent's reply also
  raises a toast. The AGENT ACTIVITY panel of the rail is fed by the `activity`
  frames over the ring read from `GET /api/activity` on every open, merged by
  id; the sidebar footer says whether the stream is `watching`, `reconnecting`,
  or still `connecting`. The live-update budget line is now a gate: the harness
  measures from the edit of a fixture file to the frame that showed it in that
  file's card. See [08-ui.md](docs/reference/08-ui.md) and
  [11-perf.md](docs/reference/11-perf.md).


- The thread rail and the threads in the diff (DA-23). One card, drawn the same
  in the rail and as a widget under the line it is anchored to: severity chip,
  anchor, `awaiting` or `RESOLVED`, body, replies coloured by role, `Resolve` /
  `Reopen` and `Reply`. The rail's two tabs count this file's threads and the
  review's, and the `unanswered` chip is the domain's own `isUnanswered`. Focus
  runs both ways — a card in the rail scrolls the page to its widget, and the
  widget's own header focuses the card; a commented line is marked with a bar in
  its gutter in the colour of its worst open thread. Reply, resolve and
  reopen go through one write that shows the change before the server has it and
  puts the threads back with the server's own sentence when it refuses. A card
  claims the height of its threads before it is mounted, and a jump to a card
  scrolls again once the cards around it have mounted — without that the reading
  position landed on a different file within 120 ms of the click. See
  [08-ui.md](docs/reference/08-ui.md).

- Line selection and the comment composer (DA-22). A drag over the new column of
  a diff — or a click, or shift-click to widen — lights the range and opens the
  form of handoff section 2 under its last line, inside the card. `C` opens it
  on the first line the change set adds to the file being read; the card header,
  the repository header, and the session menu open it on the file, the
  repository, and the whole review, the three anchor levels that have no line;
  a card that is collapsed when its form opens stops being collapsed.
  The form proposes `warning`, `⌘⏎` sends and `esc` closes, and the comment goes
  to `POST /api/comments` and into the store at once, so the badges move before
  the next read. A card being written in is not unmounted by virtualisation.
  `src/ui/types.ts` now re-exports `src/core` instead of mirroring it, and the
  counters the badges show are the domain's own rather than a second count in
  the browser. See [08-ui.md](docs/reference/08-ui.md).

- Documentation for a first reader: `README.md` rewritten end to end — what the
  tool is, the two delivery channels and what is not published yet, a first run
  with the output it really prints, where the data lives, every field of
  `config.json` with its default, the whole CLI with its flags, the agent
  skills, development and testing, and an index of the rest. The CLI table is
  guarded by `tests/readme-cli.test.ts`, which renders `--help` for every
  command through `run()` and fails when the README and the CLI disagree in
  either direction. `docs/reference/09-ml.md` fills the last gap in the
  reference as a stub that says what Phase 2 will build there and what is
  already decided. The glossary gains *review document*, *activity feed*, and
  *delivery channel*, and retires *review bundle* as a second spelling of the
  first.
- The unit suite runs on both runtimes. `bun run test` starts Vitest through Bun
  and Vitest runs the tests on Node; `bun run test:bun` runs the same suite on
  Bun's own runtime, and the `test-bun` job of `.github/workflows/ci.yml` is
  that half in CI. `tests/runtime.test.ts` compares the runtime it finds with
  `DIFFALANCHE_TEST_RUNTIME`, so a runner that quietly goes back to spawning
  Node workers fails the job instead of passing it. See
  [11-perf.md](docs/reference/11-perf.md).
- CLI smoke matrix: `scripts/smoke.sh <command>` runs one review from
  `review new` to `export` through whichever CLI it is given — the npm bundle on
  Node, the sources on Bun, or a compiled binary — under a temporary root of its
  own that no repository of the checkout is in. It generates the small synthetic
  profile, reads the anchor of its comment out of `diff --json`, serves the
  review in the background and checks that `/api/review` agrees with it, opens a
  comment as a human, replies as an agent, resolves it, and exports it; a
  failure prints the command as it would be typed again, its exit code, and its
  stderr. The `smoke` job of `.github/workflows/ci.yml` runs it on Node 22
  (ubuntu, macOS, Windows), on the current Bun (ubuntu, macOS), and against the
  binary built in the same job (ubuntu, macOS); the Windows job is
  `continue-on-error` until DA-45 verifies it. See
  [11-perf.md](docs/reference/11-perf.md).
- The live stream: `GET /api/events` sends what the watcher noticed as named
  Server-Sent Events with an id that counts up — `diff-changed`,
  `comment-added`, `reply-added`, `comment-status`, `session-changed`,
  `warnings`, and `activity` — with a heartbeat every fifteen seconds and a ring
  of the last two hundred frames, so a client that reconnects with
  `Last-Event-ID` is caught up rather than reloading the review — and one the
  ring can no longer reach back to is told to read the review again, in a
  `reload` frame, rather than given half of what it missed. What an event
  names is one fetch away: `GET /api/repos/:repo/diff`, `GET /api/comments/:id`,
  `GET /api/warnings`, and `GET /api/activity` for the feed a page that has just
  connected would otherwise start empty. Stopping the server ends every open stream. The change
  set is announced before `diff.json` is written, because the file is megabytes
  and the update the person waits for must not wait for it; the performance
  harness now measures that path — an edit of one file to the page holding the
  new diff — and prints it as the live-update line of the budget table. See
  [07-server.md](docs/reference/07-server.md).

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

### Fixed

- A line anchor's context is the anchored side of the hunk. `anchor.before` and
  `anchor.after` were sliced out of the hunk's raw line list, which holds both
  sides, so a `new`-side anchor kept lines the change removed — text that is not
  in the file the comment is about, and what re-anchoring after an edit matches
  against. The context now comes from the lines that side has: `context` and
  `insert` for `new`, `context` and `delete` for `old`. See
  [04-domain.md](docs/reference/04-domain.md).
- Files git ignores no longer wake the watcher. Once a repository's debounce
  window closes, `git check-ignore --stdin -z` is asked about the paths of that
  burst — one process for the whole window — and a burst whose every path is
  ignored produces no rescan and no event, instead of the four git processes and
  the cache rewrite a rescan spends to find nothing. A build writing into
  `dist/` for a minute cost one rescan a second before this. The answers are
  kept per repository — at most 4096 paths, oldest out first — and dropped when
  a `.gitignore`, `.git/info/exclude`, or `.git/index` inside that repository
  changes; a tracked file is never reported as ignored, so it still wakes the
  watcher whatever a pattern says. Nothing under `.git` is ever suppressed,
  because git makes no exception for its own directory: under a `.gitignore`
  starting with `*` it answers that `.git/HEAD` is ignored, and a commit would
  otherwise leave the review's base stale in silence. `.git/info/exclude` is now
  one of the files inside `.git` the watch reports. See
  [05-watcher.md](docs/reference/05-watcher.md).

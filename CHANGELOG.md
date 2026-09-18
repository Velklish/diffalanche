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

### Added

- **The sessions menu is the history of tasks** (DA-56). Two groups —
  `Открытые задачи` and, under them, `Закрытые` — and every row says what its
  task is about: `2 repos · 5 files`, or `все репозитории` for a session with no
  scope. A closed row keeps its counters, carries a `CLOSED` chip, and steps
  back by tone the way a resolved thread does.
- **A task is closed and reopened from its row.** The same press does both, and
  it is the human's gesture: the server signs the write with the configured user
  and `role: human` and takes neither from the request. Closing is a marker and
  not a lock — comments, replies and resolves go on working on a closed task —
  so there is no confirmation in front of it and no red button.
- **The row says which window is on it, and which task the CLI answers about.**
  Two different chips, because they are two different facts: switching a task
  moves this window's address and never `current`, so the reader can be on one
  task while the terminal beside them is on another. Neither says `CURRENT`:
  there is no main task.
- **A task that appears while the window is open raises a quiet mark** on the
  session pill and does nothing else — no toast, no switch, no scroll, and the
  composer being written in stays open. Opening the menu clears it. A task this
  window created, closed or reopened raises no mark: the reader has seen it.
- **The scope on the screen** (DA-55). A `SCOPE` pill sits beside `BASE` and
  says what the task is about — `2 repos · 5 files` — and opens the **scope
  editor**: an overlay over the whole root with a tick per repository and per
  file, where a task is built and changed by hand. A session with no scope has
  no pill: it is about the whole root, which is not a narrowing. The review
  screen carries the scope and nothing else — the tree, the reading column, the
  counters and the rail all speak about the task, and nothing names what was
  left outside it.
- **Taking something out of a task asks first.** Removing a repository or a file
  that carries comments opens a confirmation naming it, how many comments would
  go with it and how many of those are open, and only then consents. Cancelling
  writes nothing. This is the only place in the product that destroys review
  data, and it never happens without that dialog.
- **Select mode.** A second tab beside `changes` turns the tree into a picking
  surface with a bar at the foot of the sidebar — `N repos · M files` and
  `New task…`, which asks for a name and a base and creates the task with that
  scope. Outside the mode the tree is exactly what it was.
- **A window shows the task its address names.** `?review=<name>` decides what
  this window loads, and switching a task in the menu changes that address
  rather than `current`: several agents work on several tasks at once and none
  of them is the main one. `Back` walks the tasks a window has been on.

- A review session carries a **scope** — the repositories and the files it is
  about — and a **status** a human sets, so a review is one task rather than the
  whole working area (DA-53, [ADR-010](docs/adr/adr-010-review-task-scope.md)).
  A scope is one list of entries, each a whole repository or a repository with
  an explicit list of paths; a session without one is the whole root, which is
  what every session used to be. Nothing outside the scope is shown or returned:
  `diff`, `list`, `show`, `export`, and the review document all answer inside
  it, and no summary of what was left out is offered anywhere.
- `review new` takes repeated `--repo <path>` and `--path <repo>:<file>` and a
  `--no-use` that leaves `current` where it is and prints the task's address —
  how an agent proposes the review of what it has just written without taking
  over the screen the human is on. `review scope`, `review scope add`, and
  `review scope remove [--drop-comments]` read and edit the scope; `review
  close` and `review reopen` set the status and need `--role human`, the rule
  `resolve` has had since [ADR-004](docs/adr/adr-004-agent-contract.md).
  `review list` carries the scope and the status in every row.
- `GET /api/review?review=<name>` answers with a named task instead of the
  current one; `GET /api/sessions/candidates` is the change set of the whole
  root, scope ignored, for a scope editor to pick from; `PUT
  /api/sessions/:name/scope` replaces a scope and answers 409 with the number of
  comments a narrowing would delete unless the body consents to it; `POST
  /api/sessions/:name/close` and `/reopen` set the status. The live stream gains
  `sessions-changed`, so an open window hears that a task appeared or was
  closed.
- A comment on something outside the task's scope is refused by name — in the
  CLI and over the API — and the refusal says what the task *is* about. Stored,
  it would be a finding nothing reads back.

- The reading column says which repository it is in, and there are two ways into
  one. The repository header is one 38 px line — path, `<branch> ← <base>`,
  counts, `Comment on repo` — stuck under the header while its files are being
  read and pushed out by the next repository's, with a `--bd2` hairline above
  every section but the first. The name in the tree and the repository on a
  thread card jump to that section; the caret in the tree still only collapses
  the branch. The row stays one tab stop and one focus ring: the pointer picks
  by where it landed and the keyboard by key, `⏎` to jump and `Space` to
  collapse (DA-54).

- The data directory can be moved for good, not only per command: after
  `--data-dir`, `loadConfig` reads `DIFFALANCHE_DATA_DIR`, then `dataDir` from
  the user config `$XDG_CONFIG_HOME/diffalanche/config.json` (`~/.config`
  without the variable), and only then falls back to `<root>/.diffalanche`. A
  relative variable or `dataDir` is taken from the root, so one value serves
  every root; an empty variable counts as unset; only `dataDir` is read from
  that file (DA-52).

### Changed

- **The planning documents say where the project is** (DA-84). `docs/SPEC.md`'s
  status line, `README.md`'s status and the SPEC row of `docs/README.md` all say
  Phase 1 shipped as v0.1.0 and its findings are closed from the backlog;
  `docs/ROADMAP.md` names no task numbers any more — a task belongs to a phase by
  what it delivers, and the tracker is the only mapping.
- **An agent's reply under a comment is at most three sentences** (DA-108). One
  when the finding is fixed, three when it is declined, with no restating of the
  comment, no greeting and no lists. `skills/diffalanche-apply` shows a
  paragraph-long reply beside its two-sentence form, and the decline example in
  its CLI reference has the three sentences; `docs/SPEC.md` section 9 carries
  the cap.
- **A comment in code is at most two lines** (DA-57, [ADR-011](docs/adr/adr-011-comment-length.md)).
  `//`, `/* */` and JSDoc alike, across `.ts`, `.tsx`, `.css`, `.yml` and shell.
  Knowledge that does not fit moves to its `docs/reference/` section, or to an ADR
  when it is a decision, and the comment left behind is the pointer. Markdown keeps
  no limit. 720 blocks in the repository are over the line the day this lands; DA-58
  brings them in and turns the count into a gate, and until then the rule binds new
  and edited code.
- **Every route a window uses takes `?review=<name>`, writes included** —
  `GET /api/comments/:id`, `/api/warnings`, `/api/repos/:repo/diff`,
  `/api/export`, `POST /api/comments`, `/api/comments/:id/replies`, and
  `/resolve` and `/reopen`. Without it they answer for the current session, as
  before. A window opened on a task now writes into that task: until this it
  read one and wrote into another, which put a comment where nothing the reader
  could see would read it back. `GET /api/repos/:repo/diff?review=` reads that
  one repository from the working tree rather than from the task's `diff.json`,
  which the watcher keeps fresh only for the current session — served from the
  cache, a live update showed the diff of a minute ago.
- `POST /api/sessions` takes a `scope` and a `use`, so a review task is made in
  one write. The UI sends `use: false` everywhere but the first-run screen,
  where there is no `current` to leave alone
  ([ADR-010](docs/adr/adr-010-review-task-scope.md), decision 4).

- `SCHEMA_VERSION` is 2. `review.json` and `comments.json` of version 1 are read
  — a version 1 review is the whole root and open — and written back as version
  2 by the next write, so a data directory upgrades itself as it is used;
  `diff.json` of a version this build does not know is discarded and scanned
  again, because it is a cache. `diff.json` now records the scope it was
  computed for beside the base, and a cache computed for another scope is read
  again rather than trusted.
- A scan reads only the repositories of the scope. The walk still finds every
  repository — it starts no git process, and it is what tells a repository the
  scope names but the root has not from one that is simply quiet — so a task
  over two repositories of the synthetic review's twenty-one starts no git
  process for the other nineteen; `tests/scope-scan.test.ts` counts the
  processes rather than the seconds. The watcher watches every repository and
  rescans only the ones in the scope.

- The probe that asks what is being read moved from 62 px to 100 px — under the
  header and the new repository bar — and is now one exported `PROBE_Y` in
  `src/ui/reveal.ts` instead of a copy in the centre panel and another in the
  live update. The second copy was what made a live edit above the reader move
  the text under their eyes: it anchored to the bar, which is sticky and never
  moves. `.file-card { scroll-margin-top }` holds the same number, so a card
  jumped to still lands on the probe (DA-54).

- The performance gate on a GitHub-hosted runner holds every millisecond
  ceiling times a named allowance — `RUNNER_ALLOWANCE` in `perf/budgets.ts`,
  2.5 — and the long-task line at zero; a development machine holds the
  specification's numbers. The first `perf` job on `ubuntu-latest` measured the
  same commit a little over twice as slow on every millisecond line, with zero
  long tasks, and the table now names the widened ceiling beside the budget.
  See [11-perf.md](docs/reference/11-perf.md).

- **`startServer` answers with the address the socket is bound to** (DA-104),
  not only its port. "Listens on `127.0.0.1` and nowhere else" was guarded by
  one test that reaches the server from another of the machine's own addresses,
  and on a machine with none — a container, an IPv6-only runner, a laptop with
  the Wi-Fi off — it passed over its own assertion without a word. That test now
  reports a skip naming what it did not exercise, and the bound address is
  checked on every machine instead. See
  [07-server.md](docs/reference/07-server.md).

- **`review scope set` gives a scope to a session that has none** (DA-53.1). The
  scope editor writes through `PUT /api/sessions/:name/scope`, which replaces,
  and the CLI had only `scope add`, which widens and therefore refuses a session
  about the whole root. The new command replaces the scope outright and takes
  `--drop-comments` for what falls outside it, refusing with the count and the
  ids without it — the shape `scope remove` already had. Putting a task back to
  the whole root is still the editor's alone. See
  [06-cli.md](docs/reference/06-cli.md).

### Fixed

- **A test fixture no longer inherits the developer's own data directory**
  (DA-54.1). `bun run test:ui`, `bun run test:e2e` and `bun run perf` neutralise
  `DIFFALANCHE_DATA_DIR` and `$XDG_CONFIG_HOME` the way `bun run test` already
  did, from one place — `fixtureEnv()` of `src/core/config/index.ts` — rather
  than from a line copied per harness. On a machine whose
  `~/.config/diffalanche/config.json` sets a relative `dataDir` the fixture
  server used to look for its session under that path, find none, and answer 404
  about every route of the review; Playwright polled `/api/review` for two
  minutes and reported a timeout that named the wait and not the cause. The
  readiness probe is now `/`, which is up as soon as the server is, and the
  fixture server prints the data directory it resolved. No suite needs
  `DIFFALANCHE_DATA_DIR` or `--data-dir` on the command line any more. The gate
  hands its children that environment explicitly rather than assigning it: Bun
  gives a child the environment the process started with, so an assignment made
  after start reaches nothing — measured, and written down in
  [11-perf.md](docs/reference/11-perf.md).

- **`diffalanche diff | head` no longer crashes the CLI** (DA-91). Nothing
  listened for errors on `process.stdout`, and the `try`/`catch` that maps every
  failure onto an exit code cannot see an `EPIPE`: it arrives later as an
  `'error'` event on the socket, not as a rejection. A single 300 KB write into
  a reader that had gone therefore ended in a Node internals stack trace — the
  CLI reporting a refusal it never made. A reader that goes away is now exit
  code 0 with nothing on stderr; any other stream fault is one line and exit
  code 2. Both entry points take their streams from one helper, so the npm
  channel and the binary answer alike. See
  [06-cli.md](docs/reference/06-cli.md).
- **`serve --review <name>` opens on that task instead of being ignored**
  (DA-81). The flag parsed everywhere and was read by every command but this
  one, so a misspelling was exit 0 with no message while the same name was exit
  1 on `list`, `diff`, `show`, `comment` and `export`. It now names the task the
  printed address is on — `http://127.0.0.1:<port>/?review=<name>`, that task's
  counters under it, and `--open` opening it — resolved before the socket opens,
  so an unknown name is the domain's own refusal and nothing is left running.
  `current` is not moved and never enters the address on its own. See
  [06-cli.md](docs/reference/06-cli.md).
- **A rebound name no longer reads the review** (DA-62). Both origin guards
  asked whether the client's `Origin` matched the client's own `Host`, which a
  DNS-rebinding page controls on both sides. Every request under `/api/` now
  names the host it arrived on and the server answers only for its own —
  `127.0.0.1` and `localhost`, the two names the IPv4 loopback socket it binds
  can be reached under — with a `403` for anything else, on reads as much as on
  writes. See [07-server.md](docs/reference/07-server.md).
- **A refused listening socket is one line and exit code 1** (DA-71). `serve`
  worded "port 4880 is already in use" and then threw it as a bare `Error`, so
  the CLI printed the sentence with a stack trace under it and exited 2 — the
  code that means "anything the tool did not expect", which a failure `serve`
  words on purpose is not. Both worded refusals are now a `ListenError` and
  reach the person as `diffalanche: ` and the sentence; any other errno from the
  socket keeps the stack trace and exit code 2. See
  [06-cli.md](docs/reference/06-cli.md) and
  [07-server.md](docs/reference/07-server.md).
- **A data directory that cannot be created is a refusal, not a stack trace**
  (DA-99). `ensureDataDir` and `ensureSessionDir` let a raw `EACCES` out of
  `mkdir` untouched, which reached the person as an errno string and exit code
  2 while the storage reference promised that everything storage refuses is a
  `StorageError`. Both now create their directory through one helper that names
  the directory and why — permission, a read-only filesystem, no space, a file
  in the way — and an errno it does not word is rethrown as it was. See
  [03-storage.md](docs/reference/03-storage.md).
- **`serve` no longer dies on a file it just decided to tolerate** (DA-64). The
  server starts on a `comments.json` that is not JSON and says so through the
  address; the CLI then read the same document a second time for the line under
  it and rethrew, and the exit killed a socket that was already open and a
  watcher that was already running. That line now says the review could not be
  read and points at the address, which names the file. See
  [06-cli.md](docs/reference/06-cli.md).
- **`GET /api/repos/:repo/diff?review=` no longer reads git outside the root**
  (DA-72). The segment came from the URL and went straight to a `join` against
  the root, so a percent-encoded `../` — which Hono decodes before routing sees
  it — read any git working tree the person could read. The path is now
  resolved against the root and refused with the route's own
  `no-such-repository` 404 when it does not stay below it, before any git
  process starts. See [07-server.md](docs/reference/07-server.md).
- **A `comment` refused on its anchor levels no longer rescans the repository
  first** (DA-88). The command guarded the refresh on `line` and `repo` alone,
  so a forgotten `--path` or a transposed `--line 4 --end-line 2` spawned the
  git processes for that repository and rewrote `diff.json` before `addComment`
  refused it — the one exit 1 of `comment` that broke the invariant
  `docs/reference/06-cli.md` states. The domain's `assertAnchorLevels` is now
  exported and called ahead of the refresh, the way the scope check already was,
  and the domain keeps its own check for every other caller.

- **A line that cannot be anchored is refused for the reason it really has**
  (DA-101). `captureAnchor` said "`<file>` has no hunks in the change set" about
  a file that is nothing but hunks whenever every hunk of it lacked line numbers
  on the side asked about — a deleted file with the default `--side new`, an
  added file with `--side old`. The refusal now names the side that carries the
  lines and the one to anchor on instead, and "has no hunks" is kept for a file
  that really has none. See [04-domain.md](docs/reference/04-domain.md).

- **The severity order is storage's list and nobody else's** (DA-83). The domain
  kept a second copy of `critical, warning, nit, question` for `worstSeverity`,
  against the decision that the value lists are exported once from
  `src/core/storage/types.ts`. A fifth severity would have been accepted by the
  schema and the CLI while every badge of a scope whose only open comment
  carried it painted as carrying none. `worstSeverity` now reads `SEVERITIES`,
  and a test drives the property off that list rather than off a written-out
  one. See [04-domain.md](docs/reference/04-domain.md).

- **An atomic write flushes the directory entry that publishes it** (DA-90). The
  temporary file was flushed and the rename that gives it its name was left in
  the page cache, so a `comment` that exited 0 could be absent after a power
  loss with the previous `comments.json` still in the listing. `review.json`,
  `comments.json` and `current` now sync the containing directory after the
  rename; `diff.json` and the lock's `info.json` pass `durable: false`, being a
  cache git rebuilds and a file no crash outlives. A platform that will not open
  a directory skips the flush, and so do `EINVAL` and `ENOTSUP` from the flush
  itself; every other failure — `EIO` above all — reaches the caller as a
  `StorageError` naming the directory, rather than leaving a command to exit 0
  on durability it did not get or 2 with a stack. What this closes is
  the operating-system window and not the drive-cache one — on macOS `fsync(2)`
  does not reach the drive. See [03-storage.md](docs/reference/03-storage.md).
- **A lock left by a killed writer is taken over instead of hanging the next
  one** (DA-89). The wait was ten seconds against a thirty-second lease, so a
  writer arriving in the first twenty seconds after a holder died waited the
  whole ten and refused, naming a writer that was not there. The wait is now
  derived from the lease and floored by it — `timeoutMs` defaults to `staleMs`
  and an explicit value below it is raised — and the refusal names the pid and
  the lease it read: `held by pid 4213 since …, its lease running to …; gave up
  after 30000 ms`. See [03-storage.md](docs/reference/03-storage.md).
- **Releasing the session lock no longer removes the lock of the writer that
  took the session over** (DA-78). The release read the token and then removed
  whatever directory was at the path, so a writer whose body outran the lease
  could delete the live lock of its successor and hand a third writer the same
  session. It now renames the lock aside first, the way a takeover does, and
  deletes the directory it read the token from — one rename more on a path that
  every write ends with. See [03-storage.md](docs/reference/03-storage.md).
- **A nested repository's git directory is no longer watched whole** (DA-103).
  The pruning was anchored at the watched repository's own `.git`, so a plain
  nested clone — or an old-style submodule with a real git directory in the
  working tree — had every loose object, pack and ref of it inside the watch: a
  `git fetch` down there cost a `check-ignore` and a full rescan of the outer
  repository per window, and the polling walk `stat`ed the whole object store on
  every tick, while the outer change set could not move a line. Inside a nested
  `.git` only `HEAD`, `packed-refs` and `refs/heads/` are reported now — where a
  gitlink points, so a commit or a checkout down there still wakes the watch —
  and the rest is left out, the walk included. The repository's own `.git` keeps
  exactly the rules it had. A modern submodule was never affected: its git
  directory is a file into `.git/modules/`, which was already pruned. See
  [05-watcher.md](docs/reference/05-watcher.md).
- **Closing the watcher waits for the rescan in flight** (DA-97). `close` was
  synchronous and stopped only what had not started: an item already inside its
  own `await` ran to the end, holding the session lock and writing `diff.json`
  after the caller had been told the watcher was closed. On the teardown paths
  that is a rescan re-creating `reviews/<name>/` under a directory just removed,
  or failing into `onError` attributed to whatever runs next, or leaving a lock
  directory the next writer waits 30 s for. `Watcher.close` now answers a
  promise and drains the queue, and `startReviewServer`'s own close and its
  failed-listen path await it. The walk of a polling tree is deliberately not
  part of the promise: it reads, and writes nothing into the data directory. See
  [05-watcher.md](docs/reference/05-watcher.md).
- **A failed write inside the recursive-watch probe no longer ends the server**
  (DA-92). The probe writes into a temporary directory until the watch answers,
  and the first of those writes was detached from the promise the probe awaits:
  a rejection there — a full disk, `EIO`, a quota — escaped every `try` around
  it and, with no `unhandledRejection` handler in the process, aborted
  `diffalanche serve` mid-start instead of answering the question the probe
  exists to answer. It is caught now and answers `false` at once rather than
  after the timeout, so a filesystem that is already refusing writes starts the
  server on the walk that much sooner. The same detached shape in the SSE
  stream's `end` — `void stream.close()` in `src/server/events.ts` — is caught
  too. See [05-watcher.md](docs/reference/05-watcher.md).
- **A watch that dies mid-session no longer loses the window it dies in**
  (DA-85). When an error from inotify or FSEvents handed a tree to the walk, the
  walk opened with a silent baseline and every edit made between the failure and
  the end of that first walk was folded into it: a repository whose only change
  fell inside the window kept showing the pre-edit diff for the rest of the
  session. The takeover is now the signal — once the replacement's baseline is
  taken the tree is read whole, a repository rescanned and the data directory
  reloaded — so it over-reports by one rescan and cannot under-report. The
  degradation is no longer silent either: a watch that dies after it started
  reaches `startWatcher`'s new `onFallback` — once, whichever tree it was — and
  `serve` prints one line about the trees being walked on a timer. A runtime
  that never had a recursive watch still starts on the walk in silence. The
  unused `Watcher.polling()` is gone, and a tree watcher's `ready` is the live
  one rather than the dead watch's. See
  [05-watcher.md](docs/reference/05-watcher.md).
- **A broken `comments.json` no longer stops the session events** (DA-86). The
  reload of the data directory read the comments without a guard, so a file
  broken by hand while the server ran took the rest of the chain down with it:
  `session-changed` and `sessions-changed` stopped, and a base change, a scope
  edit or a task opened elsewhere reached an open window as nothing at all. The
  read is caught where it happens, the comment baseline is dropped the way it
  already was for an unreadable file at start-up, and the failure is reported
  once on the way into the broken state rather than once per burst. See
  [05-watcher.md](docs/reference/05-watcher.md).
- **A `git add -f` is no longer swallowed by a cached ignore verdict** (DA-74).
  The answers git gave about a repository's paths were dropped when a burst
  named `.gitignore`, `.git/info/exclude` or `.git/index` in full, and a runtime
  that collapses the name to the bare `.git` — Bun does — left them in place: a
  build output that had been answered `ignored` once stayed suppressed after it
  became tracked, with no rescan, no event and no warning, until 4096 other
  paths pushed it out. Anything the watch reports inside `.git`, the bare
  directory included, now drops that repository's verdicts. See
  [05-watcher.md](docs/reference/05-watcher.md).

## [0.1.0] - 2026-09-05

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

- `bun run perf` completes its three repetitions. The gate ran them in one
  process, and the second browser that process launched after a whole
  measurement stalled — no ready signal, no step returning, no timeout firing —
  so the gate printed `run 1/3` and sat there until it was killed. Each
  repetition is now its own `perf/run.ts --runs 1` process with its own server
  and browser; the cause of the stall is recorded, not found. See
  [11-perf.md](docs/reference/11-perf.md).
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

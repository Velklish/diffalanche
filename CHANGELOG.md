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

- **`review delete` and deleting a task from the sessions menu** (DA-40).
  `diffalanche review delete <name> --role human [--yes]` removes the session's
  directory with its comments: any other role is refused with exit code 1, as
  `review close` refuses it, and without `--yes` it asks on the terminal and
  refuses when there is none. A deleted current session moves `current` to the
  session updated last, or clears it. The UI's row carries `Delete`, which asks
  in the row's place — the count of comments, `Отмена` focused, `Удалить` red —
  and a window on the deleted task moves to `current`; `DELETE
  /api/sessions/:name` deletes as the configured human and drops what the
  server held for the task. The directory goes in one rename under the
  session's lock, and nothing brings it back: the lock refuses a writer that
  waited on it, or a late scan, and a session gone under a write is the server's
  404 `no-such-session`. A delete from the CLI beside a running server is
  forgotten too: every burst of the data directory hands the server its listing,
  and a held document of a session gone, or made again under its name, goes. `Ctrl-C` and `Ctrl-D` at the question are a no. The embedding index is
  left to its next reader, which drops the deleted session's comments —
  measured at 33–38 ms once over 5 000 of them.
- **Suggestions from history and `AUTO` in the comment form** (DA-36). While a
  comment is typed, `FROM YOUR HISTORY` lists the five nearest past comments of
  every session from `GET /api/suggest`, asked once typing pauses for 200 ms and
  only for a text with a word of four characters or more, in a query cut to
  12 000 bytes between characters; `↑` / `↓` choose a row and `TAB` takes the chosen one's text and
  severity — only a row the arrows chose, unlike the handoff, so a `Tab` on to
  `Comment` never replaces a draft — and the panel's five slots are drawn from
  the start so an answer moves nothing. The `AUTO · <prediction>` chip, chosen
  by default, resolves the severity when the comment is sent — the vote on the
  text being sent, `warning` without one or after 10 s — and the comment is
  stored with `severitySource: "auto"`; a chip pressed or a row taken is
  `manual`; a form closed while it waited sends nothing, and the field is
  read-only while its send waits. While the model is
  away (503) the form says so, keeps `AUTO` out of reach and asks again after a
  pause of 10 s growing to a minute. Threads show `auto` and, once an agent
  agrees in `reply --confirm-severity`, `labelled by <agent>`; `show` prints the
  same, and a confirmation with an empty `--author` is refused.
  `severitySource` is new in `comments.json` (`auto`, `manual`,
  `confirmed:<author>`, absent read as `manual`) without a new schema version: a
  build from before it drops the field when it writes the file, which loses the
  labels and nothing else ([03-storage.md](docs/reference/03-storage.md#schema-versions)).
- **The embedding model reaches both channels** (DA-41). The npm package
  downloads the model and this platform's ONNX Runtime files once, on the first
  `suggest` or `index rebuild` or the first suggestion `serve` is asked for, from
  its version's GitHub release — 180 MB on an Apple Silicon Mac — with progress on
  standard error, every file checked against the SHA-256 the build pins and read
  back once it has its name, and one clear line when it is offline, when a file
  does not match, or when the disk refused the write; `serve` itself downloads
  nothing, and answers a suggestion 503 while the files arrive. Two processes that
  prepare at once each write files of their own. The runtime's files sit in a
  directory of their version and platform under the model's, so two versions of
  the tool never overwrite each other's; `model status` says whether they are
  there, and on an Intel Mac that the runtime is not available.
  `diffalanche model pull --embedding` fetches it ahead of time, and
  `DIFFALANCHE_ASSETS_URL` names a mirror. The binaries carry both (233–290 MiB by
  platform) and write them into the same cache on first use, from a child of
  themselves so the process that loads the model stays under 768 MiB.
  A Bun plugin shared by the npm bundle and the binaries loads the runtime's
  binding from the cache, and the model's process ships as
  `dist/embed-child.js`. The release stages nineteen assets beside the binaries
  and sums them all into `SHA256SUMS.txt`. The README has a section on the model's
  files, sizes and cache, and the agent's CLI reference makes `model pull
  --embedding` a step of its own before `suggest`, since a download is not resumed
  ([09-ml.md](docs/reference/09-ml.md#delivery)).
- **`suggest` and `GET /api/suggest`** (DA-35). `diffalanche suggest --body <text>
  [--json]` answers with the five past comments nearest the text across every
  review session — each with its similarity, severity, session, file and line —
  and the severity they vote for with a confidence: each neighbour weighs
  `exp((similarity − nearest) / 0.01)`, the confidence is the winner's share of
  the weight, and nothing is proposed when the nearest is under 0.86. The three
  numbers were chosen on forty labelled comments in two languages
  (`perf/suggest-vote.ts`, [09-ml.md](docs/reference/09-ml.md#suggestions)).
  `GET /api/suggest?body=` answers the same from the server, with the model in a
  process of its own started by the first request: 3–7 ms warm over 240 comments,
  10–36 ms over 10 000 to 50 000; a model that is not there, or a process that
  cannot load it, is a 503, and the server's `close()` ends the process.
  A blank `--body`, and a root nobody reviewed, are refused in one line. Each
  severity of the synthetic review now has two texts of its own, so its comments
  cluster: the same eight texts, count and seed.
- **The embedding model runs in a process of its own** (DA-34.1, DA-34.2).
  `suggest`, `index rebuild` and the server's first suggestion start the model in
  a child process — `node dist/embed-child.js` in the npm package, the binary
  itself in a binary — which gives the bytes the calling thread gives, and keep
  the index and its search where they are. Two measurements put it there. With
  the index rebuilt in a loop on the server's own thread, the update after an
  edit took 422–435 ms against 272–297 ms without it — every step of a rescan
  waits out the run in progress; with the model in its process the update is
  back at the baseline, 305 ms at the median of six against 292. And with the
  model in the same process, a query over 50 000 comments peaked at 846–853 MiB
  on Bun and the server after its first suggestion at 871–995 MiB on both
  runtimes, over ADR-014's 768 MiB; apart, a query's own process peaks at
  71–343 MiB to 100 000 comments, the server at 383–585 MiB to 50 040, and the
  model's process at up to 751 MiB — 17 MiB under — whatever the index holds. The server keeps the process until it
  closes and starts another when one ends; a command ends it once it has
  answered, and one that never closes it still exits and takes it along. A
  process that cannot start, cannot load the model, or ends under a request is a
  `ModelError` and the route's 503. `perf/run.ts --embedding <main|child>` and
  `--lag` take the event loop's measurement again, and `perf/index-scale.ts
  query` and `serve` print each process's peak
  ([09-ml.md](docs/reference/09-ml.md#in-a-process-of-its-own)).
- **The embedding index, and `index rebuild` and `index status`** (DA-34).
  `src/core/ml/index` keeps a vector for every comment of every review session,
  with its session, id, severity, anchor and text, in `index/index.bin` of the
  data directory: one line of JSON, then the vectors as raw floats. Whatever
  reads it brings it up to date first, embedding only what is new or edited and
  not reading a session whose `comments.json` did not change, so a comment an
  agent writes with no server running is found as surely as one written in the
  UI — and `diffalanche comment` never loads the model. A search is brute force
  by cosine with a session filter: 1.8–3.6 ms over 10 000 comments, under 50 ms
  to 100 000; memory is what stops it first, and with the model in its own
  process each process stays under ADR-014's 768 MiB to 100 000 comments
  ([09-ml.md](docs/reference/09-ml.md#how-far-brute-force-goes)). An index built by
  another model, runtime or platform is embedded again, and a data directory with
  no session gets no `index/`. `index status [--json]` says what it holds and what
  it is missing without loading the model. The npm bundle leaves the embedder out
  until DA-41 delivers the runtime.
- **The reference's frame tables are checked against `WatcherEvent`** (DA-109).
  The events of [05-watcher.md](docs/reference/05-watcher.md), the stream of
  [07-server.md](docs/reference/07-server.md) and the handlers of
  [08-ui.md](docs/reference/08-ui.md) each sit under an anchor naming the union
  and what the table prints, and `tests/frame-tables.test.ts` reads the union
  out of `bus.ts` with tree-sitter and fails on a frame with no row, a row whose
  fields are not the member's, and a row for a frame the union does not have.
  `activity` and `reload`, the server's own frames, are owed a row in the two
  tables that carry them, and each file is held to its anchor's shape. 08-ui had
  no row for `sessions-changed`; it has one now. How the check reads both sides
  is in the [reference](docs/reference/README.md#the-frame-tables-mirror-watcherevent).
- **Every export has an importer, and every route is registered once** (DA-59).
  `noUnusedLocals` does not see an exported symbol, and Biome has no rule that
  does, so `tests/exports.test.ts` reads the imports and exports of every
  TypeScript file with tree-sitter and fails on an export no other file
  imports, naming the file, the line and the symbol. A name a barrel re-exports
  is held to that too, except in an entry point, and what the binary's
  generated entry or another track's code imports is kept by name with its
  reason. The sweep made 73 exports module-private — the 27 of the audit that
  were still unimported and 46 it did not name — then took 111 names nothing
  imported out of the barrels and 35 more exports their removal left without a
  user. `src/ui/index.ts`, a
  barrel nothing imported, is gone, and so are two types nothing used once
  private: `Connection` in `src/ui/live.ts`, a copy of the store's, and
  `WatcherEventType` in `src/core/watcher/bus.ts`. `GET /api/repos/branches` was
  registered twice, and Hono only ever ran the first; the second copy is gone,
  and `tests/server.test.ts` fails on a method and path registered twice. Both
  checks are described in the
  [reference](docs/reference/README.md#checks-that-read-the-code) and in
  [07-server.md](docs/reference/07-server.md).
- **The marks that carry a state without being text have a contrast check**
  (DA-56.2). The history mark, the select-mode tick and its unpicked `·`, and the
  focus ring are measured at WCAG 1.4.11's 3:1 in both themes, in a group of their
  own beside the text pairs. The coloured marks clear it at 4.7:1 or more, and
  the focus ring does since DA-56.7. `DESIGN.md` now says which dots are
  decoration — those beside a word that says the same — and that the dividers
  are.
- **The recovery paths of live update are tested** (DA-96). A `reload` frame
  reading the review again, the footer saying `reconnecting` while the browser
  retries and staying as it was once it has closed the stream, and the queue that
  puts a failed read in the toast and still applies the next frame — none of the
  three was reached by any suite, so dropping the `reload` listener left every
  one of them green. They are unit tests against a stubbed `EventSource`, shared
  with the other live tests; why not a browser spec is in
  [08-ui.md](docs/reference/08-ui.md).
- **The embedding model loads, and `model status` says where it is** (DA-33).
  `src/core/ml/embed` pins `multilingual-e5-small` in int8 ONNX, reads it from
  `$XDG_CACHE_HOME/diffalanche/models` (`~/.cache` without the variable), loads it once per
  process with `onnxruntime-node` and `@huggingface/tokenizers`, and embeds one text per run
  so that a text's vector never depends on what it was embedded with. The same vector comes
  out on Node and on Bun, and nothing in the load touches the network. `diffalanche model
  status [--json]` names the model, its revision and its cache directory, and says whether
  the files are there. Nothing embeds yet: the index, `suggest` and the delivery of the model
  to a user follow from [ADR-014](docs/adr/adr-014-embedding-model-and-npm-delivery.md), which
  the owner **accepted** as proposed. For
  development and CI, `bun run model:fetch` puts the pinned files in the cache and checks
  their SHA-256.

- **Global search finds definitions by name** (DA-39). A symbol index built with tree-sitter —
  `web-tree-sitter` over WASM, the grammars VS Code ships (ADR-015) — reads the functions,
  classes, methods and types of TypeScript, TSX, JavaScript, C#, Python, Go, Rust and Java in
  every repository of the review, in the background once the review is open, and again for
  the files each `diff-changed` names or the change set shows moved.
  `GET /api/search/symbols?q=` answers the twenty best by a fuzzy match of the name; the rows
  carry the `symbol` tag, the preview is the line that defines it, and `⏎` opens the file at the
  definition. `config.json` takes a `grammars` table for languages of its own.
  The npm package gains `dist/grammars/` (+0.96 MiB packed) and each binary about 10.6 MiB.

- **Global search finds text in the working trees** (DA-38). A query of two characters or more
  is also sent to `GET /api/search/text`, which runs `git grep` for it as a fixed string,
  without regard to case, over tracked and untracked files of every repository in the review —
  inside a task's scope — and answers a page of hits with the five lines on each side. The rows
  carry a `text` tag after the ranked ones, the preview shows the line between its neighbours,
  and `⏎` opens the file in browse mode at that line. At most three lines of a file are
  listed, 500 hits in all; git is stopped at the cap rather than read to the end.

- **An agent's `comment --line` anchors a line outside the change set** (DA-37.3), the way a
  human's comment from browse mode does: the anchor is read from the file itself — the working
  tree for `--side new`, the base for `--side old` — in the usual shape. A line the file does not
  have is still refused with `line-not-in-diff`, now naming how many lines it has. The owner's
  decision, recorded as an amendment to ADR-004.

- **A repository can be read outside its diff** (DA-37). The sidebar's `all files` tab lists
  every file of each repository of the review, the unchanged ones marked `unchanged`; one of
  those opens whole in place of the review — numbered from 1, read-only, with
  `not in this review`, and `working tree` / `base <sha>` segments — and so does the file of
  any card through its new `Browse repo` button, `B`, or a `file · unchanged` hit in global
  search. `← back to review` and `B` return to the exact place the reading was: the review is
  folded away while browsing, not unmounted. A comment can be left on a line there and lands
  in the same session with its path; its anchor is captured from the file itself in the same
  `{ lineContent, hunk, before, after }` shape, `hunk` being the header of the context window.
- **`↑ N lines` brings in real context.** A hunk header's new control puts the working tree's
  lines above the hunk into the diff, twenty at a time, up to the hunk above; `collapse context`
  hides them with the bundled context.
- **`GET /api/repos/:repo/tree` and `GET /api/repos/:repo/file?path=&rev=`** answer what browse
  mode and the context read: every file with where it exists, the base revision and the working
  tree merged, and one file whole. Both stay inside the task's scope, and the file route reads
  only a path git lists — never an ignored file, `.git`, or a path stepping outside, and a link
  as its target without following it.

- **The check-run names branch protection must list are compared with the jobs that report
  them** (DA-111). `tests/ci-names.test.ts` expands the real names out of `ci.yml` — a job
  reports under its `name:` when it has one and under its id otherwise, and a matrix job
  reports one check per cell — and holds them against the list in the workflow's header
  comment, in both directions. A renamed job used to leave that list promising a name no run
  reports, which reads as a pull request stuck at "Expected — waiting for status". The
  `windows-latest` cells stay out of the required list until DA-45, and the test says so.

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

- **A severity the model chose no longer votes in later suggestions** (DA-36.2).
  A comment sent with `AUTO` stored its neighbours' vote as its severity, and the
  embedding index kept the severity without who chose it, so the next similar
  text counted that label like any other: a history written with `AUTO` left on
  confirmed itself. Each index entry now carries the comment's `severitySource`,
  and a neighbour whose source is `auto` is listed among the five but left out of
  the vote — the 0.86 line and the weights start at the nearest one that votes.
  `manual` and `confirmed:<author>` vote as before, and an agent's
  `reply --confirm-severity` reaches the index at its next update without an
  embedding. `suggest --json` and `GET /api/suggest` carry `severitySource` on
  every suggestion. An index written before reads each entry as `manual` and its
  sessions again at the next update, which takes every source from
  `comments.json` and embeds nothing.

- **The focus ring can be seen** (DA-56.7). Every ring was `--accBd`, 1.6–2.0:1
  against the grounds it is drawn on — under the 3:1 WCAG 1.4.11 asks of the
  only signal of focus — and it showed nothing on a control whose resting border
  is already `accBd`. The ring is now `acc`, 3.94:1 at the tightest of the seven
  colours it sits next to, including a chosen segment and a chosen file.
  `--accBd` keeps the edges and takes a lighter value, `#6c79b7` dark and
  `#6977ba` light (the handoff's hue and saturation), so the frame of a thread in
  play, an agent's reply, an active chip, the highlighted search hit and a hunk
  that just changed clears 3:1 against its wash as well. `tokens.css`,
  `DESIGN.md` and `.impeccable/design.json` change together, and
  `tests/design-contrast.test.ts` holds both. The chosen severity chip of the
  composer had no ring at all: `.sev-chip.on` cleared the border the focus rule
  had just set, at the same specificity and later in the file.

- **The server holds one built review document per session** (DA-24.1), instead
  of one at a time. The first build of a session is paid once and a switch back
  to it is answered from memory: `POST /api/sessions/:name/use` now invalidates
  nothing, because moving `current` changes which document a request without
  `?review=` resolves to and not what any document says, and every other write
  names the session it changed. Four documents are held at a time — each one is
  megabytes — and the least recently asked-for is dropped. **A comment, a reply,
  a resolve and a reopen now re-read the comments of that session alone** rather
  than dropping its document: a comment does not move the working tree, and on a
  task the watcher does not follow rebuilding meant reading every repository of
  the scope for every write. The perf gate's
  **Switching review sessions** line loses its `pendingUntil` and becomes the
  budget of a return visit: the harness makes the first, cold switch of a
  session before the measured pair and prints it, so the path no budget covers
  is named rather than warmed away.

- **The CPU-per-frame gate is set on what the machine reaches, and 120 fps stays
  the goal** (DA-56.4). `Scrolling the diff: CPU per frame` was budgeted at
  8.3 ms, the frame of 120 fps, and measured 8.5–9.1 ms over nine commits of the
  main branch on a quiet machine — with no trend and no commit of that range
  responsible, including the one that predates the whole DA-53…56 package. A
  budget no commit meets gates nothing, so the gate now enforces 9.5 ms: about
  four percent over the worst reading taken where the load precondition lets it
  answer at all, which still catches a regression the size the line was written
  for. `RUNNER_ALLOWANCE` was recomputed from 2.5 to 2.1 in the same pass: it is
  a ratio to what a runner measured, so a budget moving without it would have
  carried the CI ceiling from 20.8 to 23.8 against an unchanged 17.3 and turned
  fifteen percent of headroom into thirty-eight. The multiplier is tuned to this
  one row, the tightest, and the other six get whatever it produces — so moving
  any other millisecond budget does not touch it. `docs/SPEC.md` section 6 keeps 8.3 ms as the target with the measured
  number and its date beside it, and closing the gap is DA-56.5.
- **The shell's two screenshots mask the sidebar footer** (DA-54.2). The footer
  prints `127.0.0.1:<port>`, so the free port above moved four digits of
  monospace text and both baselines failed on 33 pixels of 1.4 million — a
  regression of the suite introduced by the fix beside it, which no run on
  Linux could see. Masked for the reason
  `/api/activity` is stubbed in the same file: a baseline may only carry what
  does not vary. The footer's text stays covered by direct assertions in six
  specs, `shell.spec.ts` among them.
- **The UI suite asks the operating system for its port** (DA-54.2). It held a
  fixed 4881 with `reuseExistingServer` off, which is right for one person
  running it by hand and wrong for a gate: two workers on one machine could not
  both pass it, the second getting `port is already used` and a red gate with
  nothing behind it. A worktree per worker separates `dist/`; the loopback
  interface belongs to the machine. It now binds port 0 in a child process the
  way `e2e/acceptance.config.ts` does, pins the number in `DIFFALANCHE_UI_PORT`
  for the workers Playwright forks, and passes it to `e2e/server.ts`.
- **The Playwright UI suite runs in a gate and in CI** (DA-54.2). Its
  ninety-five tests — the sidebar, the thread rail, live update, the repository
  bar — ran only when somebody typed `bun run test:ui`, so a UI regression
  reached the main branch through six green gates and a green CI. It is now the
  sixth entry of `gates` in `backslop.json`, between `bun run test:bun` and
  `bun run perf` so the two browser gates are adjacent, and the `ui` job of CI
  runs it too. The collision the two Playwright configurations document is handled
  structurally: each worker has its own worktree and therefore its own `dist/`,
  `backslop gates` runs its commands one after another, `test:e2e` is not among
  them, and in CI the two are separate jobs on separate runners. The command
  costs 71–78 seconds, which is the UI build, the fixture, the server and the
  tests together.
- **Off CI the perf gate declines to answer on a busy machine instead of
  answering wrongly** (DA-54.3, [ADR-013](docs/adr/adr-013-perf-gate-off-ci.md)).
  `bun run perf` holds a development machine to the specification's numbers, and
  under load those numbers are the machine's: taking the whole subject of a task
  out of the code did not make the gate pass, and across paired runs the sign of
  the difference flipped both ways. The gate now reads the one-minute load
  average per core at both ends of the run and, above 2.5 per core, prints
  `unable to measure` with the load named and exits 1 without a budget verdict —
  before the run, without measuring at all. On a GitHub-hosted runner it is off:
  a runner's load is nobody's to control, `RUNNER_ALLOWANCE` stands in for it
  there, and the `perf` job's own fixture generation would otherwise trip the
  check on four cores. A red `bun run perf` is therefore one
  of three things and the output says which: `over budget`, `not measured`, or
  `unable to measure`. `DIFFALANCHE_PERF_IGNORE_LOAD=1` measures anyway and
  prints **Not evidence.** with the load above the table; a bypass invisible in
  the output would be the development allowance the ADR rejected, renamed. The
  threshold comes from fifteen runs on one machine and is recorded with them.
- **Either side panel comes off the screen, and a long line wraps** (DA-107).
  `[` hides the sidebar and `]` the thread rail — whole, not narrowed and not
  into a drawer — and so do the `‹` and `›` in each panel's own top row; while a
  panel is gone the header carries the stub that brings it back. The floor of
  the page follows what is left on it: 1560 px with both panels, 1252 without
  the sidebar, 1168 without the rail, 860 with neither, so a window narrower
  than 1560 px stops scrolling sideways once the panels it cannot fit are gone.
  A line longer than its code column now **wraps by default**, and a file card
  owns no horizontal scroll; the header's `wrap` / `scroll` toggle, in the form
  of the theme's, gives back the columns aligned character by character. Both
  panels and the toggle are kept in `localStorage` the way the theme is. The
  height a card claims before its diff is mounted counts wrapped rows from the
  width of the code column in characters, recomputed when a panel is hidden and
  when the window is resized and measured against no DOM at all.
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

- **The suites' live-stream helpers close the connection, not only the body**
  (DA-60.3). Under Bun, cancelling a response body left the connection open and
  the server counting the window among the followed tasks, which a test that
  needs the server to see a window go away could pick by accident. `listen` of
  `tests/server.test.ts` and `read` of `tests/events.test.ts` now make the
  request themselves and abort it in `close()`, and a verdict of
  `tests/events.test.ts` holds the server to seeing that close
  ([11-perf.md](docs/reference/11-perf.md#waits-in-the-suites)).

- **A window just opened on a task hears the first write into it** (DA-55.8). The
  watcher follows a task from the first burst of the data directory after its
  window's stream opens, and took that burst's read as the task's baseline, so
  when the burst was the write itself — an agent's `review comment` into the
  task it had just printed a link to, a `review base` or `review scope` from a
  terminal — no `comment-added` or `session-changed` went out and the window
  showed the write only after a reload. The server now hands the watcher each
  review document it serves, and the burst that starts following a task compares
  with the oldest document served of it since: a write since is a frame, what the
  document already had is not, nor a comment outside its scope. What was served
  goes once a burst follows the task, when the task leaves the followed set, when
  the last window on it closes — a burst or none — and when it is gone. A stream that reconnects with no document served
  since is baselined in silence, as before
  ([05-watcher.md](docs/reference/05-watcher.md#events)).

- **Browse mode follows the working tree, a drag re-renders less, and a thread
  outside the hunks is reached** (DA-37.1). The browsed file is read again, in
  place, when an edit changes its patch; the rows are memoised in blocks of 200,
  so a drag step on a 15 000-line file spends 1.3 ms in script instead of 14.4;
  and a thread on a line of a changed file that no
  hunk shows opens that file in browse mode at its line instead of staying in
  the rail alone.
- **A window on a task deleted elsewhere goes to `current`** (DA-40.1). A task
  deleted by the CLI or by another window left a window that was showing it by
  `?review=` on the failure screen. It now goes where `current` points, as the
  window that deleted it does, with the server's sentence in the toast, and
  `Back` does not lead back to the task. An address whose name never opened
  keeps its screen and its way back. A press on the task's row in a menu that
  was open while it went lands on that screen, without the `?review=` toast, and
  the row stays in an open menu until it is opened again (DA-40.2).
- **A stream the browser has closed says `disconnected`, with a way back** (DA-96.1).
  When the browser stopped retrying the live stream, the sidebar footer kept the
  living dot and `watching` while no frame would arrive again. It now says
  `disconnected` with a still `crit` dot and ends in `reconnect`, which makes a
  new stream and reads the review again once it is open, since a new stream has
  nothing to replay the missed frames by.
- **The comment form says the row the arrows chose, and the model going away**
  (DA-36.1). The chosen suggestion was marked only by `aria-current` on a row
  that never takes the focus, so a screen reader heard nothing as `↑` / `↓`
  moved; the 503 sentence and `AUTO` going out of reach, with `WARNING` then
  what `⌘⏎` sends, were shown and not said. A live region in the form now says
  each of them once, and not every answer that arrives while the reader types.
- **A long toast stays long enough to be read** (DA-102.1). A refusal the
  server or the store puts in the toast is a sentence written for the CLI —
  DA-102's storage refusal is 116 characters — and it had the same 2.2 seconds
  as `Markdown скопирован`. A toast of up to 60 characters, every answer the
  handoff draws, still lives 2.2 s; each character past that adds 50 ms, up to
  10 s, so that refusal now stays 5 s.
- **A thread on the old side sits under the deleted line it names** (DA-37.2).
  The file card grouped threads by line number alone, so a comment written with
  `comment --side old` on a deleted line sat under the new-side line of the same
  number, or nowhere. A deleted line is now a row of its own: its widget is in
  the old side's half, across the diff as a new side's strip is, and its bar is
  on the old side's gutter. A thread on the old side of a context line sits
  where one on its new side would.
- **The keyboard stops draw the system's focus ring** (DA-56.8). The file
  card's collapse caret and the base picker's `ref` field drew the browser's own
  ring, the two hunk controls and global search's `ещё совпадения` still drew
  `accBd`, an overlay opened from a key drew the browser's ring on its panel,
  and the search field drew none. All of them are `acc` now, and
  `e2e/focus.spec.ts` walks the page, the overlays in each of their states, the
  forms, the menu, select mode, browse mode and the empty screens in both
  themes; what it cannot reach in its fixture is listed in `08-ui.md`.

- **A `comments.json` the embedding index may not `stat` is a warning, not a raw
  errno** (DA-99.3). The index fingerprints every session's `comments.json` with
  a `stat` of its own, which rethrew anything but `ENOENT`; the listing reads
  only `review.json`, so a `comments.json` that is a link into a directory nobody
  may enter, or through a file, stopped `suggest` and `index rebuild` at exit
  code 2.
  The `stat` now goes through storage's `readError`, and such a session is read
  and kept as a broken `comments.json` is: named in the update's warnings —
  `could not be read: permission denied` — with what was indexed of it kept.

- **A task opened again by name shows what a terminal wrote to it while no window
  was on it** (DA-55.7). The server keeps the document of a task after its window
  closes, and the watcher reads the files of the tasks it follows only, so a
  `review comment`, `reply`, `resolve`, or a base or scope change written from a
  terminal into such a task was missing from the next window on `?review=`, and
  from the window on `current` once `current` moved to it. Every change the watcher
  sees in the data directory now marks every held document, and the next read of
  one reads its task's `review.json` and `comments.json` again: a moved base or
  scope builds it again, anything else is patched in, and a burst about another
  task leaves it and its bytes alone — 1.2–1.3 ms against 0.22–0.24 ms for a held
  document on the synthetic review, on a busy machine. The fetch a live update
  makes for a repository of `current` reads neither file. Two narrower corners of
  a move of `current` closed with it: a build of the task started during the
  move's read now takes a rescan that landed after the move, where it was kept
  without it; and the first rescan of each repository after a move reports the
  repository whatever it finds, so a revert the move's read took in drops the
  documents other tasks hold of the edit it undid. A rescan that landed while a
  held document's files were read is no longer undone by that read, nor a later
  re-read by an earlier one that lands last
  ([07-server.md](docs/reference/07-server.md#keeping-a-held-document-honest)).

- **`config.json` and the listing of `reviews/` word a refused read as the session
  files do** (DA-99.2). A file where the data directory should be, or where
  `reviews/` should be, reached `review list` as a raw `ENOTDIR` stack at exit
  code 2. The configuration now reads `config.json`, and the user config, through
  storage's `readError` and its table — `…/config.json: could not be read: a file
  is in the way of one of its parents` — and the listing takes the same table
  with its own `ENOTDIR`, `…/reviews: could not be read: a file is where a
  directory should be`; both are one line at exit code 1, and `EISDIR` is still
  left to exit code 2 ([03-storage.md](docs/reference/03-storage.md)).

- **The suites stopped holding numbers the machine decides** (DA-60). A wait is
  now a condition with a generous deadline, an order the platform guarantees, a
  duration the test makes itself, or — for a party it cannot see — a wait derived
  from the same thing timed in the same run; the rule, and which assertion owns
  which budget number, are in [11-perf.md](docs/reference/11-perf.md#waits-in-the-suites).
  Among what that changed: the watcher's budget is held on each edit less a rescan
  timed beside it, not against one baseline taken twenty seconds later; the live
  stream's head is held under the heartbeat it guards against rather than under
  1 s; the file jump in `sidebar.spec.ts` asserts one frame and leaves the 50 ms
  to the gate, under a name that says so; a reply written by the CLI is held to
  arriving at all, and its latency, which no budget of section 6 owns, is
  printed instead of held under 5 s; the perf harness waits for the restore of
  its probe line to be painted instead of 500 ms; `events.test.ts` arms its
  repository watch before
  the first edit; the history, thread, repository-bar, live and toast specs wait
  on frames, unmounts, timer order and Playwright's clock instead of fixed
  pauses. The smoke script's busy-port retry matches the sentence `serve` prints
  for a taken port — it could never fire before — and a test holds the two
  together. The tests that start a `.ts` file as a process skip on a Node older
  than 22.18 instead of failing. The two shell screenshots declare macOS and skip
  elsewhere, so `test:ui:ci` and its `--ignore-snapshots` are gone and the `ui` job
  runs `bun run test:ui`. Vitest's timeouts are 60 s per test and 120 s per hook.

- **A task made current while the server runs is read before it is served from
  its cache** (DA-55.6). `review use` moved `current`, and the watcher followed
  the new task at once — so its `diff.json`, last written when it was last
  followed or last opened by name, was trusted as it stood, and a repository that
  had moved in between showed its old diff until a file in it was touched again.
  The watcher now reads the task it moves to from the working tree, the read
  DA-55.5 does at startup, and follows it and says `current-changed` only after
  that: the window that re-reads on the frame gets what the read handed over, and
  a window on the task by name is told which repositories moved since its cache.
  What the task is — base, scope, title, status — is taken before the read, so a
  change to it made meanwhile is still announced; a task with no `diff.json` is
  not read, which keeps the first task a window creates from paying for a second
  read. The cost is the scope's repositories on every move of `current` to a task
  with a cache, before the frame: on the synthetic review with no scope, 570–602 ms
  from the write to the frame against 115–117 ms before; and since the read holds
  the watcher's queue, an edit made just after `review use` reached its frame in
  433–520 ms against 204–209 ms, over the 300 ms of section 6 for as long as the
  read lasts — both measured on a busy machine
  ([07-server.md](docs/reference/07-server.md)).

- **An overlay whose opener cannot take the focus back gives it to the header's
  control for the same overlay** (DA-100.1). The restore checked `isConnected`,
  which a disabled control passes, and did nothing at all when the check failed:
  the ring ended on `<body>` and nothing said so. It now asks the document whether
  the opener took the ring, falls back to the `BASE` pill, the `SCOPE` pill,
  search or `Export`, and writes a `console.warn` when none of them can take it
  either. See [08-ui.md](docs/reference/08-ui.md).
- **Creating a task from select mode, or changing the base from the no-changes
  screen, leaves the focus on the header** (DA-100.2). Both close their overlay
  before the review they asked for arrives, so the focus went back to the opener
  and the arriving review then disabled it or took it off the screen, and the
  focus fell to the page. The restore now waits while a switch is under way and
  lands on the new task's `SCOPE` pill or the `BASE` pill; a reader who moved the
  focus during the wait keeps it where they put it.
- **A type change with one half omitted is drawn in the two columns it is sized
  for** (DA-76.2). Such an entry is `modified` with one patch left, which the
  library parsed as `add` and drew in one column while the card sized itself as
  two, so a wrapped line would have been counted at half its real width.
  `mergedPatch` now takes the entry's status and asks the same `oneColumn()` the
  sizing does. See [08-ui.md](docs/reference/08-ui.md).

- **Five minor defects of the change set, the watcher and storage** (DA-114).
  `parseDiff` returns `{ files, notes }`, so the warning about the half of a type
  change it could not list can no longer be dropped by a caller that leaves an
  argument out (DA-76.3). A session that walks its trees from the start — no
  recursive watch on the runtime, or `watch` refused — now says so once on
  stderr through the watcher's new `onWalk`, as a watch that dies later already
  did; `recursive: false` stays silent, because the walk was asked for (DA-85.1).
  The cost of one repository read is five git processes in every comment and
  reference section that names it (DA-61.1). `reply`, `resolve` and `reopen` take
  the scope inside the session lock, so a scope widened while they waited no
  longer refuses a thread already in it (DA-67.1). A file written over a session
  directory is a one-line refusal at exit code 1 —
  `…/review.json: could not be read: a file is in the way of one of its
  parents` — instead of a raw `ENOTDIR` stack at exit code 2; reads word
  `EACCES`, `EPERM` and `ENOTDIR`, and `EISDIR` is left to exit code 2 (DA-99.1).

- **A server no longer opens on the change set its previous run left** (DA-55.5).
  The server trusts `diff.json` of the session the watcher follows, because the
  watcher keeps it fresh — but only while a server runs. Code edited, committed or
  switched while `serve` was stopped left a cache whose base and scope still
  matched, and the first document came out of it: the review showed the previous
  run's diff until a file in that repository was touched again. `serve` now has
  the watcher read the current session's scope once from the working tree before
  the socket opens — queued like a rescan, so an edit made meanwhile is read after
  it — and builds the first document from that. The cost is the scope's
  repositories on every start; a task over two repositories of twenty-one reads
  two.

- **A line comment no longer drops the warning of a linked worktree** (DA-80).
  Patching one repository into `diff.json` was written twice — once for the
  CLI's line comment, once for the watcher's rescan — and the CLI's copy rebuilt
  the repository's warnings from the fresh read alone, which cannot say
  `worktree of <main>`: after a comment on a line of a linked worktree the review
  stopped reporting it until the next full scan. Both writers now go through one
  patch, `replaceRepository`, which puts the repository's share of the new
  `rootWarnings` of `diff.json` back — the warnings the walk of the root and the
  scope produced, kept apart for this. A cache written before the field existed
  is still read as it is — the sessions list keeps its counters — and the next
  patch of one repository into it becomes a scan of the whole scope instead,
  which writes the field; `SCHEMA_VERSION` stays at 2, so `review.json` and
  `comments.json` are untouched. Every list of the cache
  is now sorted where the cache is built, so the CLI's patch can no longer write
  warnings in an order that reads downstream as a new set and brings back a
  warnings bar the reader dismissed.

- **A window on any task now hears about that task's comments** (DA-55.1). The
  watcher followed one session — the current one — so `comment-added`,
  `reply-added` and `comment-status` never named a thread of a task opened with
  `?review=`, and an agent's answer in it reached the screen only on the next
  reload. It now follows the tasks windows are actually open on: the live stream
  carries `?review=` so the server knows which those are, and a session entering
  the set is snapshotted **without announcing anything**, or a window opening on
  a task with history would be told its whole history is new. The cost is bounded
  by open windows rather than by sessions in the data directory, and
  `review.json` costs nothing extra — the session listing already read every one
  of them each burst, and that single read now serves both. A burst whose listing
  of `reviews/` fails still reads and compares the followed sessions one by one,
  so a change that lands in it is announced rather than silently absorbed into
  the next baseline.
- **A window with no `?review=` follows `current` again, and one with an address
  does not** (DA-68). `session-changed` meant two different things under one
  name — the pointer moved, or a task's own base, scope, title or status changed
  — and a window could not tell which had happened. They are now two frames,
  `current-changed` and `session-changed`, so a window without an address
  follows the pointer it also writes through, a window on a task of its own
  ignores it, and neither re-reads the whole review because some other watched
  task changed. `POST /api/sessions/:name/use` therefore invalidates nothing at
  all: the pointer moving drops no document.
- **A window no longer reacts to another task's events, or applies another
  task's data** (DA-68). The three comment frames carry the session their thread
  belongs to and the page drops what is not its own — before this it fetched the
  thread, got a 404 and raised a toast for somebody else's write. `loadReview`
  carries a generation checked after every await, so a response for a task the
  window has left is dropped rather than applied; that covers the callers
  `switching` does not gate. `applyRepositoryDiff` takes the session its patch
  was fetched for: a repository unknown to the review on screen used to be
  *appended*, so another task's change set arrived whole, against another base,
  with the composer usable on its lines. Switching a task also reopens the
  stream, because an open `EventSource` keeps the address it was made with.
- **The scope editor picks from its own task** (DA-77). Its candidate list is the
  whole root, as it must be — the editor offers what the task is not about yet —
  but it was read against the **current** session's base while being written into
  the window's own task. A window on a task with another base was offered files
  that task will never show, and not offered files it does. The route now takes
  `?review=` like every other read of the page.

- **A rescan the server was told about before it reached disk is no longer
  dropped** (DA-75). `adopt` returned without doing anything whenever the
  document was cold — which is what every write through the API leaves behind,
  and what the whole duration of a build is — while the watcher announces a
  rescan *before* it writes `diff.json`, so that a person does not wait for a
  file of megabytes. In that window a build could read the pre-edit file and
  cache it with nothing to invalidate it, and the card of the edited file kept
  the diff of a moment ago. `adopt` now records the change set on that session
  whether or not a document is held for it to patch, and answers which of the
  two happened rather than failing silently; a build that started before the
  rescan takes the recorded change set on its way out instead of installing
  what it read; the recorded cache belongs to the followed session alone, and is
  dropped rather than served once `current` has moved on. The `warnings` event
  no longer forces a re-read: it rides on the rescan the document already has.

- **A window opened on a named task shows the change set it was opened to see**
  (DA-55.3). `GET /api/review?review=<name>` trusted `diff.json` whenever its
  base and scope still matched the session's — and they match after an edit,
  because only the code changed. The watcher rewrites that file for one session,
  the current one, so a task that is not current held a change set frozen at the
  moment it was last read, and a reload showed the diff of the previous visit.
  **A cache that matches on base and scope answers the same question; it does
  not thereby hold the current answer**, and the only thing that refreshes one
  is the watcher. So the server trusts `diff.json` for the session the watcher
  follows and reads the working tree for every other one — the scope's
  repositories rather than the root's — and writes that read back, so anchor
  capture sees what the screen sees. A document built that way is **held only
  until a repository it could show changes**: the watcher reports a repository
  that moved whatever the current task is about — its change set when the
  repository is inside the followed task's scope, its files when it is outside —
  and the server drops the documents that change could appear in. **The other
  half is closed by DA-55.1 in this same release:** a change to a named task's
  own `review.json` — `review base --review X` from a terminal — used to be
  signalled to nobody, so a window on X kept the base it was opened with. The
  watcher now follows every task a window is open on, so `session-changed`
  arrives naming X and that document is dropped.

- **A file that changed type is one entry again, carrying both halves** (DA-76.1).
  Git cannot write a tracked file becoming a symbolic link as one patch, so it
  writes two for the one path, and the de-duplication of DA-76 never saw them:
  both come from the diff itself. The counters doubled the path, the card and the
  sidebar row repeated a React key, and a comment on the new side of the link
  anchored against the deletion. The pair is now one entry with **both** patches
  and both hunk lists, status `modified` — the path is on both sides of the
  change, so neither `deleted` nor `added` is true of it — and the reviewer keeps
  what they came for: the content that left and the link that arrived. Only a
  deletion beside an addition on one path is joined; any other repeat stays two
  entries where it can be seen. Where one half is listed without content — a
  binary file or one over the size limit, replaced by a link — the patch comes
  from the half that has one and the skipped side is named in the repository's
  warnings, because an entry that took the omission for the whole would hide the
  link it exists to show. The UI's patch readers learned the same qualification —
  a `diff --git` line ends a patch, so the second one's header stopped being
  counted as diff rows.
- **"This file was not written" is asserted by the time of the write** (DA-88.1).
  A byte comparison cannot see a rewrite that puts the same bytes back, which is
  exactly what a rescan of an unchanged repository does, so the checks named
  after the invariant could not fail. `tests/helpers/untouched.ts` is now the one
  way the suite says it — the mtime stamped back before the command and asserted
  after it, with the bytes beside it — and the four places that asserted it by
  content alone use it.
- **Two writes that skipped the session's lock now take it** (DA-67). A comment
  checked the scope before the lock and wrote inside it, so a `review scope set`
  narrowing in between left a comment on a path the scope no longer had — stored,
  refused by `get`, `reply`, `resolve` and `reopen`, absent from `list`, and
  announced as written on exit 0. `addComment` now checks the scope inside the
  lock against the metadata read there, and that refusal has a message of its
  own — a scope that narrowed under a comment being written is a different fact
  from a comment that was outside the task all along, and the same
  `out-of-scope` code would not have said which. The anchor capture stays
  outside the lock, so a comment write does not hold the session for a parse of
  `diff.json`. And
  `diffalanche diff` wrote `diff.json` bare where the other five writers take the
  lock first: a watcher that read the cache before that write and patched one
  repository into it afterwards dropped everything the scan had found for the
  rest, and the cache answered for the same base and scope, so the server served
  it stale until an fs event fired.
- **The generator claims its stamp before it writes anything** (DA-69). It wrote
  `synth.json` last, so `bun run perf` interrupted inside `synth` left the
  fixture directory non-empty and unstamped — and the erase guard, which now
  reads that stamp, then refused every later run instead of regenerating a
  directory the gate had created itself. The stamp is written immediately after
  the directory is made, carrying the generator, the seed and the profile, and
  rewritten whole at the end with the session and its counts. A stamp without
  the counts is a run that did not finish: `fixtureDrift` says so and the gate
  regenerates, which is what the guard is supposed to allow.
- **The release no longer ships its checksums manifest inside the npm package**
  (DA-106). The checksums step wrote `SHA256SUMS.txt` into `dist/`, and the same
  job publishes to npm from that tree with no rebuild in between: `files` in
  `package.json` excludes the binaries and not the manifest, so every tarball
  carried a six-line list of platform binaries it does not contain. The manifest
  now goes to `$RUNNER_TEMP` and the release uploads it from there under the
  same name, which keeps `dist/` exactly what the npm channel ships instead of
  adding a second exclusion to keep in sync. Both checks the step exists for —
  the six-line count and the `sha256sum -c` re-read from inside `dist/` — are
  unchanged. `bun run check:package` runs `npm pack --dry-run --json` and
  refuses anything under `dist/` that is not `dist/cli.js` or under `dist/ui/`;
  the `check` job of CI runs it, so a stray file stops a merge and not a tag.
- **The step in the update budget is real, and it arrived with the DA-53…56
  package** (DA-56.3, folding in DA-55.2). The deferred measurement was taken on
  2026-09-21 in a quiet window, three trees alternating under one lock:
  `1193ab3`, before the package, measured 244 ms and 267 ms inside the 300 ms
  budget; `ed81928`, after it, measured 352 ms and 392 ms outside it. DA-55.2
  suspected the step and could not prove it because the two sides were never
  measured beside each other; they now have been. Which of the package's tasks
  carries it is not settled here. The same window found `Scrolling the diff: CPU
  per frame` over budget on all three trees at rest, `1193ab3` included, which
  makes it attributable to no task of this wave (DA-56.4), and the long-task
  count flipping its verdict with the machine rather than the code (DA-69.1).
- **The perf gate no longer reports green on what it did not measure** (DA-69).
  Two ways it could. The freshness check was the existence of
  `.diffalanche/current`, and `current` exists whatever it points at — the
  harness's own scratch session made it point at itself, and one killed run left
  the fixture measuring a fifth of the specified comment load for ever. The
  generator now stamps `synth.json` with what it wrote, the gate reads it back —
  the profile, the session `current` names, the thread and reply counts — prints
  why they differ and regenerates; the scratch session is called `perf-scratch`,
  a name that cannot compose with itself, and is rebuilt when it does not hold
  what the run would write. And a line whose samples cannot be trusted said
  `ok`, because `NaN > 500` and `0 > 8.3` are both false: it is now a third
  verdict, `UNMEASURED`, which prints and exits 1, and a missing `TaskDuration`
  throws where it can be named instead of standing in as a CPU-per-frame of 0.
- **The perf gate asks what it is about to erase** (DA-63). `--fixture` names a
  directory the gate owns and empties, and the guard that makes that safe lived
  in `scripts/synth.ts` — the process the gate spawns *after* deleting, so it
  never saw the path. The gate now asks first: an existing path is accepted only
  when it is an empty directory or one carrying a `synth.json` this generator
  wrote — **not** a `.diffalanche/`, which is what the tool writes into any
  folder somebody reviews and so is the mark of the thing the guard protects —
  and the repository, every directory above it and the home directory are
  refused whatever they contain. `bun run perf -- --fixture .` from the
  repository root would have taken the working tree and its `.git`; it now exits
  1 with the path named and nothing deleted.
- **A live patch that lands late no longer costs the reader their place**
  (DA-55.4). The scroll anchoring waited one frame and then measured; a store
  write only schedules React's work, and under load React could land it after
  that frame, so the measurement read a DOM without the patch, found nothing to
  correct, and let the whole growth arrive unannounced. The anchor is watched
  until the patch is really on the page — a move ends the wait, and so does the
  page's own height changing, which is what tells a landed patch from one that
  has not landed yet; a reader who scrolls during the wait ends it untouched.
  `window.__perf.settles` is the record the mechanism was caught with and it
  stays, so the next occurrence is readable instead of guessed at.
- **A refused write no longer deletes an agent's reply that arrived while it was
  in flight** (DA-93). The rollback restored the thread as the write had found
  it, and a `reply-added` frame in the meantime had already replaced that thread
  with the server's own read: the agent's answer left the rail, the counters and
  `awaiting`, while the toast talked about the reader's own failed reply. A
  write now notices that a live frame overtook it and keeps what the frame
  brought — there is nothing left to undo, because the frame took the optimistic
  draft with it. Nothing was ever lost on disk; what was wrong was the screen.
- **`Reply` opens one field, in the copy of the thread it was pressed on**
  (DA-94). A thread is on screen twice on purpose — under the line it is
  anchored to and in the rail — and both copies drew the reply field and both
  textareas focused themselves as they mounted. The rail's came later in the
  tree and won, so pressing `Reply` under the line sent the caret and the scroll
  to the right column while the field under the line sat open and inert, and a
  screen reader found two controls labelled `reply` for one thread. The store
  remembers which copy was pressed; a thread with no widget still opens its
  field in the rail.
- **A toast repeated gets its full 2.2 seconds** (DA-105). The lifetime was
  counted from the first time that exact string was set: a repeat compared equal
  under `Object.is`, so the component never re-rendered, the timer never
  restarted, and the answer to the second press lived out whatever was left of
  the first — which is exactly when a reader repeats an action, because they did
  not see the answer. A toast is now a message and the raise that made it, and
  every site that sets one goes through the same call.
- **One `esc` closes one thing, and one overlay is on screen at a time**
  (DA-70). The ladder is a list in `src/ui/overlays.ts` that the keyboard asks;
  before it, two hand-written lists of overlay flags in `keys.ts` both missed
  the scope surface, so `esc` over the scope editor closed the editor **and**
  threw away the comment being written underneath it, and `c` under the open
  editor opened a composer on the file behind. `⌘K` and `⇧⇧` over an overlay
  that is not the palette are refused rather than stacked: two overlays trap the
  ring in two places and answer one press twice. Adding an overlay is a row in
  that list and no edit to the keyboard.
- **The focus goes back to what opened the ladder, not to what a swap replaced**
  (DA-100). The scope editor, its confirmation and the new-task form take one
  position in the tree, so each swap used to record the button it was replacing
  and the last one to close restored a node detached two commits earlier —
  leaving the reader with no ring and the next `Tab` starting from the top of
  the page. The opener is recorded once per ladder and given back when the
  ladder has emptied.
- **A warning found after the bar was dismissed is shown again** (DA-79). The
  rule was a property of the live frame and is now a property of the state: one
  writer of the field, which the stream's `warnings` frame and the review
  re-read both go through. `Apply` on the base picker and on the scope editor
  read the whole review again and leave the session's name where it was, so a
  base that stopped resolving in one repository used to put that repository's
  warning in the document and show nothing at all — the reader went on reviewing
  against a base that had silently fallen back. An identical list still changes
  nothing, so an ordinary re-read does not bring the bar back.
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

- **A reviewed repository no longer runs commands on the reviewer's machine**
  (DA-61, [ADR-012](docs/adr/adr-012-git-trust-model.md)). `core.fsmonitor`,
  `diff.<driver>.textconv` and `filter.<driver>.clean` in a repository's own
  `.git/config` each named a program git ran during a plain scan, with the
  reviewer's privileges and no click in the path. Every git process the reader
  starts now carries `--no-pager` and a list of `-c` pins over the keys that
  name a program; the keys whose name the repository chooses — a diff, filter or
  merge driver, `filter.<driver>.required` included — are read from it with
  `config --list` and pinned to nothing, and the diff also carries
  `--no-textconv`. A repository whose configuration cannot be read is not read at
  all: it comes back with no base, no files, and the warning `repository
  configuration could not be read`. A repository with a filter driver — git-lfs
  is the common one — is shown the content that is on disk rather than what the
  driver would make of it.
- **A scan the first-run screen could not read says so** (DA-98). `loadScan`
  dropped a refusal with a bare `return`, and the screen's three metrics stayed
  dashes — the same thing they show before anything has been asked. The store
  now keeps why the scan was refused, and the screen carries the server's own
  sentence under the metrics with a retry beside it.
- **A scan no longer starts one git process per repository all at once**
  (DA-98). `scanReview` and the server's scan and candidate routes each mapped
  over every repository under the root with an unbounded `Promise.all`, so the
  number of git processes in flight was decided by the folder rather than by the
  code. All three now go through `mapWithLimit` with `SCAN_CONCURRENCY` of 8,
  chosen by measurement on the synthetic review: the curve flattens past six and
  unbounded is no faster than eight. The peak is asserted in processes, not
  seconds — 23 with the bound where it was 50 without.
- **A file untracked with `git rm --cached` is listed once** (DA-76). The diff
  reported the deletion the index made and `ls-files` reported the file still on
  disk, both correctly, and the change set carried the path twice: the counters
  doubled it, the UI rendered two cards under one React key, and a comment on it
  could not be anchored, because the lookup takes the first match and that entry
  had no new-side lines. The change set keeps the deletion — what the change
  actually is — and the file being still on disk is a warning.
- **An added or deleted binary file is no longer reported as modified** (DA-95).
  A patch git writes without `---`/`+++` lines has no hunks, so the parser
  answered `modify` for a staged binary addition, a binary deletion and a staged
  empty text file alike. The status now comes from the header — `new file mode`
  and `deleted file mode` — and a mode-only change stays `modified`, because
  `new mode` is not `new file mode`.
- **A git failure says which of four things went wrong** (DA-66). `gitOrNull`
  swallowed every failure into `null`, and `null` meant one thing: a git that
  could not be started was reported as `HEAD does not resolve: no commits yet`
  in every repository under the root, giving an empty review and exit code 0.
  The layer now tells a spawn failure, a non-zero exit, a kill by signal and a
  `maxBuffer` overflow apart by what Node reports. A repository's own fault — a
  non-zero exit, output too large — is one warning on that repository and the
  rest of the review still comes back; a machine that cannot run git is not
  reported per repository but raised, and the CLI prints it as one line and
  exits 1 instead of a stack trace and 2.
- **An untracked symbolic link is no longer read through** (DA-73). The reader
  stat'd and read the entry `ls-files --others` named, following the link: a file
  outside the repository landed in the review as an addition of its content, and
  a link to `/dev/zero` reported a size of zero, passed the limit and hung the
  scan. A link is now an addition of mode `120000` whose content is its target,
  read with `readlink` — what git records for a tracked one — so a dangling link
  and a link to a directory are recorded the same way rather than refused, and
  nothing outside the repository is read at all.
- **A scan no longer writes `.git/index` in every repository it reads** (DA-65).
  `git diff` refreshes the index on its way out, which takes `.git/index.lock`
  and rewrites `.git/index` — a write to a reviewed repository, and a race with
  a `git add` running there at the same moment. The change set now comes from
  `git diff-index -p -M <base>`, whose output is byte-identical over every shape
  the parser handles and which leaves the index alone. The guard behind the rule
  changed with it: it compares `.git/index`, HEAD and every ref of each fixture
  before and after, and asserts the set of subcommands a scan runs, where
  `git status --porcelain` alone was blind to all of it.
- **The git reader no longer inherits the environment it was started in**
  (DA-87, [ADR-012](docs/adr/adr-012-git-trust-model.md)). `GIT_CONFIG_COUNT` /
  `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`, `GIT_CONFIG_PARAMETERS`, `GIT_DIR`,
  `GIT_WORK_TREE` and `GIT_INDEX_FILE` of a parent process — a git hook,
  `git rebase --exec`, an agent shell — went straight through the two null
  configuration files, and with `GIT_DIR` set a read of one repository answered
  with another one's files and exited 0. The child environment is now built from
  `process.env` without a single `GIT_*` key, so `cwd` alone says which
  repository is read. `docs/reference/02-git.md` no longer claims more isolation
  than the code provides.

- **A thread or a diff the live update could not read says why** (DA-102). The two
  reads `live.ts` makes for a frame reported only the status code, so a
  `comments.json` the server named by file and field reached the toast as
  `the thread c_7 could not be read: the server answered 500`. They now read the
  refusal the way every throwing fetch of the store does, through the store's own
  `refusal()`, and keep the thread or repository in front of the server's
  sentence. The rule — a failure the reader is told about carries the server's
  message, a background read stays silent — is in
  [08-ui.md](docs/reference/08-ui.md).

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

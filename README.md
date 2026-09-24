# diffalanche

A local code-review tool for a folder that holds many independent git
repositories. It shows the changes of every repository under one root as a
single merge-request-style review, stores the comments on disk as plain JSON,
and gives coding agents a CLI to read those comments, reply to them, and open
their own.

It is one person's tool on one machine: no server to deploy, no account, no
database, nothing leaves `127.0.0.1`. And it never writes to a repository you
are reviewing — git is read through the `git` binary, and the only directory
diffalanche creates is its own.

**Status:** Phase 1 shipped as v0.1.0 on 2026-09-05. The CLI, the storage, the
scanner, the git reader, the review server and the UI are in; the findings its
reviews and live use raised are being closed from the backlog, and nothing is
published to npm yet. Phase 2 (suggestions from an embedding index)
and later are in [docs/SPEC.md](docs/SPEC.md) section 10.

## Install

From the first release on (**the package is not on npm yet**; how a release is
made is under [Releases](#releases)), the npm channel needs no install of its
own:

```sh
npx diffalanche serve --open
```

It runs on Node 22 or newer. A binary, one per platform, is the other channel:
`darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64`, and
`windows-arm64`, each with the UI and the embedding model inside it and no
runtime to install ([The embedding model](#the-embedding-model)). Windows
binaries build but have never been run on Windows.

Until the first release, run it from a clone. Bun is the toolchain:

```sh
git clone https://github.com/Velklish/diffalanche
cd diffalanche
bun install
bun run build:ui                 # the UI the server serves
bun run src/cli/index.ts --help  # the CLI from source; `bun run dev` is the same thing
```

## First run

Stand in the directory that holds your repositories — that directory is the
**root**, and everything is relative to it. They may sit directly under it or
nested a couple of levels deep, `repos/<group>/<name>` and the like.

```sh
cd ~/work
diffalanche review new cargo-flags --base branch --title "Cargo flags across services"
diffalanche serve --open
```

`review new` creates a **review session** and makes it current; `--base branch`
says the change set of each repository is its branch against the merge base with
that repository's remote default branch. `--base head` — the default — is the
working tree against `HEAD` and needs neither a remote nor a branch. `serve`
scans the root, reads the change set, and prints where it is:

```
diffalanche 0.1.0 on http://127.0.0.1:4880
  3 repositories, 20 files, 2000 changed lines
```

Then the review is in the browser: every repository with changes, its files, its
diff. Select lines and write a comment; the comment lands in
`.diffalanche/reviews/cargo-flags/comments.json` and an agent reads it from
there through the CLI a moment later, with no restart on either side.

While you type, the form lists the five nearest comments from every past review
— `↑` / `↓` choose one and `TAB` takes its text and severity — and the `AUTO`
chip, chosen by default, leaves the severity to the vote of those comments when
you send. The thread says `auto` until an agent agrees with the label in its
reply (`reply --confirm-severity`) and then `labelled by <agent>`. While the
embedding model is away (`diffalanche model status`) the form says so, keeps
`AUTO` out of reach, and asks again after a pause.

The review keeps itself current: when an agent edits a file, replies, or
resolves a thread, the page hears it from the server and patches only what
changed — a hunk that moved takes an accent border and says how long ago, the
rail and the counters move, and a reply raises a toast — with no reload and
with the reading position where it was. The **agent activity** panel under the
file tree, collapsed by default, is the feed of what the server noticed while
it has been running. The sidebar footer says `watching` while the stream is
open and `reconnecting` while it is not.

The keyboard follows the design handoff:

| Key | What it does |
|---|---|
| `⌘K` / `Ctrl+K`, `⇧⇧` | global search over the files and comments of the review |
| `J` / `K` | the next and previous open thread of the whole review |
| `C` | a comment on the first added line of the file being read |
| `R` | resolves the focused thread |
| `B` | browses the file being read whole, and goes back to the review |
| `↑` / `↓`, `TAB` in the comment form | choose a suggestion from history, and take it |
| `⌘⏎` | sends the comment being written |
| `esc` | closes the topmost thing that is open |

Search covers file paths — the unchanged files of each repository too —,
comment bodies, the text of every working tree in the review, and definitions by
name — functions, classes, methods and types of TypeScript, JavaScript, C#,
Python, Go, Rust and Java, parsed with tree-sitter; a text or symbol hit opens
at its line.

Context outside the diff is one press away. `↑ 20 lines` on a hunk header brings
the working tree's lines above it into the diff, and the sidebar's `all files`
tab lists every file of each repository, the unchanged ones marked: one opens
whole, read-only and numbered from 1, at the working tree or at the base, and a
comment on its lines lands in the same session as any other. `Browse repo` on a
file card and `B` open the file being read the same way; `← back to review`
returns to where the reading was.

A root with no session is not an error — the server says so and the UI offers to
create one:

```
diffalanche 0.1.0 on http://127.0.0.1:4880
  no current review session: create one with `diffalanche review new <name>`
```

Sessions are history: `review list` shows them, `review use <name>` switches both
the UI and the CLI, and each keeps its own base and its own comments.

## Where the data lives

Everything is under `.diffalanche/` in the root — the only place the tool
writes:

```
.diffalanche/
  config.json              settings; missing means the defaults
  current                  the name of the current session
  reviews/<name>/
    review.json            the session: base, scope, status, title, timestamps
    comments.json          every comment and reply of that session
    diff.json              the change set as it was last scanned
```

It is plain JSON, documented in [docs/SPEC.md](docs/SPEC.md) section 7 and in
[docs/reference/03-storage.md](docs/reference/03-storage.md). Reading it with
`jq` is supported; the CLI is what writes it, because writes take the session's
lock.

The directory can live somewhere else. `--data-dir` moves it for one command;
to move it for good, set `DIFFALANCHE_DATA_DIR` in the shell, or put `dataDir`
in a configuration file of your own at `~/.config/diffalanche/config.json`
(`$XDG_CONFIG_HOME/diffalanche/config.json` when the variable is set):

```json
{ "dataDir": ".agents/diffalanche" }
```

The flag wins over the variable, the variable over the file, and the file over
the default. A relative flag is taken from the current directory; a relative
variable or `dataDir` is taken from the root, so one value serves every root.
Only `dataDir` is read from that file — the settings below stay in
`config.json` inside the data directory.

## The embedding model

Suggestions — `suggest`, and the composer from DA-36 — come from a multilingual
embedding model that runs on your machine and needs nothing online once it is
there: `multilingual-e5-small` in int8, pinned to one revision, with the ONNX
Runtime that runs it. Both live in the user cache, shared by every root:

```
$XDG_CACHE_HOME/diffalanche/models/multilingual-e5-small-761b726dd34f/   # ~/.cache without the variable
  model_quantized.onnx     118.3 MB
  tokenizer.json            17.1 MB
  tokenizer_config.json      443 B
  onnxruntime-node-1.30.0-<platform>/   # the runtime: its binding and library, 25–73 MB
```

- **The npm package** carries neither. The first `suggest` or `index rebuild`, or
  the first suggestion `serve` is asked for, downloads them from this version's
  GitHub release — 160–208 MB by platform, 180 MB on an Apple Silicon Mac — with
  the progress on standard error, and checks every file against the SHA-256 the
  build pins before it keeps it. `serve` alone downloads nothing, and while the
  download runs it answers a suggestion with 503 rather than waiting.
  `diffalanche model pull --embedding` does it ahead of time. A download is not
  resumed: an interrupted one starts over. Offline and without the files, the
  command says which file it could not fetch and from where, and writes nothing.
- **A binary** carries both: 233–290 MiB by platform, 233 MiB on an Apple Silicon
  Mac. On first use it writes them into the same cache, and never reaches the
  network for them.
- **An Intel Mac** (darwin-x64) gets neither: the runtime has no build for it, and
  suggestions are not available there.

The model runs in a process of its own, started by the first `suggest`, `index
rebuild` or suggestion `serve` is asked for — `node dist/embed-child.js` for the
npm package, the binary itself for a binary — and peaks at 630–750 MiB while the
command or the server that started it keeps the index. A command ends it when it has
answered, and `serve` keeps it until it stops.

`diffalanche model status` says where the model is expected and whether it and
the runtime are there. Deleting the directory is safe: the next use fetches or
writes it again. A new version with another model or runtime gets a directory of
its own and leaves the old one where it was — 160–208 MB each, removed
only by hand. `DIFFALANCHE_ASSETS_URL` points the npm package at a mirror of the
release.

## Configuration

`.diffalanche/config.json`, all of it optional — with no file at all, the
defaults below are the configuration:

```json
{
  "roots": ["."],
  "depth": 2,
  "exclude": [],
  "user": "kim.p",
  "port": 4880,
  "lsp": {},
  "grammars": {}
}
```

| Field | Default | What it does |
|---|---|---|
| `roots` | `["."]` | Where to look for repositories, relative to the root. `["repos"]` for a `repos/<group>/<name>` layout |
| `depth` | `2` | How many levels below each `roots` entry a repository may sit |
| `exclude` | `[]` | Glob patterns of files kept out of the change set |
| `user` | git's `user.name` in the root, else the OS user | The name the UI signs comments with |
| `port` | `4880` | What `serve` listens on; `--port` overrides it |
| `lsp` | `{}` | `language → server command`; unused until Phase 3 |
| `grammars` | `{}` | Languages the symbol index reads besides the bundled eight: `name → { wasm, extensions, query }`, the WASM path relative to the root ([09-ml.md](docs/reference/09-ml.md)) |

A broken value is refused by name — `config.json: port: expected a port between
1 and 65535` — rather than silently replaced by a default.

## The CLI

The CLI is the contract coding agents work through: its flags, its output, and
its exit codes ([ADR-004](docs/adr/adr-004-agent-contract.md)). The table below
is every command that exists today; `--help` on any of them prints the same
flags, and `tests/readme-cli.test.ts` fails if the two ever disagree.

| Command | What it does |
|---|---|
| `serve [--port <n>] [--open] [--verbose]` | serve the review and the UI on `127.0.0.1`; `--open` opens the browser, `--verbose` logs every request |
| `review new <name> [--base <head\|branch\|branch:<name>\|<ref>>] [--title <text>] [--repo <path>]… [--path <repo>:<file>]… [--no-use]` | create a review session and make it current; `--repo` and `--path` give it a scope, `--no-use` leaves `current` alone and prints the task's address |
| `review use <name>` | make a review session the current one |
| `review list [--json]` | the review sessions, most recently updated first, each with its scope and status |
| `review base <head\|branch\|branch:<name>\|<ref>>` | change what the change set of a review session is read against |
| `review scope [--json]` | what the review session is about |
| `review scope set [--repo <path>]… [--path <repo>:<file>]… [--drop-comments]` | replace it; this is what gives a scope to a session that has none |
| `review scope add [--repo <path>]… [--path <repo>:<file>]…` | widen what the review session is about |
| `review scope remove [--repo <path>]… [--path <repo>:<file>]… [--drop-comments]` | narrow it; without `--drop-comments` a removal that would delete comments is exit code 1 and writes nothing |
| `review close [<name>] --role human [--author <name>]` | mark a review session closed; comments still work on a closed one; `--role human` is required |
| `review reopen [<name>] --role human [--author <name>]` | open a closed review session again; `--role human` is required |
| `diff [--repo <path>] [--json] [--patch]` | the change set of the review session; rewrites `diff.json` |
| `list [--status <open\|resolved\|all>] [--repo <path>] [--severity <critical\|warning\|nit\|question>] [--unanswered] [--json]` | the comments of the review session |
| `show <id> [--json]` | one comment with its thread and its anchor |
| `reply <id> --body <text\|-> [--author <name>] [--role <human\|agent>] [--confirm-severity]` | reply in a thread; `--confirm-severity` agrees with a severity the model chose, and the thread then reads `labelled by <author>` |
| `comment [--repo <path>] [--path <path>] [--line <n>] [--end-line <n>] [--side <new\|old>] --severity <critical\|warning\|nit\|question> --body <text\|-> [--author <name>] [--role <human\|agent>]` | open a comment on a line, a file, a repository, or the review |
| `resolve <id> --role human [--note <text>] [--author <name>]` | close a thread; `--role human` is required |
| `reopen <id> --role human [--note <text>] [--author <name>]` | open a thread again; `--role human` is required |
| `export [--status <open\|all>] [--format <md\|json>]` | the review as markdown grouped by repository |
| `suggest [--json] --body <text>` | past comments like this one from every review session, and the severity they vote for |
| `index rebuild` | embed every comment of every review session again and write the embedding index |
| `index status [--json]` | what the embedding index holds, and what it is missing |
| `model status [--json]` | the embedding model: its version, where it is cached, and whether it and its runtime are there |
| `model pull [--embedding]` | put the embedding model and its runtime into the user cache now rather than on first use; `--embedding` is required until the generative model (Phase 4) |
| `version` | print the version of diffalanche; also `--version` |

Every command also takes these, **after** the command name — `diffalanche diff
--root ~/work`, not `diffalanche --root ~/work diff`:

| Global flag | Default |
|---|---|
| `--review <name>` | the review session to work on; the current one |
| `--data-dir <dir>` | the data directory; `DIFFALANCHE_DATA_DIR`, then `dataDir` of the user config, then `<root>/.diffalanche` |
| `--root <dir>` | the directory under review; the current directory |
| `--help`, `-h` | the options of that command, and nothing else |

A day of it:

```sh
diffalanche review new ls-240372 --base branch:origin/develop --title "Cargo flags"
diffalanche review new ls-240373 --repo repos/group/service-api \
  --path repos/group/other-api:src/Cargo.cs --no-use   # a task over what an agent touched
diffalanche diff --json                       # the change set; rewrites diff.json
diffalanche diff --repo repos/group/service-api
diffalanche list --unanswered --json          # what no agent has answered yet
diffalanche show c_7f3k2q
diffalanche reply c_7f3k2q --body "Fixed: the fallback is gone." --author claude
diffalanche comment --repo repos/group/service-api --path src/CargoService.cs --line 42 \
  --severity warning --body -                 # - reads standard input
diffalanche resolve c_7f3k2q --role human --author kim.p
diffalanche export --format md > review.md
```

A review session may carry a **scope** — the repositories and the files it is
about — and then it shows nothing else: `diff`, `list`, `show`, and `export` all
answer inside it, and a comment on something outside it is refused by name. A
session without a scope is the whole root, which is what every session was
before. `review scope` prints one; `review scope set` replaces it, `review scope
add` and `review scope remove` change it, and a replacement or removal that
would delete comments needs `--drop-comments`.

Comments are signed `--author agent` and `--role agent` unless told otherwise,
and only `--role human` may `resolve` or `reopen` a thread, or `review close` or
`review reopen` a task. Exit code 0 is success, 1 is a user error with one line
on stderr, and 2 is anything the tool
did not expect, with its stack trace. JSON goes to stdout and nothing else does,
so `diffalanche diff --json | jq` never has a warning mixed into it.

Every flag, every refusal, and what each command writes is in
[docs/reference/06-cli.md](docs/reference/06-cli.md).

## Agent skills

Two skills ship with the tool, in `skills/`. They are the written half of the
agent protocol; the enforced half is the CLI itself.

| Skill | What it does |
|---|---|
| [diffalanche-apply](skills/diffalanche-apply/SKILL.md) | Reads the unanswered threads, groups them by repository, gets your confirmation, edits the code, and replies to every comment |
| [diffalanche-review](skills/diffalanche-review/SKILL.md) | Reads the change set and opens findings as comments anchored to the lines that carry them |

Neither closes a thread. `resolve` and `reopen` need `--role human`, and the
refusal is in the CLI rather than in the skills, so an agent that never read one
cannot close a thread either ([ADR-004](docs/adr/adr-004-agent-contract.md)).

**Claude Code** loads a skill from a directory named after it under
`.claude/skills/`, in the project or in `~/.claude/`. Copy both skills into the
root you are reviewing. From a clone of this repository they are in `skills/`
beside you:

```sh
mkdir -p .claude/skills
cp -R /path/to/diffalanche/skills/diffalanche-apply  .claude/skills/
cp -R /path/to/diffalanche/skills/diffalanche-review .claude/skills/
```

From the first release on (DA-31; the package is not on npm yet), `npm install
diffalanche` puts them under `node_modules/diffalanche/skills/`, and `npm
install -g` under `$(npm root -g)/diffalanche/skills/`. Bare `npx diffalanche`
never gives you a path to copy from: it runs the CLI out of a cache directory
whose name is npm's business, so a clone or an install is what puts the files
somewhere you can reach.

Each skill is one directory — `SKILL.md` and `references/` together — and
copying only the `SKILL.md` leaves its command examples unreachable. Then
`/diffalanche-apply` runs one by name, and Claude Code reaches for it on its own
when what you asked for matches the `description`.

**Any other harness** is pointed at the files where they lie. The skills are
plain markdown with no harness-specific frontmatter and no tool permissions in
them, so a rule file, a system prompt, or a manifest that reads
`skills/diffalanche-apply/SKILL.md` gets the whole procedure. What each one
assumes of a harness is a place to put skill directories and an agent that can
run shell commands and edit files; there are no hooks and no configuration.
Adapters that repackage them as Cursor rules and Codex prompts are a separate,
deferred task.

The published package will carry `skills/` beside `dist/`, so every install
has them. What they promise and how they are shipped is in
[docs/reference/10-skills.md](docs/reference/10-skills.md).

## Development

Bun is the toolchain; the server and the CLI run on Node >= 22 as well and use
only APIs shared by both runtimes. That is the published package's floor: the
bundle is plain JavaScript. Development needs Node >= 22.18, because the tests
start the CLI from its TypeScript source and Node has stripped types without a
flag only since then; below that one test skips and says so.

```sh
bun install        # dependencies and the lockfile
bun run model:fetch # the pinned embedding model into ~/.cache, for the tests (135 MB once)
bun run lint       # Biome: lint and format check
bun run typecheck  # tsc over the three TypeScript projects
bun run test       # Vitest on Node
bun run test:bun   # the same suite on Bun's runtime
bun run test:ui    # Playwright: the UI against its screenshot baselines
bun run test:e2e   # Playwright: the acceptance list, against the built binary
bun run build      # both delivery channels: dist/cli.js and six binaries
bun run build -- --target current   # one binary, for this machine
bun run build:cli  # the npm bundle alone
bun run build:ui   # build the UI into dist/ui with Vite
```

The performance harness measures the UI on the synthetic review in headless
Chromium. It needs the fixture, the built UI, and Chromium once:

```sh
bunx playwright install chromium
bun run synth -- --out .perf/fixture
bun run build:ui
bun run perf         # the gate: medians against the budgets
bun perf/run.ts      # one run, raw numbers
```

`bun run perf` is a gate: it fails when the median of any budget line of the
specification is over budget. It takes about half a minute.

`bun run test:ui` builds the UI, generates the small synthetic review
(`synth -- --out .perf/e2e --small`) and serves it: the diff and navigation
tests run against that fixture, and only the shell tests stub an empty review to
measure the shell on its own. It needs Chromium, the same one the performance
harness uses. The screenshot baselines were taken on macOS, so the two specs that
compare against them skip on any other platform and say so; the rest of the
suite runs in CI too.

`bun run test:e2e` is the other Playwright suite: the acceptance criteria of the
specification, one named test each, run against the binary rather than the
sources. It builds the target of the machine it is on, generates a fixture of
its own, serves it with `diffalanche serve` on a free port and stops it again,
and the `diffalanche` the tests read back with is that same binary. It takes
about seventy seconds from cold, most of it the build, and it is what CI runs on
Linux and macOS. The two suites share `dist/`, so run them one after the other
rather than at once. See
[reference/08-ui.md](docs/reference/08-ui.md#the-acceptance-suite) for the
criterion-to-test table and how to debug a single one.

`scripts/smoke.sh <command>` runs one review from `review new` to `export`
through one delivery channel, whichever CLI it is given, under a temporary root
of its own:

```sh
scripts/smoke.sh node dist/cli.js                # the npm bundle on Node
scripts/smoke.sh bun src/cli/index.ts            # the sources on Bun
scripts/smoke.sh ./dist/diffalanche-darwin-arm64 # the binary of this platform
```

It needs the channel built first (`bun run build`, or `build:ui` alone for the
sources on Bun) and takes about 4 seconds. CI runs the same script on Node, on
Bun, and against the binary of the runner's platform.

`bun run test` runs Vitest on Node: Bun starts the runner, and the runner runs
the tests on Node. `bun run test:bun` runs the same suite on Bun's own runtime,
which is what CI's `test-bun` job does — the tool promises both runtimes, so
both execute the suite. `tests/runtime.test.ts` says which one it got.

`bun run typecheck` checks three TypeScript projects in one command: the runtime
code without the browser's globals, `src/ui` without Node's, and the tests and
harnesses with both.

A test that asserts a file **was not** written says it with
`tests/helpers/untouched.ts` rather than by comparing the content: a rewrite
that puts the same bytes back is what the comparison cannot see, and the helper
stamps the mtime before the command and checks the stamp and the bytes after it
([06-cli.md](docs/reference/06-cli.md)).

`bun run dev` runs the CLI from source. The same lint, typecheck, and test
commands run in CI on pushes to `main` and on pull requests. Biome skips `backslop.json`:
the backslop CLI rewrites that file in its own style, so formatting it here
would only make the two tools fight.

Layout: `src/core` (scanner, git, storage, domain), `src/cli`, `src/server`,
`src/ui`, `perf` (the performance harness), `scripts` (build and fixture
scripts), `skills` (shipped agent skills). Only `scripts` and `perf` may use
runtime-specific APIs such as `Bun.*`; `src/server/runtime.ts` is the single
place in `src/` that knows which runtime it is on.

### Design artifacts and the design hook

UI work runs against the Impeccable design skill, installed at the Claude Code
user level (`~/.claude/skills/impeccable`). It reads four files in this
repository:

| File | What it is |
|---|---|
| `PRODUCT.md` | Durable product truth: users, purpose, positioning, constraints, brand commitments. Written once; it changes when the product does, not when a screen does. |
| `DESIGN.md` | The visual system as `src/ui/tokens.css` implements it, both themes, in the [DESIGN.md format](https://github.com/google-labs-code/design.md). The token authority beside the handoff; its colours and `tokens.css` carry the same values and change in the same pass. |
| `.impeccable/design.json` | What that format cannot hold: the two shadows, the two keyframes, the focus rings, the 1560 px floor, colour display names, and eight component snippets. |
| `.impeccable/surfaces/*.md` | One brief per screen — scope, visitor mode, the job, constraints, and what is still unresolved there. `src-ui-app-tsx.md` covers the review workspace and every component in it. |

Before editing anything under `src/ui`, load them together:

```sh
node ~/.claude/skills/impeccable/scripts/context.mjs --target src/ui/App.tsx
```

The **design detector hook** runs the same checks automatically after an editing
tool writes a UI file, and a deeper pass over everything the session touched when
it stops. `.impeccable/config.json` turns it on for this repository and is
committed; `.impeccable/config.local.json` records one developer's consent and is
not.

No harness manifest is committed, because a manifest has to name the path where
Impeccable is installed and that path differs per machine. Each developer wires
it once:

```sh
node ~/.claude/skills/impeccable/scripts/hook-admin.mjs on      # installs manifests
node ~/.claude/skills/impeccable/scripts/hook-admin.mjs status  # what is wired now
```

`on` writes the manifests only when the skill sits inside the project
(`.claude/skills/impeccable`, `.agents/skills/impeccable`,
`.cursor/skills/impeccable`). With a user-level install it enables the hook in
`.impeccable/config.json` and prints *"No installed provider skill folders found
to repair"* — then the manifest is added by hand. Replace
`$HOME/.claude/skills/impeccable` below with wherever the skill actually lives.

Claude Code, `.claude/settings.local.json` (gitignored):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 5, "statusMessage": "Checking UI changes" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 30, "statusMessage": "Design deep pass" }] }
    ]
  }
}
```

Codex, `.codex/hooks.json` — the same two events, a different write matcher, and
approval through `/hooks` the first time:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|apply_patch",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 5, "statusMessage": "Checking UI changes" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 30, "statusMessage": "Design deep pass" }] }
    ]
  }
}
```

Cursor, `.cursor/hooks.json` — a pre-write gate instead, which refuses a proposed
write the detector objects to; enable hooks under Settings → Hooks:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook-before-edit.mjs\"", "timeout": 5 }
    ]
  }
}
```

Without a hook the check is manual, once, on the files a change touched:

```sh
node ~/.claude/skills/impeccable/scripts/detect.mjs --json src/ui/App.tsx src/ui/styles.css
```

## Releases

A release is one annotated tag, `v0.1.0`, on `main`. The tag is made locally and
pushed by hand; the push is the only thing that publishes anything.

```sh
bun run release 0.1.0             # every check, then the tag
bun run release 0.1.0 -- --dry-run  # every check, no tag
git push origin v0.1.0            # yours, and what starts the release workflow
```

`scripts/release.ts` is the preflight, cheapest check first: `package.json`
declares that version, the working tree is clean with untracked files included,
the branch is `main`, the tag is free, `CHANGELOG.md` has a `## [0.1.0]` section
with something under it and still has an Unreleased one, and `bun run test`
passes. Then it writes the annotated tag and stops. It never pushes and never
edits a file — moving the Unreleased entries under a version heading is a commit
you make first, because an edit made here would dirty the tree and the tag would
point at the commit before it.

`.github/workflows/release.yml` does the rest, on the commit the tag names:

- the version comes from the tag and is checked against `package.json` again, so
  a tag made by hand is caught too;
- the release notes are that version's `CHANGELOG.md` section, read out of the
  file;
- `bun run build` builds the UI, `dist/cli.js`, and all six binaries in one job —
  `bun build --compile` cross-compiles, so a matrix of six would only rebuild the
  same UI six times;
- the binaries, the embedding model's files and each platform's runtime files —
  nineteen assets the npm channel downloads, staged by `scripts/assets.ts` after
  `bun run model:fetch` — and a `SHA256SUMS.txt` are attached to a GitHub
  release. The checksum step counts its own lines against the six binaries plus
  the assets and re-reads every file with `sha256sum -c`, so a build that emitted
  fewer stops the release instead of shipping one short;
- `npm publish --provenance` publishes the npm channel from the repository
  secret `NPM_TOKEN`, with the workflow's OIDC token as the provenance
  attestation. The six binaries stay out of the tarball: they are release
  assets, and `files` in `package.json` excludes them; the package is the bundle,
  the model's process `dist/embed-child.js`, and the UI. Without the secret the
  step is skipped with a notice, and the GitHub release is the whole release.

The release page appears only once its binaries are on it: the release is
created as a draft, the assets are uploaded, and the draft is published last.
A gigabyte and a half takes time to upload and an upload can fail, and a release page
with notes and no downloads is worse than one that is not there yet.

The job can be run again. The GitHub release is reused if it already exists and
its assets are replaced, which is what makes a retry of the npm publish — the
step most likely to fail on its own — a matter of re-running the job.

A pre-release version — `0.1.0-rc.1` — goes to the npm `next` dist-tag and is
marked a pre-release on GitHub, so `npx diffalanche` keeps pointing at the last
stable one.

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
one section per version, newest first, under `## [x.y.z] - YYYY-MM-DD`, and an
`## [Unreleased]` section that is always present — every change lands there
first, and a release renames it and opens an empty one above. The release reads
that file rather than a hand-written note, so an entry missing from it is
missing from the release page too.

## Documentation

| Document | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Product specification: decisions, requirements, on-disk format, CLI, agent protocol, performance budgets, phases |
| [docs/reference/](docs/reference/README.md) | Subsystem reference: how the code works today, one page per subsystem |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Normative vocabulary: one concept, one name |
| [docs/README.md](docs/README.md) | Documentation index and the decision log (ADRs) |
| [docs/design/HANDOFF.md](docs/design/HANDOFF.md) | UI design handoff: tokens, screens, interactions, keyboard map (Russian) |
| [docs/design/prototype.dc.html](docs/design/prototype.dc.html) | Working HTML prototype of every screen and state |
| [PRODUCT.md](PRODUCT.md) | Durable product truth for design work: users, purpose, positioning, constraints |
| [DESIGN.md](DESIGN.md) | The visual system as `src/ui/tokens.css` implements it, both themes |
| [CHANGELOG.md](CHANGELOG.md) | What changed, per release |

Tasks and decisions are tracked with [backslop](https://github.com/Velklish/backslop):
`npx github:Velklish/backslop#v0.9.0 status` prints the queue, the active work,
and the triage. The rules for working in this repository are in
[AGENTS.md](AGENTS.md).

License: MIT.

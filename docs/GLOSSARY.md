# Glossary

The normative vocabulary for diffalanche. Project texts use only names from this glossary: one concept, one name. When a second spelling appears, either add it to “Retired terms” as a replacement or remove it from the text.

The “Term” column gives the spelling for prose; EN is the name in code and English text. Evidence identifies where the term lives: a file path, table, event, or document. A term without evidence is a hypothesis and is marked `[?]` until the owner confirms it.

## Terms

| Term | EN | Definition | Evidence |
|---|---|---|---|
| root | `root` | The directory under review; holds the repositories and the data directory. Defaults to the current directory, overridden by `--root`. | SPEC.md §3.3, §4 |
| repository | `repo` | A git working tree found under the root, identified by its path relative to the root, `roots` entry included — `repos/group/service-api` with `roots: ["repos"]`, `group/service-api` with the default `roots: ["."]`. Sibling worktrees count; nested submodules and worktrees do not. | SPEC.md §3.3, §4 |
| base mode | `base.mode` | How a repository's change set is computed: `head`, `branch`, or `ref`. Set per review session, resolved per repository. | SPEC.md §3.4, §7 |
| merge-base branch | `base.branch` | The branch used for the merge base in `branch` mode; the remote default branch when not set. | SPEC.md §3.4, §7 |
| resolved base | `base` | The base one repository's change set was computed against: the mode the resolution ended at, the ref it came from, and the sha. `null` when it did not resolve and the repository is out of the review. | SPEC.md §7, reference/02-git.md |
| review session | `review` | A named unit of review work: base mode plus all comments. Lives in `reviews/<name>/`. | SPEC.md §4, §7 |
| current session | `current` | The pointer file naming the session the UI and the CLI use without `--review`. | SPEC.md §4, §7 |
| data directory | `dataDir` | `<root>/.diffalanche/` with `config.json`, `reviews/`, `current`, and the embedding index; overridden by `--data-dir`. | SPEC.md §3.5, §7 |
| change set | `diff` | The changes of every repository that has changes, computed against the base mode; untracked files included. Cached in `diff.json`. | SPEC.md §5, §7 |
| scan | `scan` | One pass that finds repositories and computes the change set; rewrites `diff.json` and produces scanner warnings. | SPEC.md §7, ADR-003 |
| warning | `warning` | A message from a subsystem about something it skipped and why. Two sources: the scan, about one repository or one directory it walked — ref does not resolve, no remote, worktree of a listed repository, root is itself a repository, directory cannot be read — shown in the warnings bar and spelled *scanner warning* in prose; and storage — a directory under `reviews/` without a `review.json`. | SPEC.md §3.4, HANDOFF.md §1.2, reference/01-scanner.md, reference/03-storage.md |
| omitted | `omitted` | Why a file of the change set is listed without content: `binary` or `too-large`; its patch is empty and it has no hunks. | reference/02-git.md |
| comment | `comment` | A finding with severity, status, author, role, body, and an anchor. | SPEC.md §4, §7 |
| thread | `thread` | A comment with its replies. | SPEC.md §4 |
| reply | `reply` | A message inside a thread, with author and role. | SPEC.md §7 |
| anchor | `anchor` | Where a comment attaches: review, repository, file, line, or line range. Line anchors keep the line text and context. | SPEC.md §3.6, §7 |
| severity | `severity` | `critical`, `warning`, `nit`, or `question`. | SPEC.md §3.7 |
| status | `status` | `open` or `resolved`; Phase 3 adds `orphaned`. Only a human sets `resolved`. | SPEC.md §3.8 |
| role | `role` | Who wrote a message: `human` or `agent`. | SPEC.md §3.8 |
| author | `author` | The name on a message: `config.user` from the UI, `--author` from the CLI. | SPEC.md §8 |
| unanswered | `--unanswered` | An open comment whose last message is from a human: an agent has not replied yet. | SPEC.md §8 |
| awaiting | `awaiting` | An open comment whose last message is from an agent: the human has not verified it yet. Counted in the header. | SPEC.md §5, HANDOFF.md §1.1 |
| review document | `document` | What `GET /api/review` answers with: the change set of the current session, the session itself, its comments, and the counters, in one response. The UI loads a review by loading this. | reference/07-server.md, src/server/review.ts |
| activity feed | `activity` | The activity events the running server has seen, in the order they happened and capped at the last 200; `GET /api/activity` reads it. In memory only, gone when the server stops. | SPEC.md §5, §10, ADR-005, reference/05-watcher.md, src/core/watcher/activity.ts |
| delivery channel | `channel` | One of the two ways diffalanche is shipped and run: the npm bundle on Node, and the compiled binary with the UI inside it. | ADR-002, ADR-008, reference/06-cli.md |
| live stream | `stream` | The SSE connection the page keeps open on `GET /api/events` for as long as it is open; the server names what changed and the page fetches it. Its state is `connecting`, `watching`, or `reconnecting`, and the sidebar footer says which. | ADR-005, reference/07-server.md, HANDOFF.md §1.3 |
| activity event | `event` | Something the server noticed while a review is open: a diff changed, a comment or reply was written. In memory only. | SPEC.md §4, ADR-005 |
| composer | `composer` | The inline form under the selected lines where a comment is written. | HANDOFF.md §2 |
| thread rail | `rail` | The right column that lists threads for the open file or the whole review. | HANDOFF.md §3 |
| synthetic review | `synth` | The deterministic fixture of 21 repositories, 300 files, 30 000 diff lines, and 200 comments used by the performance gate. | SPEC.md §6 |
| smoke matrix | `smoke` | One CLI scenario run on every delivery channel and every runtime: the npm bundle on Node, the sources on Bun, and the compiled binary. | ADR-006, scripts/smoke.sh, reference/11-perf.md |
| orphaned | `orphaned` | A comment whose anchor cannot be found after code edits; kept, marked, re-anchored by hand or by a model proposal. Phase 3. | SPEC.md §3.8, HANDOFF.md §3 |
| suggestion | `suggest` | A similar past comment proposed while typing, retrieved from the embedding index. Phase 2. | SPEC.md §5, §8 |
| surface brief | `brief` | One document per screen for design work: visitor mode, the job on that screen, its constraints, and what is still undecided there. Lives in `.impeccable/surfaces/`. | .impeccable/surfaces/, reference/08-ui.md |
| design detector | `detector` | The mechanical check the Impeccable skill runs over a UI file after an edit; enabled for the repository in `.impeccable/config.json`. | README.md, reference/08-ui.md |
| design system | `design` | The visual rules `DESIGN.md` carries: tokens, typography roles, components, and the named rules; the token authority beside the handoff. | DESIGN.md, reference/08-ui.md |

## Retired terms

| Do not use | Use | Why |
|---|---|---|
| session file | review session directory | Since ADR-003 a session is a directory with three files, not one file |
| MR, merge request | review session | diffalanche has no server-side merge requests; “merge-request-style” describes the look only |
| review bundle | review document | One response, one name; the code calls it `review.document()`. The spelling survives in the title of the archived DA-16 |

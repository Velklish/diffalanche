# Glossary

The normative vocabulary for diffalanche. Project texts use only names from this glossary: one concept, one name. When a second spelling appears, either add it to “Retired terms” as a replacement or remove it from the text.

The “Term” column gives the spelling for prose; EN is the name in code and English text. Evidence identifies where the term lives: a file path, table, event, or document. A term without evidence is a hypothesis and is marked `[?]` until the owner confirms it.

## Terms

| Term | EN | Definition | Evidence |
|---|---|---|---|
| root | `root` | The directory under review; holds the repositories and the data directory. Defaults to the current directory, overridden by `--root`. | SPEC.md §3.3, §4 |
| repository | `repo` | A git working tree found under the root, identified by its path relative to the root, for example `group/service-api`. Sibling worktrees count; nested submodules and worktrees do not. | SPEC.md §3.3, §4 |
| base mode | `base.mode` | How a repository's change set is computed: `head`, `branch`, or `ref`. Set per review session, resolved per repository. | SPEC.md §3.4, §7 |
| merge-base branch | `base.branch` | The branch used for the merge base in `branch` mode; the remote default branch when not set. | SPEC.md §3.4, §7 |
| review session | `review` | A named unit of review work: base mode plus all comments. Lives in `reviews/<name>/`. | SPEC.md §4, §7 |
| current session | `current` | The pointer file naming the session the UI and the CLI use without `--review`. | SPEC.md §4, §7 |
| data directory | `dataDir` | `<root>/.diffalanche/` with `config.json`, `reviews/`, `current`, and the embedding index; overridden by `--data-dir`. | SPEC.md §3.5, §7 |
| change set | `diff` | The changes of every repository that has changes, computed against the base mode; untracked files included. Cached in `diff.json`. | SPEC.md §5, §7 |
| scan | `scan` | One pass that finds repositories and computes the change set; rewrites `diff.json` and produces scanner warnings. | SPEC.md §7, ADR-003 |
| scanner warning | `warning` | A per-repository message from a scan: ref does not resolve, no remote, worktree of a listed repository. Shown in the warnings bar. | SPEC.md §3.4, HANDOFF.md §1.2 |
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
| activity event | `event` | Something the server noticed while a review is open: a diff changed, a comment or reply was written. In memory only. | SPEC.md §4, ADR-005 |
| composer | `composer` | The inline form under the selected lines where a comment is written. | HANDOFF.md §2 |
| thread rail | `rail` | The right column that lists threads for the open file or the whole review. | HANDOFF.md §3 |
| synthetic review | `synth` | The deterministic fixture of 21 repositories, 300 files, 30 000 diff lines, and 200 comments used by the performance gate. | SPEC.md §6 |
| orphaned | `orphaned` | A comment whose anchor cannot be found after code edits; kept, marked, re-anchored by hand or by a model proposal. Phase 3. | SPEC.md §3.8, HANDOFF.md §3 |
| suggestion | `suggest` | A similar past comment proposed while typing, retrieved from the embedding index. Phase 2. | SPEC.md §5, §8 |

## Retired terms

| Do not use | Use | Why |
|---|---|---|
| session file | review session directory | Since ADR-003 a session is a directory with three files, not one file |
| MR, merge request | review session | diffalanche has no server-side merge requests; “merge-request-style” describes the look only |

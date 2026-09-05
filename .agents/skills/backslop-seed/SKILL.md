---
name: backslop-seed
description: Populate the documentation skeleton after `backslop init` — inventory the repository with evidence, ask the owner a short set of questions, then fill the glossary, backfill initial ADRs, documentation index, subsystem reference, gates in backslop.json, and task queue. Always use when asked to “populate docs”, “initialise documentation”, “create a glossary”, “describe project terms”, “write initial ADRs”, “document decisions already made”, “describe subsystems”, or “what to do after backslop init”, and when untouched templates with `[TODO]` are present in `GLOSSARY.md`, `ROADMAP.md`, or `reference/README.md`. Not for task management (`backslop-task`) or an ADR for a new decision during work (`backslop adr` and procedure step 3).
---
<!-- backslop:generated -->

# backslop-seed — populate the documentation skeleton

`backslop init` creates a skeleton: index, glossary, roadmap, reference, first ADR, and task directories. Only someone who has read the repository and spoken to the owner can populate it. This skill defines that order: evidence first, then questions, then text. `npx github:Velklish/backslop#v0.4.0` is called `backslop` below; the documentation directory is `docs/`.

**Precondition:** `backslop.json` and the `docs/` directory exist at the root. If not, run `backslop init` first; this skill does not lay out the skeleton itself.

**Three rules that hold the whole skill together:**

- **Evidence for every claim.** A term has a path to where it lives; a decision has a dependency, configuration, or commit that shows it; a gate command has the file where it is declared. Without evidence, use `[TODO]`; when a human decision is needed, use `[ASK]`.
- **Append, do not overwrite.** A file written by a human is never replaced wholesale: fill `[TODO]` locations, add table rows, and put new material beside it. A repeated run closes only gaps.
- **Asking is cheaper than confidently writing something false.** A file with an invented decision rationale is worse than an empty section because the next reader will believe it.

## Phase 1. Inventory — silent and read-only

Do not write or ask until reading the repository. See [references/inventory.md](references/inventory.md) for what and where to inspect. The phase produces four candidate lists, each entry with evidence:

| List | Destination | Source |
|---|---|---|
| build, test, and lint commands | `gates` in `backslop.json` | package manifests, Makefile, CI configuration, README |
| subsystems | table in `docs/reference/README.md` | top-level directories, projects, services, entry points |
| terms | `docs/GLOSSARY.md` | entity, table, event, enum, configuration-key names, words from README and discussions |
| decisions | `docs/adr/` | major dependencies, “why” in comments and README, moves in git history |

Read existing documentation — README, ARCHITECTURE, CONTRIBUTING, `docs/**`, ADRs in another format — first: it is already canonical and must be linked from the index rather than overwritten. ADRs in another format require an owner decision: migrate into `docs/adr/` while preserving numbers and dates, or leave them and link them.

## Phase 2. Ask the owner — only what cannot be extracted

Use a survey, listing your recommendation first. Do not ask what is visible in the repository. Usually not extractable:

1. the project’s one-line purpose and its owner — for the index and ADR;
2. near-term goals and how ordering is decided — for `ROADMAP.md`; if there are no goals, record that;
3. who reviews changes and how — for the review gate in the procedure;
4. disputed terms: two names for one concept or an old word to retire — for the glossary;
5. which decision candidates are true decisions and which are accidents of history; present the whole candidate list **before** writing, and let the owner choose; selection rules are in [references/adr-backfill.md](references/adr-backfill.md).

Record answers immediately in phase 3 artifacts, not in session memory.

## Phase 3. Populate

Work from the frame toward details; every item means editing `[TODO]` locations or adding rows, never rewriting.

1. **`docs/README.md`** — project name, discovered documents as table rows (existing READMEs, ARCHITECTURE, and others as links with “Living” status), and owner-provided principles.
2. **`docs/GLOSSARY.md`** — 10–30 terms, each with an EN pair, one- or two-sentence definition, and evidence; disputed terms use `[?]` until the owner decides; retired terms go into the bottom table with their replacements. Format and inclusion criteria are in [references/glossary.md](references/glossary.md).
3. **`docs/adr/`** — backfill selected decisions: `backslop adr <slug> --title "…"`, status `Accepted`, original date from history, and a “recorded retrospectively” note in Context; put the owner in the process ADR's Deciders (`adr-NNN-process.md`, written by `init`). Each ADR gets a row in `docs/README.md`. Rationale only with evidence; when history is sparse, say so in Context.
4. **`docs/reference/README.md`** — a subsystem table with entry points from the inventory; do not write section bodies now, create tasks instead: `backslop new describe-<subsystem> --queue --title "Reference: <subsystem>"` (slug uses lowercase Latin letters and hyphens: `describe-orders-api`).
5. **`docs/ROADMAP.md`** — goals from the survey; if there are none, use one sentence saying so instead of `[TODO]`.
6. **`backslop.json`** — `gates` from discovered commands after owner confirmation; `backslop lint` remains in the list.
7. **Queue and triage** — incomplete material and open questions: reference sections go in the queue; unanswered questions become `triage/` files (`backslop new <slug>` with the question and evidence).

## Phase 4. Verify and report

- `backslop lint` is green; `backslop status` shows the seeded work.
- Report to the owner what was filled, where `[TODO]` and `[ASK]` remain, what entered the queue, which ADRs were recorded, and which candidates were rejected. Many `[ASK]` markers with sparse history are a correct outcome, not a defect.
- A repeated run follows the same order and closes only gaps.

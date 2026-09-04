---
name: backslop-task
description: The lifecycle of one backslop backlog task — who changes it, who verifies it, who accepts it, and when it moves to the archive. Always use when taking a queued task, closing a completed or rejected task, moving it to the archive, creating a triage finding, or reviewing triage. Triggers: “take a task”, “what is first in the queue”, “do a queued task”, “close a task”, “move it to the archive”, “create a finding”, “review triage”, “review inbox”, “defer a task”, and a task number in the form DA-N. Workers under an orchestrator use this too: it states the boundary a worker must not cross. Not for a complete worker run (`backslop-batch`) or documentation population after installation (`backslop-seed`).
---
<!-- backslop:generated -->

# backslop-task — one task lifecycle

The subject is one task from taking it to archiving it. Tracker rules are in `docs/backlog/README.md`; this file lays out the order by role and step. `npx github:Velklish/backslop#v0.3.1` is the command recorded in `backslop.json`; below it is simply called `backslop`.

## Two roles and one boundary

| Role | Who | Steps | What it must not do |
|---|---|---|---|
| worker | a single agent; a worker under an orchestrator | 1–4: implementation, documentation, gates | declare its own work accepted |
| approver | a single agent; an orchestrator under orchestration | 5–7: acceptance, archive, triage | write code for the worker |

A single agent performs both roles in sequence. The roles are separated for more than ceremony: under orchestration they are different contexts, and the approver sees what the author of the change does not.

**The boundary is at step 5.** A worker does not move task files between directories and does not touch `archive/` at all. Moving to the archive is an acceptance event; when performed by the author, it means “I accepted myself”. A real case: three tasks were archived before any review, and the owner had to restore them.

## Task flow

1. **Take a task.** `backslop status` shows the first queued task; its priority is the “Order” field. Whoever holds the queue moves it into `active/`: a single agent does `backslop mv N active`; an orchestrator does it while distributing briefs. A worker under an orchestrator does not touch directories.
2. **Change it.** Reverse a prior decision by clean removal, without strikethroughs. Preserve the style and structure of existing files. Use only terms from `docs/GLOSSARY.md`; if a necessary name is missing, propose it rather than silently inventing it. A code comment explains a limitation invisible from the code, not the history of a change: task number and date belong in git and the tracker.
3. **Document in the same pass.** An undocumented change is incomplete. Review the whole set, not only the obvious file: the applicable `docs/reference/` section, the affected subsystem README, CHANGELOG, and templates. If a changed text links to a neighbouring file, that neighbour belongs to the change. An architectural decision needs `backslop adr <slug>` plus a row in `docs/README.md`.
4. **Run gates before reporting, not after.** Commands in `gates` in `backslop.json`, including `backslop lint`, must be green. A red gate in a reported result costs an entire round-trip. Verify a test change with a mutation probe: break the code and make sure the test fails. **Commit first, then probe:** `git checkout <file>` removes all uncommitted work, not just one mutation. If the probe remains green, first ask whether the code path is live: a check that cannot be broken is dead code, not a coverage gap. If the path is live and the probe is green, the check input does not reach the property it claims to verify; fix the input, not the gate. Run gates on an unchanged tree: editing files during a run produces a red result with a misleading diagnosis.

   **Use a second probe where a gate has an early exit or cutoff**: a substring check before parsing, `return` on empty input, a guard before parsing. Breaking the code does not catch this: a broken detector fails positive checks, while a check that “does not fail on a false positive” remains green because its input never reaches the cutoff. Substitute the checked code with a naive edit guaranteed to produce false positives, then ensure false-positive checks fail too. If they do not, fix the input, not the gate.

5. **Acceptance and archive** are one approver pass (below).
6. **Triage review** happens immediately after acceptance (below).
7. **Commit.** Use `DA-N: <what was done>`; follow project rules for branch and MR or direct main. **A task reaches the outside as one commit**: taking it, review fixes, and acceptance are intermediate commits squashed before pushing (`git reset --soft <base>` and one commit, or a branch squash). Two tasks mean two commits, not one.

## What a worker does instead of closing

When the worker is finished, they **commit to their branch** and send the result through the channel supplied by the harness: an agent answer or a message to the orchestrator. The result must include:

- for every task, what was done and how it was verified;
- files touched beyond the obvious ones;
- gate results as numbers, not merely “green”: how many checks and files;
- **what remains open and where the worker worked around it** — this is more valuable than the rest because it determines whether to raise an isolated reviewer;
- findings outside the assigned scope — a neighbouring bug, a gap in rules, an unanswered question. Create them in the worker branch: `backslop new <slug> --parent N` puts a file in `triage/` without changing status directories. A verifiable fact in a finding includes evidence — a command or a file and line; grep takes seconds when already in the repository. If not verified, mark it as a hypothesis.

The worker does not push their branch or touch the repository’s main tree; the assignment does not override this.

## Acceptance and archive

The approver has passed the review gate and accepted the work. **The skill does not decide who reviews a diff.** Under orchestration, the orchestrator chooses using `backslop-batch`. Alone, ask the user with a survey offering at least two choices: regular review (subagent or a project review skill) or isolated review (a separate session with fresh context); list your recommendation first. Keep the chosen method for the whole task. Then do **all actions together in one pass**:

1. `backslop archive N` moves the file to `archive/<id>-<slug>/task.md`, rewrites links to it throughout the repository, and creates a `result.md` stub beside it.
2. Complete `result.md`: outcome (completed, rejected, or merged), exactly what was done, verification with numerical gates, mutation probe and live run, and documentation updated. While `[TODO]` remains, `backslop lint` fails — that is the reminder.
3. `backslop lint` is green; the acceptance commit names what closed: `DA-N: closed — <summary>`.

**A rejected task closes in the same way**, with its rejection reason in `result.md`. **A deferred task does not close:** run `backslop mv N deferred`, then give the “Deferred” section its reason and return condition; without them, `lint` fails.

## Triage review

After a task closes, review every entry accumulated during it. Not “when enough accumulate”: the finding author was a session that no longer exists, and no later pass can recover its context. There are two cadence points: this one and the full review before a worker run (`backslop-batch`). Both, and the review rules, are in `docs/backlog/README.md`.

Decide yourself: merge an obvious duplicate (`backslop archive N` with outcome “merged into M” in `result.md`, copying the entire content into the receiving task), clarify the wording, put it in the queue and choose its place (`backslop mv N queue --top | --after M`), or defer it with a return condition. Ask the owner **only before rejecting**: a finding discarded without asking will never be found a second time. Review finishes when `triage/` is empty or every remaining entry has a stated next step.

Before queueing a factual claim — a number, “covered by a test”, “printed by three commands” — verify it with evidence; incorrect facts create incorrect boundaries for the implementer. Rewrite unverified claims as hypotheses.

## Real failures

- **A worker declared its own work accepted** — three tasks reached the archive before any review, and the owner had to restore them. This is why the boundary is at step 5.
- **A finding sat in chat** until the owner reminded someone: record it in the same pass in which you read it, not “after acceptance”.
- **A task closed but triage was not reviewed** — entries with no next step lie dead and lose context faster than the queue advances.
- **A mutation probe before committing** removed an entire round of changes together with the mutation: `git checkout` does not distinguish them.

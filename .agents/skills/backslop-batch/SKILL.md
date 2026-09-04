---
name: backslop-batch
description: A worker run over the backslop backlog — split the queue into tracks, required brief contents, worker boundaries, the review gate and criterion for a second review round, branch integration, and acceptance. Use when taking several tasks in one run and assigning them to workers — subagents in worktrees, separate sessions, or bus participants — and when managing a running batch: a result arrived, review is being prepared, or a worker branch is being merged. Triggers: “assign tasks to workers”, “run the backlog”, “orchestrate the queue”, “do it in parallel”, “a worker result arrived”, “merge a worker branch”, “should a reviewer be raised a second time”. Not for one task alone (`backslop-task`).
---
<!-- backslop:generated -->

# backslop-batch — a worker run over the backlog

You are the orchestrator: the session that holds the queue, splits it into tracks, writes briefs, and accepts work. Do not write code for a worker — that removes the only reason to separate contexts. The one-task lifecycle in `backslop-task` fully applies; this file adds what appears when there are several tasks and workers. `npx github:Velklish/backslop#v0.3.1` is called `backslop` below.

A worker run is justified when the queue splits into **tracks** — directions that do not overlap in files. Two or three consecutive tasks in one subsystem are faster alone: launching a worker, briefing, and review cost more than the change itself.

## Three roles

| Role | Who | What it does |
|---|---|---|
| orchestrator | you | splits the queue, writes briefs, chooses the worker model, accepts work, moves statuses and archive |
| worker | a session in its own worktree | changes code from the brief, commits its branch, and sends results and findings |
| reviewer | an isolated read-only session | reads a diff with fresh context and does not fix findings |

## Before splitting — triage and consolidation

**Review triage in full before the run.** Review on task closure (`backslop-task`) does not replace this; it complements it. Entries from the previous run belong exactly to the subsystems you are about to split and can join this run’s tracks at no extra cost. Skip them and you hand them to the next run, which will visit the same files again. Rules are in `docs/backlog/README.md`.

**Also check the queue for consolidation.** Neighbouring tasks often prove to be one: the symptom is shared, causes differ, and the solution is one. Merge with `backslop archive N`, recording “merged into M” in `result.md`, and copy the content into the receiving task in full.

**A merge and a track are different.** A track groups tasks that change the same files while remaining distinct subjects: each has its own `result.md` and decision. Merge only when the subject is one. Tasks merged “for company” leave one archive report for two decisions, and after a month it no longer says what was done.

## Split the queue into tracks

One worker equals one subsystem, not one task. Tasks within a track share context; adjacent tracks do not overlap in files. Work that splits poorly stays with the orchestrator: tasks changing shared files — `AGENTS.md`, configuration, versions, or the whole CHANGELOG — create merge conflicts for no reason.

After distributing briefs, **move every assigned task to active work**: `backslop mv N active`. You hold directories; workers do not touch them at all. When the run ends and you have not accepted work, return it to the queue with `backslop mv N queue --top` or `--after M` so it does not lose its position.

## How to raise a worker

The harness supplies transport; the skill only states its requirements: a dedicated worktree and branch for each track, a self-contained brief, a channel for results and findings, and a ban on pushing or touching the main tree. Options:

- **an isolated Claude Code subagent** — the `Agent` tool with `isolation: "worktree"`; the brief is the subagent prompt and the result is its answer; select model and effort at launch;
- **a separate session** — `git worktree add ../<track> -b <track>` and an agent session in that directory; the first message is the brief and the answer or file is the result;
- **a session bus**, when available in the environment, under its own rules; it also owns reviewer and cleanup.

Choose worker model capability from the complexity of the portion, not a fixed tier: mechanics from a ready recipe use a smaller model with low effort; implementation from a precise brief uses the default; design and contract changes use a stronger model with high effort. When uncertain, take the higher row: another review round costs more than the model difference. Decide once, at launch.

## Brief

The first line is a 2–5 word track title; it becomes the worker session name so a person can identify the work. Then include all of the following:

- **task numbers with their definitions**, not only file links: the worker will read the files, but you know the run’s priority and boundaries;
- **change boundaries** — which directories belong to the worker and which belong to others. Name a neighbouring track: “`test/` is not yours; worker `tests` is working there”;
- **definition of done**: gates from `backslop.json` are green and documentation changes in the same pass;
- **an explicit request to commit to the worker branch** — do it immediately; commits are per task, prefixed `DA-N:`, including review fixes and the task’s CHANGELOG entry, so acceptance can squash by task;
- **a ban on status directories and `archive/`**, with the reason: the approver archives, the worker sends proposed result text. State the reason — without it, a worker tries to bypass the ban and reports a branch point;
- **findings as files**: `backslop new <slug> --parent N` in the worker branch, with evidence;
- **the mutation-probe order** as a condition: commit before the probe, probe afterwards — uncommitted means no probe; use the second probe for gates with early exits (`backslop-task`, step 4);
- **result contents** from the `backslop-task` checklist, separately calling out open edges.

The brief is self-contained: workers do not see your context or owner conversation.

## Worker boundaries

- Changes are only in the worker’s worktree; the main tree and pushing are always forbidden.
- The worker does not close tasks and does not touch status directories or archive.
- Findings are created as files in `triage/` in the worker branch and named in the result.
- The worker does not approach the owner directly: decision points go through you.

## Measurements during the run

Read [references/measurements.md](references/measurements.md) before a number from the run goes into a report or definition: live wall clocks measure neighbours, inspect a command’s exit code rather than a pipe’s, and an incomplete grep result looks as confident as a complete one. If you ask a worker to measure, the rule goes in their brief; only you read this skill.

## Review gate

When a worker sends a result, decide who reads the diff. An isolated reviewer costs a separate session and review rounds, so do not raise one for every result.

| What is in the diff | Who reviews | Reviewer effort |
|---|---|---|
| Contract or mechanism: CLI flags and output, config schema, public API, file format, version change, bulk deletion | reviewer, mandatory | high; maximum for migrations |
| Code without a contract change: new logic, files, tests | reviewer | default |
| Documentation and text only; a patterned change; one-screen diff with no code | orchestrator | — |
| Worker reports uncertainty, workaround, or open edge | reviewer regardless of size | default |

Risk is stronger than size: a one-line config-schema change goes to a reviewer, while two hundred moved documentation lines do not. When reviewing yourself, read the entire worker-worktree diff, not its description.

A reviewer is a read-only session with fresh context. Give it the diff and its base (the divergence point between worker branch and main). It sends findings but does not fix them. Send all findings to the worker in one message.

## Second review round

After findings are addressed, **you verify the diff** in your context: the findings are in front of you and another review round is the most expensive part of the run.

| Orchestrator review is enough | A second review round is required |
|---|---|
| Change stays strictly within a finding: replace text, restore a check, move a function | Change exceeds findings — touches neighbouring code or changes logic |
| Finding is mechanically verified: a test fails, `lint` is green, grep finds it | The change itself changes a contract — flags, format, or config schema |
| Worker supplied a mutation probe and result | Diff cannot verify closure: a run is needed in an environment you lack |
| Documentation and text; any minor finding | The finding was critical to a contract |

The signal in the right column is not finding severity but whether the correction can produce a new failure of the same class. Limit: two reviewer launches for one result or three review rounds without progress — stop the loop and go to the owner with the findings as they stand. A round closing all preceding findings is progress: fixes create a new surface and the next reviewer sees it.

## Integration and acceptance

1. **One commit per task:** `git merge --squash <worker-branch>` into the main branch; the message names the task and summary: `DA-N: <what was done>`; review-round history remains in `result.md`. For a track with several tasks, integrate by task when worker commits are separable by prefix; otherwise one commit per track lists the tasks. **Second and later tasks from the same branch are not integrated by another `merge --squash`; use `git cherry-pick -n <task commits>` and one commit**: a squash commit has no parent relation, so a second squash uses the branch point as base, reapplies the first task, and conflicts in all its files.
2. You resolve conflicts. They are usually in files shared by tracks. **Merge CHANGELOG** so entries from both sides remain; matching `- **…**` headings are one revised entry, not two — keep the new revision. Do not resolve conflict markers manually; build the file from both revisions (`git show HEAD:CHANGELOG.md` and `git show <worker-head>:CHANGELOG.md`) and put it in place. Section headings repeat in each release, so insert only into the unreleased section.
3. **Run gates after integration, not only for the worker:** two green branches can be red together. After the final acceptance commit, compare the tree with the worker head: `git diff HEAD <worker-head> -- <worker files>` must be empty. Otherwise a diff portion lost during conflict resolution reaches main silently.
4. Acceptance is in that commit: `backslop archive N`, `result.md`, and green `backslop lint`. Run gates before committing, on an unchanged tree.
5. Clean up in the same pass: `git worktree remove <path>`, `git branch -D <branch>`, and close worker and reviewer sessions using the harness mechanism.

## End of the run

Report to the owner what closed, what remains, and where decisions are needed. Ensure no live sessions or run worktrees remain.

---
name: diffalanche-apply
description: "Work through the review comments a human left in diffalanche — read the unanswered threads, read each one's anchor, group them by repository, get the human's confirmation on the plan, edit the code, and reply to every comment. Use when the user says \"apply the review\", \"fix the review comments\", \"address the diffalanche comments\", \"what is still unanswered\", \"разбери ревью\", or names a diffalanche review session or a comment id of the form `c_xxxxxx`. Not for opening new findings — that is diffalanche-review — and never for closing a thread: only a human resolves."
---

# diffalanche-apply

diffalanche holds one review over many git repositories under one root. A human
writes comments; you read them, fix the code, and answer. The CLI is the whole
contract — flags, output, and exit codes ([ADR-004]). The HTTP API is the UI's
and is not for you.

Command examples with real output are in [references/cli.md](references/cli.md).

## Before anything

Run the CLI from wherever it is installed: `diffalanche` on the path, `npx
diffalanche`, or `bun src/cli/index.ts` inside a clone. Every command below
takes the global flags **after** the command name — `diffalanche list --root
~/work`, never `diffalanche --root ~/work list`.

- `--root <dir>` — the directory under review; defaults to the current one. Set
  it whenever you are not standing in the root.
- `--review <name>` — a session other than the current one. Start with
  `diffalanche review list`: the `*` marks the current session, the one every
  command uses when `--review` is absent. A root can hold several sessions, and
  reading the wrong one looks exactly like reading the right one.

Exit code 0 is success, 1 is a user error with one line on stderr, 2 is a fault
with a stack trace. Do not retry a 1: it is an answer, and the message says
what was refused.

## Procedure

**1. Read the unanswered threads.**

```sh
diffalanche list --unanswered --json
```

`--unanswered` is the open threads whose last message is from a human: exactly
what no agent has answered yet. An empty array means there is nothing to do —
say so and stop. Without `--json` the same list is one line per comment, which
is what you show a human, not what you parse.

**2. Read each thread whole.**

```sh
diffalanche show c_j6v2hl --json
```

`list --unanswered --json` already carries the anchor and the replies, so a
second `show` is for one thread you want to look at closely, or for a comment id
the human named directly. Either way, read the `anchor` before you open the
file: `lineContent` is the line the comment was written against, `before` and
`after` are three lines of context each, and `hunk` is the header of the hunk it
sat in. If the file no longer says what `lineContent` says, the code moved under
the comment — find the line by its content, and say in your reply where you
found it.

**3. Group by repository and present the plan.**

The `repo` field is a path relative to the root; the file is at
`<root>/<repo>/<path>`. Group the threads by `repo`, and under each repository
list the comment id, the severity, the file and line, and one line on what you
intend to do — fix it, or decline it and why. Order the repositories by the
worst severity in each: `critical`, then `warning`, then `nit`, then `question`.

Not every thread has a file under it. A comment with `path: null` is about the
whole repository and goes in a "whole repository" group at the top of that
repository's list; a comment with `repo: null` is about the whole review and
gets a group of its own before the repositories. Both are answered like the
rest — they are the ones a plan grouped only by file silently drops.

**4. Stop and get confirmation.** This is a gate, not a formality: show the plan
and wait for the human to agree before you change a single file. A comment you
misread costs an edit in the wrong place, and diffalanche will not undo it —
the tool never writes to a reviewed repository, so nothing here is versioned by
it. If the human changes the plan, say back what changed and start from the
agreed version.

**5. Edit the code.** Work repository by repository, in `<root>/<repo>/<path>`.
Nothing about diffalanche changes here: use your ordinary editing tools, and
leave the repository's git state alone — no commits, no staging, no resets
unless the human asked for them separately.

Then check the edit the way that repository checks itself — its own build, lint,
or test command, whichever the human named or the repository obviously has. Do
not invent a toolchain to run, and do not report a fix as verified when nothing
verified it: what you ran, or that you ran nothing, belongs in the reply.

**6. Reply to every comment in the plan** — the ones you fixed and the ones you
declined, one `reply` each:

```sh
diffalanche reply c_j6v2hl --body - --author claude --role agent <<'EOF'
Typed the predicate: normalize187 now returns CargoItem | undefined and the
filter is a type guard, so CargoSet187 no longer admits undefined.
EOF
```

- `--body -` reads all of standard input, which is how a body with newlines in
  it gets past the shell. `--body <text>` is for a one-liner.
- `--author` is your own name, and `--role agent` is what you are. Both are the
  defaults (`agent`, `agent`), but naming yourself is what lets a human tell two
  agents apart in the thread and in the activity feed.

**Reply rules.** One or two sentences when the issue is fixed: what you changed,
not how you feel about it. The full reasoning when you decline: what the comment
asked, why the code is right as it stands or why the fix costs more than it
saves, and what you would need to change your mind. A declined comment is a
conversation, and the human reads only what you wrote.

**7. Never close a thread.** `resolve` and `reopen` are the human's; they need
`--role human` and refuse anything else with exit code 1, changing nothing. Do
not pass `--role human` to make them work — that is impersonating the reviewer.
A thread you answered stays open until the human verifies it; that is what
"awaiting" means on their side.

**8. Check yourself.**

```sh
diffalanche list --unanswered --json
```

`[]` means every thread in the plan has your reply on it. Anything left is a
comment you skipped: either answer it or tell the human why you did not.

## Several agents on one review

One review session takes any number of agents. Split by repository and sign
your work:

```sh
diffalanche list --unanswered --repo repos/core/cargos-api --json
diffalanche reply c_eft2jg --body "Fixed the typo." --author claude --role agent
```

`--repo` on `list` narrows to the repositories the session's comments name — a
repository nobody commented on is exit code 1, not an empty list. `--author` is
what separates you from the other agent in the thread. Every write goes through
a lock on the session, so two agents replying at the same moment both land.

## What this skill does not do

- It does not open new findings. That is [diffalanche-review](../diffalanche-review/SKILL.md).
- It does not resolve, reopen, or delete anything.
- It does not create or switch review sessions: `review new` and `review use`
  change what the human's UI is looking at. Use `--review <name>` instead if you
  need a session that is not the current one.

[ADR-004]: https://github.com/Velklish/diffalanche/blob/main/docs/adr/adr-004-agent-contract.md

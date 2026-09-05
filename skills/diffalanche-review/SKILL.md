---
name: diffalanche-review
description: "Review the change set diffalanche holds — read the diff of every repository under the root and open findings as comments anchored to the lines that carry them. Use when the user says \"review the diff\", \"review my changes\", \"review this branch in diffalanche\", \"check the change set\", \"оставь замечания по диффу\", or asks one agent to review another agent's work in a diffalanche review session. Not for answering comments a human already wrote — that is diffalanche-apply — and never for closing a thread: only a human resolves."
---

# diffalanche-review

diffalanche shows the changes of every git repository under one root as a single
review. This skill reads that change set and writes findings into it, so a human
opens the review and sees them anchored to the lines they are about. It works
for a self-review of what you just wrote and for a review of another agent's
work. The CLI is the whole contract — flags, output, and exit codes
([ADR-004]).

Command examples with real output are in [references/cli.md](references/cli.md).

## Before anything

Run the CLI from wherever it is installed: `diffalanche` on the path, `npx
diffalanche`, or `bun src/cli/index.ts` inside a clone. Global flags go **after**
the command name — `diffalanche diff --root ~/work`, never `diffalanche --root
~/work diff`.

- `--root <dir>` — the directory under review; defaults to the current one.
- `--review <name>` — a session other than the current one. Start with
  `diffalanche review list`: the `*` marks the current session, the one `diff`
  and `comment` use when `--review` is absent. Findings written into the wrong
  session are invisible in the one the human has open.

Exit code 0 is success, 1 is a user error with one line on stderr, 2 is a fault.

## Procedure

**1. Read the change set.**

```sh
diffalanche diff --json
diffalanche diff --repo repos/core/cargos-api --json
```

`--json` gives every repository with its files, and every file with `patch` and
with `hunks` — the structured form, where each line carries `type`
(`context`, `insert`, `delete`), `content`, `oldLine`, and `newLine`. Those line
numbers are what you anchor a comment to, so read `hunks`, not the raw patch.

A file with `omitted` set to `binary` or `too-large` is listed without content;
there is nothing in it to review. `--repo <path>` narrows the printed set to one
repository — a path no repository is at is exit code 1.

Without `--json`, `diff` prints a unified patch for reading. It is not a patch
to apply: every repository's files are `a/…` and `b/…`, so two repositories in
one output collide.

**2. Read enough of the file to be right.** A hunk shows three lines of context.
Whether a null check is missing, whether a name shadows another, whether the
caller already guards — none of that is in the hunk. Open
`<root>/<repo>/<path>` and read around the change before you write a finding.
An anchored comment that is wrong costs the human more than a finding you did
not write.

**3. Open one comment per finding.**

```sh
diffalanche comment --repo repos/core/cargos-api --path src/route/route-200.ts \
  --line 61 --severity warning --author claude --role agent --body - <<'EOF'
filter(Boolean) does not narrow the element type, so CargoSet187 still admits
the undefined that normalize187 can return.
EOF
```

`--body -` reads all of standard input, which is how a finding with newlines in
it gets past the shell; `--body <text>` is for a one-liner.

The anchor is built from the flags, narrowest first:

| Flags | Where the comment lands |
|---|---|
| none | the whole review |
| `--repo R` | that repository |
| `--repo R --path P` | that file |
| `--repo R --path P --line N` | that line |
| `… --line N --end-line M` | that range of lines |

`--side new` is the default and is the side you almost always want; `--side old`
anchors to a line that the change removed. The tool fills the rest of the anchor
— the line's text, its hunk header, and three lines of context each way — by
reading the repository again, so the anchor points at the line that is there
now. `comment` prints the new comment's id as the first word of its line.

`--severity` is one of four and it is not decoration:

- `critical` — the change is wrong: data loss, a crash, a security hole, a
  contract broken for a caller.
- `warning` — it works and it will hurt: a race, an unhandled failure, a type
  that lies, a performance cliff.
- `nit` — a small, certain, cheap fix: a typo, a name, dead code.
- `question` — you do not know enough to call it, and the author does.

Do not open a `critical` you cannot show the failure for. One finding is one
comment; a finding about the change as a whole is a comment with no `--repo` at
all, on the review.

**4. Sign your work.** `--author` is your own name and `--role agent` is what
you are; both default to `agent`. When two agents review one session, each one
signs with its own `--author` and narrows with `--repo` so they do not review
the same repository twice.

**5. Never close a thread.** `resolve` and `reopen` need `--role human` and
refuse anything else with exit code 1, changing nothing. Do not pass `--role
human` to make them work. A finding you opened stays open until the human
verifies it; if the author is another agent, it answers with
[diffalanche-apply](../diffalanche-apply/SKILL.md), which cannot close it
either.

**6. Show what you opened.**

```sh
diffalanche list
diffalanche list --severity critical
```

`list` with no flags is the open comments of the session, one line each: id,
severity, status, anchor, author, and body. Read it back and tell the human how
many findings you opened and at what severity, so they know what they are
walking into. `--severity` narrows it to one of the four.

## Reviewing another agent's work

Nothing changes except who reads the reply. Open findings the same way; the
other agent answers them with `reply`, and the human decides whether the answer
holds. Neither of you resolves. Sign with an `--author` a human can tell from
the author's, or the thread reads as one agent arguing with itself.

## What this skill does not do

- It does not answer comments. That is [diffalanche-apply](../diffalanche-apply/SKILL.md).
- It does not edit code. A review that fixes what it finds leaves the human
  nothing to review.
- It does not resolve, reopen, or delete anything.

[ADR-004]: https://github.com/Velklish/diffalanche/blob/main/docs/adr/adr-004-agent-contract.md

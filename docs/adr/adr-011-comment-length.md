# ADR-011: A code comment is at most two lines, and longer knowledge lives in docs

**Status:** Accepted
**Date:** 2026-09-11
**Deciders:** Velklish

## Context

The repository comments heavily and at length. Counted over `src/`, `tests/`,
`e2e/`, `perf/` and `scripts/` — 167 files, 31 842 lines:

```
find src tests e2e perf scripts -name '*.ts' -o -name '*.tsx' -o -name '*.css' | xargs awk '
/^[[:space:]]*\/\*/ {b=1; n=0}
b {n++; if (/\*\//) {if (n>2) c++; b=0}; next}
/^[[:space:]]*\/\// {s++; next}
{if (s>2) c++; s=0}
END {if (s>2) c++; print c}' | awk '{t+=$1} END {print t}'
```

720 comment blocks run longer than two lines: 474 JSDoc, 209 runs of `//`, 37
other `/* */`. They hold 4 161 lines — 13.1 % of the repository.

Length is not the complaint. The complaint is *where* the knowledge sits. A
decision recorded only above the code it affects is found by whoever opens that
file and by nobody else: `RUNNER_ALLOWANCE = 2.5` in
[perf/budgets.ts](../../perf/budgets.ts) carries eight lines explaining a
measurement on a GitHub runner, and a reader asking "why does CI use a different
budget" has no way to reach it except by guessing the file. The same knowledge
in [docs/reference/11-perf.md](../reference/11-perf.md) is reachable from the
index, survives the function being moved, and is read by the tools the project
already points people at.

The second cost is drift. A long comment is prose next to code, and prose next
to code is not checked by anything. The reference is checked: the project's own
rule already says a token that changes in `src/ui/tokens.css` changes in
`DESIGN.md` in the same pass, and an undocumented change is incomplete. Comments
have had no such rule, so a comment and its code diverge silently.

## Options

- **Leave it.** The status quo: knowledge lands wherever the author was typing.
  Rejected — it is the state this ADR is about.
- **A limit with an exception for "real" knowledge.** Two lines by default,
  longer when the comment records a decision the code cannot state. Rejected: the
  exception is the whole population. Every one of the 720 blocks was written
  because its author judged it to carry knowledge, so a rule keyed on that
  judgement changes nothing and cannot be checked.
- **Exempt JSDoc over exported symbols.** Two lines for inline `//`, contract
  documentation free. Rejected: 474 of the 720 blocks are JSDoc, so the rule
  would miss the two-thirds where the drift and the unreachable decisions
  actually are.
- **Two lines everywhere, knowledge relocated.** Chosen.

## Decision

- A comment in code — `//`, `/* */` or JSDoc, in `.ts`, `.tsx`, `.css`, `.yml`
  and shell scripts — is **at most two lines**. This holds for `src/`, `tests/`,
  `e2e/`, `perf/`, `scripts/` and `.github/`.
- A comment says *why*, in one breath. What the code does, the code says.
- Knowledge that does not fit goes to its [reference](../reference/README.md)
  section, or to an ADR when it is a decision. The comment that remains is the
  pointer: one line of why, one link.
- Documentation is unaffected. `*.md` — the reference, ADRs, task files,
  `README.md`, `DESIGN.md` — is prose and has no line limit.

## Consequences

- 720 blocks are out of compliance the day this is accepted. Bringing them in is
  [DA-58](../backlog/queue/DA-58-comment-sweep-to-two-lines.md), which also turns
  the count above into a gate; until then the rule binds new and edited code
  only.
- `docs/reference/` grows. That is the point: the sections become the place the
  subsystem's gotchas live, rather than a summary of code whose details are
  elsewhere.
- A relocation that loses the knowledge is a worse outcome than a long comment.
  The sweep moves text; it deletes only what restates the code.
- Reviewing a change gets a mechanical check it did not have. "This comment is
  four lines" is decidable; "this comment is too long" was not.

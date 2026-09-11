# DA-57 · Code comments are at most two lines, and longer knowledge lives in docs

- **Order:** 16
- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The repository comments at length, and the length is not the problem — the place
is. Counted over `src/`, `tests/`, `e2e/`, `perf/` and `scripts/` (167 files,
31 842 lines):

```
find src tests e2e perf scripts -name '*.ts' -o -name '*.tsx' -o -name '*.css' | xargs awk '
/^[[:space:]]*\/\*/ {b=1; n=0}
b {n++; if (/\*\//) {if (n>2) c++; b=0}; next}
/^[[:space:]]*\/\// {s++; next}
{if (s>2) c++; s=0}
END {if (s>2) c++; print c}' | awk '{t+=$1} END {print t}'
720
```

720 blocks run longer than two lines — 474 JSDoc, 209 runs of `//`, 37 other
`/* */` — holding 4 161 lines, 13.1 % of the repository.

Two things follow. A decision recorded only above the code it affects is
reachable only by whoever opens that file: the eight lines above
`RUNNER_ALLOWANCE = 2.5` in [perf/budgets.ts](../../../perf/budgets.ts) answer
"why does CI use a different budget", and nothing in the reference points there.
And prose beside code is checked by nothing, so it drifts — while the project
already requires the opposite of its documentation, down to a token in
`src/ui/tokens.css` changing in `DESIGN.md` in the same pass.

This task records the rule. It does not bring the 720 blocks into line; that is
[DA-58](../../backlog/queue/DA-58-comment-sweep-to-two-lines.md).

## Work to do

- Write the decision as an ADR: the count, the options weighed (leave it; a
  limit with an exception for real knowledge; exempt JSDoc; two lines
  everywhere), and the consequences.
- Add the rule to the "Rules for every change" list in `AGENTS.md`, pointing at
  the ADR and naming DA-58 as the reason the repository is not yet in
  compliance.
- Add the ADR to the table in `docs/README.md` and the change to `CHANGELOG.md`.

## Out of scope

- Rewriting any existing comment. The rule binds new and edited code from the
  day it is accepted; the sweep is DA-58.
- A gate. The check cannot be green while 720 blocks violate it, so it is turned
  on by the sweep that empties the count, not by the task that writes the rule.
- Markdown. The reference, ADRs, task files and `README.md` are prose and carry
  no line limit.

## Verification

- `docs/adr/adr-011-comment-length.md` exists, is listed in `docs/README.md`, and
  states the rule and its scope.
- `AGENTS.md` carries the rule in its rules list with a link to the ADR.
- `npx github:Velklish/backslop#v0.4.0 lint` is green — the ADR is indexed and
  the links resolve.

# DA-36.2 · Severities the model chose vote again in later suggestions

- **Scope:** 09-ml
- **Created:** 2026-09-24
- **Parent:** DA-36
- **Cost:** minor

## Evidence

Finding discovered while working on DA-36. A comment sent with `AUTO` stores the
neighbours' vote as its `severity`, with `severitySource: "auto"`. The index
entry keeps the severity and not its source:

<!-- quote:before:../../../src/core/ml/index/store.ts -->
export type IndexEntry = {
  session: string;
  id: string;
  severity: Severity;
<!-- /quote -->

and the vote counts every neighbour's severity alike:

<!-- quote:before:../../../src/core/ml/suggest/index.ts -->
    weights.set(one.severity, (weights.get(one.severity) ?? 0) + weight);
<!-- /quote -->

So a label the model gave, and nobody has confirmed yet, is one more vote for
the same label the next time a similar text is typed: a history written with
`AUTO` confirms itself. Whether that matters depends on how often reviewers leave
`AUTO` on and how often agents confirm; nothing measures either today. Options
are to leave unconfirmed `auto` comments out of the vote, or to weigh them
lower — both need the source in the index entry, which is the index's format.

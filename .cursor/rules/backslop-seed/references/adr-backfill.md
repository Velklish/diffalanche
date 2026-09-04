<!-- backslop:generated -->
# ADR backfill: recording decisions that were already made

Read in phases 2–3 of the `backslop-seed` skill. The first ADR, about the process itself, already exists after `backslop init`; this file covers the rest.

## How many and which

- **3–5 decisions**, not the entire history. Criterion: the decision still constrains changes — replacing it is expensive, and the next reader will ask “why this way?” Framework, store, broker, API format, and layering are typical candidates. Minor choices and tool defaults are not.
- Show the owner the complete list of candidates with evidence **before writing**, using a multiple-choice survey. The owner determines whether an event was a decision or historical accident.
- A decision whose rationale cannot be reconstructed is recorded only on the owner’s word — and then honestly: “the reason is lost; recorded from the code state as of <date>”.

## Form of a retrospective record

- Run `backslop adr <slug> --title "…"`, then in the file:
  - **Status:** Accepted; **Date:** the original decision date from git history (the commit where the choice appeared), not today;
  - **Deciders:** who decided, according to the owner; if unknown, “not established”;
  - the first sentence of **Context**: “Recorded retrospectively on <today>; the decision has applied since <date>.”;
  - **Options** only where alternatives are known to have been considered; if unknown, “alternatives could not be reconstructed”;
  - **Decision:** what was selected, with evidence: manifest, configuration, or directory;
  - **Consequences:** what the decision still constrains — the most valuable part of a retrospective record.
- Add a row to `docs/README.md` in the same pass; without it, `backslop lint` fails.

## Do not

- Do not rewrite history: an ADR is not edited into how it should have been. If the decision changed, create a new ADR linking to the old one and mark the old one “superseded”.
- Do not invent decoration: Decision Drivers and Pros/Cons that nobody weighed are more harmful than an empty section.
- Do not create an ADR for a future decision from this skill — an open question becomes a file in `triage/`, and an ADR appears once the decision is accepted.

## ADRs in another format

If ADRs are found in another directory or template, ask the owner whether to move them into `docs/adr/` while preserving numbers and dates (then backslop continues their numbering), or leave them in place and link them from the index. Two parallel decision logs are the worst of the three choices.

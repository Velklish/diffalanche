# DA-112 · Result

**Closed 2026-09-22. Done.** `AGENTS.md` now states what section 5 of the spec may contain:
behaviour the user and the agent can reach, plus contracts — the on-disk format, the CLI, budgets
as numbers — with components, module paths and descriptions of the current build going to the
reference or to an ADR.

**No gate, and the reason is measured.** Section 5 is 51 lines with eight backticked tokens, five
distinct, and all five are contract values (`--review`, `current`, `orphaned`, `unanswered`,
`warning`). A check keyed on identifiers is green on that text and on any text whose prose about
internals avoids backticks — it would report coverage it does not have. The rule says so itself.

**Checks.** `npx github:Velklish/backslop#v0.9.0 lint` — exit 0. `bun run lint` — exit 0 (docs
only; no TypeScript touched).

**Docs in the same pass.** The change is the documentation: `AGENTS.md`. No CHANGELOG entry — the
tool's behaviour is unchanged.

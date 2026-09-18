# DA-108 · An agent's reply under a comment runs to paragraphs where two sentences would do

- **Scope:** 10-skills (see [reference](../../reference/README.md))
- **Created:** 2026-09-18
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

From the owner's real reviews, 2026-09-18: an agent working through comments
with `skills/diffalanche-apply` answers a fixed finding with several
paragraphs — the comment restated, the diagnosis, the change, how it was
checked, a closing line. The owner reads the thread to learn one thing, whether
the finding is closed and by what, and has to find it inside the prose.

The skill's reply rules
([skills/diffalanche-apply/SKILL.md](../../../skills/diffalanche-apply/SKILL.md),
"Reply rules") say "one or two sentences when the issue is fixed" and "the full
reasoning when you decline". The second half is the licence a model takes for
every reply, and the first half has nothing to imitate: the examples in
[references/cli.md](../../../skills/diffalanche-apply/references/cli.md) show a
one-line fix and a decline that reads `Declined, and here is why. …`. The same
wording is the contract in `docs/SPEC.md` section 9 and in
`docs/reference/10-skills.md`.

The owner's rule: at most two or three sentences in any reply, fewer for a
plain fix, and every sentence carrying something.

## Work to do

- Rewrite the reply rules of `diffalanche-apply` as a cap: a reply is at most
  three sentences. A fixed finding is one sentence — what changed — and a second
  only when the fix touched something the comment did not name. A declined
  finding is three: what stands, why, what would change the answer. Nothing
  restates the comment, opens with a greeting or "I have", or closes with an
  offer; the check that was run is a clause, not a paragraph; a reply body has
  no headings and no lists.
- Put a before-and-after pair in the skill — a reply of the kind the owner
  reads today and its two-sentence form — so the target is visible, not
  described.
- Bring every reply example in `references/cli.md` to the same form, the
  decline included.
- Change the contract where it is written: `docs/SPEC.md` section 9 and
  `docs/reference/10-skills.md` say the cap. `CHANGELOG.md`.

## Out of scope

- The bodies of findings `diffalanche-review` opens: a finding has to carry
  evidence, and its length is a different question.
- The plan the skill presents before editing (step 3): the owner asked about
  replies.
- The copies of the skills outside this repository: they are refreshed by hand
  from `skills/` after the change lands.

## Verification

- Every reply example in `skills/diffalanche-apply/SKILL.md` and
  `references/cli.md` has three sentences or fewer; the fixed-finding examples
  have one or two.
- A dry run: a fresh agent session given the skill, a comment on a real file and
  the instruction to fix and reply, produces a reply of three sentences or
  fewer for a fix and for a decline. The replies go into `result.md`.
- `grep -n "one or two sentences" docs skills` finds nothing: the old wording is
  gone everywhere it was.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.

# DA-49 · Insights screen

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-48

## Context

`docs/design/HANDOFF.md` section 11: a separate screen — header with period segments and a summary, a 440 px cluster list with frequency bars, trend words, severity dots, and a "more clusters" block; a detail column with the model label chip, explanation, per-repository bars, examples with `open`, and a footer with `Open N comments` and `Save as a rule for the agent`. Labels are the model's, numbers are exact, and the screen says so.

## Work to do

- `/insights` route in the UI fed by `GET /api/insights?since=`; every element of section 11 with the handoff's tokens.
- `open` on an example navigates to its session, file, and line; `Open N comments` filters the rail by cluster; `Save as a rule` opens an editor prefilled with the label and explanation and appends the rule to `skills/diffalanche-review/references/rules.md` through a write route.

## Out of scope

- Editing clusters by hand.

## Verification

- Playwright with fixture insights: clusters render with counts equal to `insights --json`; `open` lands on the comment; saving a rule appends it to the skill file; the label chip reads `MODEL LABEL`.

## Deferred

- **Deferred:** 2026-09-29
- **Reason:** Depends on DA-48, which is deferred, and is a UI screen whose change needs the Impeccable context loader, which cannot run in the cloud session.
- **Return condition:** DA-48 is archived, and a session where the Impeccable launcher runs.

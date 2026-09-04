# DA-36 · Composer suggestions and automatic severity

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-35

## Context

`docs/design/HANDOFF.md` section 2 and "Automatic severity": the `FROM YOUR HISTORY` list under the composer ranked as the user types, ↑ / ↓ to select, TAB to accept text and severity; the `AUTO · <prediction>` chip selected by default, the thread marked `auto` until an agent confirms it and then `labelled by <agent>`. `docs/SPEC.md` section 5 Phase 2.

## Work to do

- Suggestions panel in the composer fed by `GET /api/suggest` with debounce; keyboard handling per the handoff.
- `AUTO` chip: when selected, the severity comes from the proposal at send time; the on-disk comment gets `severitySource: "auto" | "manual" | "confirmed:<author>"`; the spec's section 7 is amended in the same pass.
- Thread markers `auto` and `labelled by <agent>`; an agent's reply confirms the label (CLI `reply --confirm-severity`).

## Out of scope

- The generative rewrite (DA-47).

## Verification

- Playwright: typing three words lists suggestions from the fixture history; TAB fills the field and selects the severity; sending with AUTO stores `severitySource: auto`; an agent reply with `--confirm-severity` changes the marker.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.

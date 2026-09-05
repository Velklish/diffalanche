# DA-36 · Composer suggestions and automatic severity

- **Order:** 360
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-35

## Context

`docs/design/HANDOFF.md` section 2 and "Automatic severity": the `FROM YOUR HISTORY` list under the composer ranked as the user types, ↑ / ↓ to select, TAB to accept text and severity; the `AUTO · <prediction>` chip selected by default, the thread marked `auto` until an agent confirms it and then `labelled by <agent>`. `docs/SPEC.md` section 5 Phase 2.

## Work to do

- Suggestions panel in the composer fed by `GET /api/suggest` with debounce; keyboard handling per the handoff.
- `AUTO` chip: when selected, the severity comes from the proposal at send time; the on-disk comment gets `severitySource: "auto" | "manual" | "confirmed:<author>"`; the spec's section 7 is amended in the same pass.
- Thread markers `auto` and `labelled by <agent>`; an agent's reply confirms the label (CLI `reply --confirm-severity`).

## What Phase 1 changed

Phase 1 built the composer this task extends (DA-22: `src/ui/components`, the four anchor levels, `⌘⏎` and `esc` on the document) and the keyboard map (DA-26: `src/ui/keys.ts`). The three rows this task wires — `↑` / `↓` and `TAB` in the composer — are named there as unwired with DA-35 as the reason, and in the table of [08-ui.md](../../reference/08-ui.md). `severitySource` amends the on-disk format: the domain types in `src/core/domain` are the pure leaf, the UI re-exports them (`src/ui/types.ts`), and `docs/SPEC.md` section 7 and `03-storage.md` change in the same pass. Any UI change runs the Impeccable context loader first (AGENTS.md); tokens live in `DESIGN.md` and `src/ui/tokens.css` as one pair guarded by `tests/design-tokens.test.ts`.

## Out of scope

- The generative rewrite (DA-47).

## Verification

- Playwright: typing three words lists suggestions from the fixture history; TAB fills the field and selects the severity; sending with AUTO stores `severitySource: auto`; an agent reply with `--confirm-severity` changes the marker.


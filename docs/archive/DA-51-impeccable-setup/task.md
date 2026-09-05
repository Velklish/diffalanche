# DA-51 · Impeccable in the project: product truth, design system, hook

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-19
- **Taken:** 2026-09-05

## Context

The owner asked (2026-09-05) to connect Impeccable — the design skill installed at the user level of Claude Code (`~/.claude/skills/impeccable`) — to this project. Impeccable reads project artifacts to keep UI work on-brand: `PRODUCT.md` (durable product truth), `DESIGN.md` (the incumbent visual system in the DESIGN.md format), a surface brief per screen, and a per-project design detector hook that runs after UI file edits. None of them exist here; the visual truth lives in `docs/design/HANDOFF.md` and, after DA-19, in `src/ui/tokens.css`. The remaining UI tasks (DA-20 to DA-27) are the audience.

## Work to do

- `PRODUCT.md` at the repository root through the skill's `init` flow, filled from `docs/SPEC.md` sections 1, 2, and 11 (purpose, landscape, non-goals), the users named there, and platform `web`; the interview questions the flow asks are answered by the orchestrator from those documents, and the draft is confirmed by the owner before it is written as final.
- `DESIGN.md` at the repository root through the skill's `document` flow in scan mode over `src/ui/tokens.css`, `src/ui/fonts.css`, and `docs/design/HANDOFF.md`: tokens in the frontmatter (both themes), the eight sections in canonical order, the qualitative language (creative north star, colour names, elevation philosophy) proposed from the handoff and confirmed by the owner.
- A surface brief for the review screen (`src/ui/App.tsx`) in Operate mode, through the skill's mechanism for surface briefs.
- The design detector hook on for this project: `.impeccable/config.json` committed with `hook.enabled: true`; manifests for the three harnesses the repository declares in `backslop.json` — Claude Code (`.claude/settings.local.json`, gitignored, so name the install step in README), Cursor (`.cursor/hooks.json`), Codex (`.codex/hooks.json`) — committed where the skill commits them. `.impeccable/config.local.json` in `.gitignore`. Biome ignores `.impeccable/`.
- `AGENTS.md` of the repository gets a rule for UI changes: a UI task starts by running the skill's context loader, follows `DESIGN.md` over the prototype for tokens, and runs the skill's `audit` and `polish` passes on the touched surface before reporting; findings the pass does not fix are named in the result.
- `README.md` development section: what the artifacts are and how to enable the hook locally; `docs/reference/08-ui.md`: one paragraph naming `DESIGN.md` as the token authority beside the handoff; `CHANGELOG.md`.

## Out of scope

- Redesigning anything: `document` records the incumbent system, it does not change it. Running `polish` or `audit` on existing screens (DA-20 to DA-27 do that in their own passes).
- The Impeccable live mode and its CSP patch.

## Verification

- `node ~/.claude/skills/impeccable/scripts/context.mjs --target src/ui/App.tsx` run from the repository root prints `PRODUCT.md`, `DESIGN.md`, and the review-screen brief, and no `NO_PRODUCT_MD` line.
- `node ~/.claude/skills/impeccable/scripts/hook-admin.mjs status` reports the hook enabled with the shared config path inside the repository.
- An edit to a `.tsx` file under `src/ui` in a Claude Code session with the hook installed produces the detector's reminder (recorded as the transcript line in `result.md`).
- `DESIGN.md` frontmatter colours equal the values in `src/ui/tokens.css` for both themes (checked by a script or by hand, listed in `result.md`).
- All gates in `backslop.json` stay green.

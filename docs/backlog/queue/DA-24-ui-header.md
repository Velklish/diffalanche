# DA-24 · Header: sessions, base picker, counters, export, warnings

- **Order:** 240
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-19

## Context

`docs/design/HANDOFF.md` section 1.1 (header), 1.2 (scanner warnings bar), 5 (base picker with `head`, `branch` with candidates from `origin`, `upstream`, `local`, and `ref` with a free field), 7 (sessions menu with metrics and a create form), 9 (`Export .md` modal with `rendered` / `raw` and `Copy .md`). `docs/SPEC.md` section 5: create, switch, list sessions; change the base including the branch; counters for open and awaiting; copy the export. Budget: session switch 100 ms.

## Work to do

- Session pill and menu: list from `GET /api/sessions` with metrics, `CURRENT` chip, create form with name and base; switching calls `use` and reloads the bundle.
- Base picker: three modes; the `branch` list of candidates comes from a new `GET /api/repos/branches` summarising remote and local branches across repositories; `Apply` calls the base route and refreshes; toast on success.
- Counters `N open` and `N awaiting you` with the click filter on the rail.
- Export modal: rendered markdown and raw source from `GET /api/export`; `Copy .md` writes the raw markdown to the clipboard.
- Scanner warnings bar from the bundle's warnings with `dismiss` per session in the store.
- Status bar content: hotkey hints and the current context line.

## Out of scope

- Global search (DA-26); demo-state switcher of the prototype (not a product feature).

## Verification

- Playwright: creating a session from the menu makes it current for `diffalanche list` without `--review`; switching sessions swaps the thread set within 100 ms in the perf harness; changing the base to `branch:origin/develop` on the fixture updates the repository header line; the export's raw text equals `diffalanche export`.

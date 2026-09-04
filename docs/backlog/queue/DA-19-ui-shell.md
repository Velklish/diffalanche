# DA-19 · UI shell: tokens, themes, layout, store

- **Order:** 190
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-3

## Context

`docs/design/HANDOFF.md`: design tokens for dark (default) and light themes, typography (Instrument Sans, JetBrains Mono, bundled locally for offline use), spacing and radii, the review workspace layout — header 52 px, sidebar 308 px, centre, right column 392 px, status bar 30 px, minimum width 1560 px with horizontal scrolling below it — and the skeleton shown while the server responds. State goes into a store ([ADR-002](../../adr/adr-002-stack-and-delivery.md): zustand) split as in the handoff's "State Management".

## Work to do

- `src/ui`: Vite + React app on the DA-3 skeleton; CSS variables for every token of both themes on the root element; theme toggle in the header persisted in `localStorage`; fonts as local assets with the fallback stacks.
- Layout components: header, sidebar, centre panel, right column, status bar with the fixed widths and the 1560 px threshold; overlay and toast primitives; `dcin` and `dcpulse` animations.
- zustand store with slices named as in the handoff: theme and base, sessions, navigation, commenting, threads, search and overlays, feed, scanner.
- Loading skeleton: header fully rendered, sidebar with placeholder rows, one empty file card; no spinner, no layout jump after data arrives.
- Data loading: one `GET /api/review` on open into the store; the logo and favicon built from markup and an inline SVG as the handoff specifies.

## Out of scope

- Any real content of the panels (DA-20 to DA-27).

## Verification

- Playwright screenshot tests of the empty shell in both themes match approved baselines.
- Panel widths measured in the test are 308 and 392 px at 1560 px viewport, and the page scrolls horizontally at 1400 px.
- Fonts load with no network request outside `127.0.0.1` (asserted through Playwright's request log).

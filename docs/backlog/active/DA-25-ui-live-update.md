# DA-25 · Live update and activity feed in the UI

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-18, DA-21, DA-23
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 5: the review updates by itself when code or comments change, without a reload and without losing the reading position. `docs/design/HANDOFF.md` "Performance & live update": no flicker, only affected lines and threads change, a changed hunk gets an accent border and `updated Ns ago`, the composer stays open; section 4: the AGENT ACTIVITY panel, collapsed by default, relative times refreshed every 5 s. Budget: 300 ms after an edit in one repository.

## Work to do

- `EventSource` client for `/api/events` with reconnect and `Last-Event-ID`; the sidebar footer reflects the connection state.
- Event handlers: `diff-changed` fetches that repository's diff and patches the store by file and hunk identity so unchanged cards keep their DOM; `comment-added`, `reply-added`, `comment-status` fetch the comment and patch the thread; `session-changed` reloads the bundle; `warnings` updates the bar.
- Scroll anchoring: the reading position is preserved when content above changes; the composer and its selection survive a patch of another file and are re-validated for the same file.
- Changed-hunk marker with the relative time; `dcin` animation on new threads and events.
- Activity panel fed by `activity` events with the ring buffer on connect; toasts for agent replies.

## Out of scope

- Re-anchoring of comments after edits (DA-42); the MVP shows a warning when a commented line disappears.

## Verification

- Playwright: `diffalanche reply` from a shell appears in the rail without a reload and raises `awaiting you`; editing a fixture file updates the hunk within 300 ms in the perf harness, the scroll position measured before and after differs by less than one line height, and an open composer on another file stays open; the activity panel shows `<author> replied in <file>`.
- No full re-render of file cards on an event, asserted by DOM node identity in the test.

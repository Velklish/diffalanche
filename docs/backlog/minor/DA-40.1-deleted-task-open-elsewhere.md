# DA-40.1 · A task deleted elsewhere leaves another window's menu stale and a window on it failing

- **Scope:** 05-watcher, 08-ui
- **Created:** 2026-09-24
- **Parent:** DA-40
- **Cost:** minor

## Evidence

Finding discovered while working on DA-40, by reading the code; not reproduced in
a browser. The window that deletes a task moves itself (`deleteTask` in
`src/ui/store.ts`). Another window hears nothing of the deletion as history news:
the watcher compares the statuses of the sessions it lists, and a session that is
no longer listed produces no frame, because `sessions-changed` carries a
`status` and there is none for "gone":

<!-- quote:../../../src/core/watcher/index.ts -->
    for (const [name, status] of next) {
      if (sessions.get(name) !== status) bus.emit({ type: "sessions-changed", name, status });
    }
<!-- /quote -->

So a menu open in another window keeps the deleted row until it is opened again,
and a press on that row switches to a task that is gone. A window that is **on**
the deleted task by `?review=` hears `session-changed` for it (its metadata went
to `null`), reads the review again, and gets `no-such-session`, which the store
turns into the failure screen:

<!-- quote:../../../src/ui/store.ts -->
    } catch (error) {
      if (generation !== reading) return;
      set({ status: "failed", failure: reason(error) });
      return;
    }
<!-- /quote -->

That names the reason, but it strands the window where the deleting one moved on
to `current`. Two shapes of a fix: a frame for a session that disappeared (a
change to `WatcherEvent` and to the three frame tables `tests/frame-tables.test.ts`
holds), and a window that answers `no-such-session` for its own task by moving to
`current` the way `deleteTask` does.

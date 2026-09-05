import { afterEach, describe, expect, it, vi } from "vitest";
import { changedHunks, hasNewLine, mergeRepository, splitHunks } from "../src/ui/patch.ts";
import { readDismissed, useStore, withComments } from "../src/ui/store.ts";
import type { ActivityEvent, Comment, FileChange, RepositoryChange } from "../src/ui/types.ts";

/**
 * Live update (DA-25): what an event does to the review the page already holds.
 * The rule the handoff states is that a data update repaints the affected lines
 * and threads and never the card, so what is asserted here is identity — the
 * objects a card is memoised on have to survive an edit in the file next to it
 * ([08-ui.md](../docs/reference/08-ui.md)).
 */

const ONE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "+const b = 2;",
  " const c = 3;",
  " const d = 4;",
].join("\n");

const ONE_EDITED = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,5 @@",
  " const a = 1;",
  "+const b = 2;",
  "+const b2 = 22;",
  " const c = 3;",
  " const d = 4;",
].join("\n");

const TWO_HUNKS = [
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = 2;",
  "@@ -40,2 +41,3 @@",
  " const y = 1;",
  "+const z = 2;",
].join("\n");

const TWO_HUNKS_SECOND_EDITED = [
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+const b = 2;",
  "@@ -40,2 +41,4 @@",
  " const y = 1;",
  "+const z = 2;",
  "+const zz = 3;",
].join("\n");

function file(over: Partial<FileChange> = {}): FileChange {
  return {
    path: "src/a.ts",
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: ONE,
    hunks: [],
    omitted: null,
    ...over,
  };
}

function repository(files: FileChange[]): RepositoryChange {
  return {
    path: "repos/a",
    branch: "main",
    base: { mode: "head", ref: "HEAD", sha: "abc1234" },
    files,
    warnings: [],
  };
}

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c_one",
    repo: "repos/a",
    path: "src/a.ts",
    side: "new",
    line: 2,
    endLine: null,
    anchor: null,
    severity: "warning",
    status: "open",
    author: "kim.p",
    role: "human",
    body: "this is wrong",
    createdAt: "2026-09-05T12:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...over,
  };
}

function activity(id: number, over: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id,
    verb: "changed",
    author: null,
    repo: "repos/a",
    path: null,
    at: new Date(1_800_000_000_000 + id).toISOString(),
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The store as a loaded review left it, with one repository of two files. */
function loaded(): { untouched: FileChange; edited: FileChange } {
  const untouched = file({ path: "src/keep.ts", patch: TWO_HUNKS });
  const edited = file();
  useStore.setState({
    status: "ready",
    repositories: [repository([untouched, edited])],
    files: [
      { id: "repos/a/src/keep.ts", index: 0, repo: "repos/a", file: untouched },
      { id: "repos/a/src/a.ts", index: 1, repo: "repos/a", file: edited },
    ],
    changed: new Map(),
    composer: null,
    composerEnd: null,
    sel: null,
    body: "",
    toast: null,
    events: [],
    warnings: [],
    warningsDismissedFor: null,
  });
  return { untouched, edited };
}

describe("the hunks of a patch", () => {
  it("splits at every `@@` and keeps the header with its body", () => {
    const hunks = splitHunks(TWO_HUNKS);
    expect(hunks.map((hunk) => hunk.header)).toEqual(["@@ -1,2 +1,3 @@", "@@ -40,2 +41,3 @@"]);
    expect(hunks[1]?.body).toContain("+const z = 2;");
  });

  it("marks only the hunk whose lines changed", () => {
    expect([...changedHunks(TWO_HUNKS, TWO_HUNKS_SECOND_EDITED)]).toEqual(["@@ -40,2 +41,4 @@"]);
  });

  it("marks nothing when the patch says the same thing", () => {
    expect(changedHunks(TWO_HUNKS, TWO_HUNKS).size).toBe(0);
  });
});

describe("a line of the new side", () => {
  it("is there when the patch adds it or carries it as context", () => {
    expect(hasNewLine(ONE, 2)).toBe(true);
    expect(hasNewLine(ONE, 4)).toBe(true);
  });

  it("is gone when the patch no longer reaches it", () => {
    expect(hasNewLine(ONE, 9)).toBe(false);
  });
});

describe("a repository the stream brought again", () => {
  it("keeps the object of every file that says the same thing", () => {
    const before = repository([file({ path: "src/keep.ts" }), file()]);
    const merged = mergeRepository(before, repository([file({ path: "src/keep.ts" }), file()]));
    expect(merged).toBe(before);
  });

  it("keeps the unchanged files and takes the edited one", () => {
    const keep = file({ path: "src/keep.ts" });
    const before = repository([keep, file()]);
    const merged = mergeRepository(
      before,
      repository([file({ path: "src/keep.ts" }), file({ patch: ONE_EDITED, additions: 2 })]),
    );
    expect(merged).not.toBe(before);
    expect(merged.files[0]).toBe(keep);
    expect(merged.files[1]?.patch).toBe(ONE_EDITED);
  });
});

describe("a diff-changed event", () => {
  it("leaves the other cards the objects they were rendered from", () => {
    const { untouched } = loaded();
    useStore
      .getState()
      .applyRepositoryDiff(
        "repos/a",
        repository([
          file({ path: "src/keep.ts", patch: TWO_HUNKS }),
          file({ patch: ONE_EDITED, additions: 2 }),
        ]),
      );

    const files = useStore.getState().files;
    expect(files[0]?.file).toBe(untouched);
    expect(files[1]?.file.patch).toBe(ONE_EDITED);
  });

  it("changes nothing at all when the repository says the same thing", () => {
    loaded();
    const before = useStore.getState().repositories;
    useStore
      .getState()
      .applyRepositoryDiff(
        "repos/a",
        repository([file({ path: "src/keep.ts", patch: TWO_HUNKS }), file()]),
      );
    expect(useStore.getState().repositories).toBe(before);
  });

  it("marks the hunk that changed, and only it", () => {
    loaded();
    useStore
      .getState()
      .applyRepositoryDiff(
        "repos/a",
        repository([
          file({ path: "src/keep.ts", patch: TWO_HUNKS_SECOND_EDITED }),
          file({ patch: ONE }),
        ]),
      );

    const marks = useStore.getState().changed;
    expect([...(marks.get("repos/a/src/keep.ts")?.hunks ?? [])]).toEqual(["@@ -40,2 +41,4 @@"]);
    expect(marks.has("repos/a/src/a.ts")).toBe(false);
  });

  it("takes a repository that has no changes left out of the review", () => {
    loaded();
    useStore.getState().applyRepositoryDiff("repos/a", null);
    expect(useStore.getState().repositories).toEqual([]);
    expect(useStore.getState().files).toEqual([]);
  });

  it("closes a form the repository took with it, and says so", () => {
    loaded();
    useStore.getState().openComposer({ repo: "repos/a", path: "src/a.ts", side: "new", line: 2 });
    useStore.getState().applyRepositoryDiff("repos/a", null);

    const after = useStore.getState();
    // There is no anchor left to move it to: the repository has no card either.
    expect(after.composer).toBeNull();
    expect(after.toast).toContain("repos/a");
    // And the reading position is off the file that is no longer there.
    expect(after.repo).toBeNull();
    expect(after.path).toBeNull();
  });
});

describe("the composer while the file under it changes", () => {
  it("is left alone when the patch of another file arrives", () => {
    loaded();
    const store = useStore.getState();
    store.openComposer({ repo: "repos/a", path: "src/a.ts", side: "new", line: 2 });
    useStore.setState({ body: "half a sentence" });

    store.applyRepositoryDiff(
      "repos/a",
      repository([
        file({ path: "src/keep.ts", patch: TWO_HUNKS_SECOND_EDITED }),
        file({ patch: ONE }),
      ]),
    );

    const after = useStore.getState();
    expect(after.composer).toEqual({ repo: "repos/a", path: "src/a.ts", side: "new", line: 2 });
    expect(after.sel).not.toBeNull();
    expect(after.body).toBe("half a sentence");
  });

  it("keeps what was written when its line is gone, on the file it was written for", () => {
    loaded();
    const store = useStore.getState();
    store.openComposer({ repo: "repos/a", path: "src/a.ts", side: "new", line: 4 });
    useStore.setState({ body: "half a sentence" });

    // A patch that no longer reaches line 4: the row the form sat under is not
    // in the diff any more.
    store.applyRepositoryDiff(
      "repos/a",
      repository([
        file({ path: "src/keep.ts", patch: TWO_HUNKS }),
        file({
          patch: [
            "diff --git a/src/a.ts b/src/a.ts",
            "@@ -1,1 +1,2 @@",
            " const a = 1;",
            "+x",
          ].join("\n"),
        }),
      ]),
    );

    const after = useStore.getState();
    expect(after.composer).toEqual({ repo: "repos/a", path: "src/a.ts", side: null, line: null });
    expect(after.body).toBe("half a sentence");
    expect(after.toast).not.toBeNull();
  });
});

describe("a review the stream brought again", () => {
  /** The document `GET /api/review` answers with, for a session of one file. */
  function document(session: string) {
    return {
      root: "/root",
      repositories: [repository([file()])],
      totals: { repositories: 1, files: 1, lines: 1 },
      session: {
        version: 1,
        name: session,
        title: "",
        base: { mode: "head" },
        createdAt: "2026-09-05T00:00:00Z",
        updatedAt: "2026-09-05T00:00:00Z",
      },
      comments: [],
      counters: {
        counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
        repositories: [],
      },
      warnings: [],
    };
  }

  function answers(session: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url === "/api/config" ? { user: "kim.p" } : document(session)),
          ),
        ),
      ),
    );
  }

  it("keeps the draft when it is the same session read again", async () => {
    loaded();
    useStore.setState({ session: document("ls-1").session as never });
    useStore.getState().openComposer({ repo: "repos/a", path: "src/a.ts", side: "new", line: 2 });
    useStore.setState({ body: "half a sentence", focusId: "c_one" });
    answers("ls-1");

    await useStore.getState().loadReview();

    // A watcher woke because something under `reviews/` changed; that is not a
    // reason to take a form away from the reader.
    expect(useStore.getState().composer).not.toBeNull();
    expect(useStore.getState().body).toBe("half a sentence");
    expect(useStore.getState().focusId).toBe("c_one");
  });

  it("drops it when the review is another session's", async () => {
    loaded();
    useStore.setState({ session: document("ls-1").session as never });
    useStore.getState().openComposer({ repo: "repos/a", path: "src/a.ts", side: "new", line: 2 });
    useStore.setState({ body: "half a sentence", focusId: "c_one" });
    answers("ls-2");

    await useStore.getState().loadReview();

    expect(useStore.getState().composer).toBeNull();
    expect(useStore.getState().body).toBe("");
    expect(useStore.getState().focusId).toBeNull();
  });

  it("takes the changed-hunk marks of the session it is leaving", async () => {
    loaded();
    useStore.setState({
      session: document("ls-1").session as never,
      changed: new Map([["repos/a/src/a.ts", { hunks: new Set(["@@ -1,3 +1,4 @@"]), at: 1 }]]),
    });
    answers("ls-2");

    await useStore.getState().loadReview();

    // The marks say what changed while *this* review was open; a hunk of the
    // next one whose header happens to match is not freshly changed.
    expect(useStore.getState().changed.size).toBe(0);
  });
});

describe("a session-changed frame the page caused itself", () => {
  it("is skipped once, and only for the write that is waiting for it", () => {
    loaded();
    useStore.setState({ selfSessions: new Map() });
    useStore.getState().markSelfSession("ls-1");

    expect(useStore.getState().claimSelfSession("ls-1")).toBe(true);
    // One write, one frame: a second frame for the same session is somebody
    // else's and must be read.
    expect(useStore.getState().claimSelfSession("ls-1")).toBe(false);
    expect(useStore.getState().claimSelfSession("ls-2")).toBe(false);
  });

  it("holds two writes at once, and matches them in either order", () => {
    // What the perf harness does: switch there and back without waiting, so the
    // frame for the first can land after the second write was made.
    loaded();
    useStore.setState({ selfSessions: new Map() });
    useStore.getState().markSelfSession("ls-b");
    useStore.getState().markSelfSession("ls-a");

    expect(useStore.getState().claimSelfSession("ls-b")).toBe(true);
    expect(useStore.getState().claimSelfSession("ls-a")).toBe(true);
  });

  it("lets go of a write that never produced a frame", () => {
    // A switch away and back inside the watcher's debounce leaves `current`
    // where it was and emits nothing at all. Without an age on the mark it
    // would sit there for the life of the page and swallow the next real
    // event for that session — an agent's `review base`, say.
    loaded();
    useStore.setState({ selfSessions: new Map([["ls-1", Date.now() - 60_000]]) });

    expect(useStore.getState().claimSelfSession("ls-1")).toBe(false);
    expect(useStore.getState().selfSessions.size).toBe(0);
  });
});

describe("a thread the stream named", () => {
  it("is added when the page has never seen it", () => {
    loaded();
    useStore.setState(withComments([]));
    useStore.getState().patchThread(comment());

    expect(useStore.getState().comments).toHaveLength(1);
    expect(useStore.getState().counters.counters.open).toBe(1);
  });

  it("replaces the one the page holds, in its place", () => {
    loaded();
    useStore.setState(withComments([comment(), comment({ id: "c_two", line: 4 })]));
    useStore.getState().patchThread(comment({ status: "resolved" }));

    const comments = useStore.getState().comments;
    expect(comments.map((one) => one.id)).toEqual(["c_one", "c_two"]);
    expect(comments[0]?.status).toBe("resolved");
    expect(useStore.getState().counters.counters.resolved).toBe(1);
  });
});

describe("the activity feed", () => {
  it("merges the ring read on connect with the frames already seen, by id", () => {
    loaded();
    useStore.getState().pushActivity([activity(2), activity(3)]);
    useStore.getState().pushActivity([activity(1), activity(2), activity(3)]);

    expect(useStore.getState().events.map((event) => event.id)).toEqual([1, 2, 3]);
  });

  it("does not touch the list when everything in it is already there", () => {
    loaded();
    useStore.getState().pushActivity([activity(1)]);
    const held = useStore.getState().events;
    useStore.getState().pushActivity([activity(1)]);
    expect(useStore.getState().events).toBe(held);
  });
});

describe("the warnings bar", () => {
  it("comes back when the scan has something new to say", () => {
    loaded();
    useStore.setState({
      warnings: [{ path: "repos/a", message: "no remote" }],
      warningsDismissedFor: "ls-1",
    });
    useStore.getState().setWarnings([{ path: "repos/b", message: "ref does not resolve" }]);

    expect(useStore.getState().warningsDismissedFor).toBeNull();
  });

  it("forgets the remembered dismiss too, so a reload does not hide it again", () => {
    loaded();
    useStore.setState({
      warnings: [{ path: "repos/a", message: "no remote" }],
      session: { ...(useStore.getState().session ?? null), name: "ls-1" } as never,
    });
    useStore.getState().dismissWarnings();
    useStore.getState().setWarnings([{ path: "repos/b", message: "ref does not resolve" }]);

    // Through the store's own reader, not the global: `sessionStorage` is a
    // browser's, and this suite runs on Node and on Bun, which does not declare
    // it. What is asserted is what a reload would find.
    expect(readDismissed()).toBeNull();
  });

  it("stays dismissed while the list says the same thing", () => {
    loaded();
    useStore.setState({
      warnings: [{ path: "repos/a", message: "no remote" }],
      warningsDismissedFor: "ls-1",
    });
    useStore.getState().setWarnings([{ path: "repos/a", message: "no remote" }]);

    expect(useStore.getState().warningsDismissedFor).toBe("ls-1");
  });
});

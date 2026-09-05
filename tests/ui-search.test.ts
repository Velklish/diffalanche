import { describe, expect, it } from "vitest";
import { preview, search } from "../src/ui/search.ts";
import type { FileEntry } from "../src/ui/store.ts";
import { useStore, withComments } from "../src/ui/store.ts";
import type { Comment, FileChange, RepositoryChange } from "../src/ui/types.ts";

/**
 * Global search and the `J` / `K` order (DA-26). The ranking and the preview
 * are pure and are checked here; the modal itself and the rest of the keyboard
 * map are in `e2e/keyboard.spec.ts`, where there are keys to press
 * ([08-ui.md](../docs/reference/08-ui.md)).
 */

const PATCH = [
  "diff --git a/src/store.ts b/src/store.ts",
  "--- a/src/store.ts",
  "+++ b/src/store.ts",
  "@@ -40,4 +40,6 @@",
  " const before = 1;",
  " const alsoBefore = 2;",
  "-const gone = 3;",
  "+const added = 3;",
  "+const alsoAdded = 4;",
  " const after = 5;",
  " const alsoAfter = 6;",
].join("\n");

function file(path: string, patch = PATCH): FileChange {
  return {
    path,
    oldPath: null,
    status: "modified",
    additions: 2,
    deletions: 1,
    patch,
    hunks: [],
    omitted: null,
  };
}

function entries(...paths: [string, string][]): FileEntry[] {
  return paths.map(([repo, path], index) => ({
    id: `${repo}/${path}`,
    index,
    repo,
    file: file(path),
  }));
}

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c_one",
    repo: "repos/a",
    path: "src/store.ts",
    side: "new",
    line: 41,
    endLine: null,
    anchor: null,
    severity: "warning",
    status: "open",
    author: "kim.p",
    role: "human",
    body: "this loop allocates on every frame",
    createdAt: "2026-09-05T12:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...over,
  };
}

describe("the ranking", () => {
  const files = entries(
    ["repos/a", "src/store.ts"],
    ["repos/b", "src/keyboard/store-notes.ts"],
    // `store` is inside a word here and at the start of a segment above: the
    // two are what separates the boundary bonus from a plain substring.
    ["repos/a", "src/restore.ts"],
  );

  it("finds a file by a piece of its path", () => {
    const hits = search("store.ts", files, []);
    expect(hits[0]?.kind).toBe("file");
    expect(hits[0]?.id).toBe("repos/a/src/store.ts");
  });

  it("puts a match at the start of a path segment over one inside a word", () => {
    const hits = search("store", files, []);
    expect(hits.map((hit) => hit.id)).toEqual([
      "repos/a/src/store.ts",
      "repos/b/src/keyboard/store-notes.ts",
      "repos/a/src/restore.ts",
    ]);
    // Not the tie-break doing the work: `restore.ts` sorts before `store.ts`
    // by path and is still last, because the bonus is what orders them.
    expect(hits[0]?.score).toBeGreaterThan(hits.at(-1)?.score ?? 0);
  });

  it("takes words that are scattered over the path", () => {
    const hits = search("repos/b keyboard", files, []);
    expect(hits.map((hit) => hit.id)).toEqual(["repos/b/src/keyboard/store-notes.ts"]);
  });

  it("finds a comment by a word of its body and tags it as one", () => {
    const hits = search("allocates", files, [comment()]);
    expect(hits[0]?.kind).toBe("comment");
    expect(hits[0]?.tag).toBe("comment");
    expect(hits[0]?.line).toBe(41);
    expect(hits[0]?.label).toBe("this loop allocates on every frame");
  });

  it("has nothing to say about an empty query", () => {
    expect(search("   ", files, [comment()])).toEqual([]);
  });

  it("leaves out a comment that is anchored to no file", () => {
    const onReview = comment({ id: "c_two", repo: null, path: null, line: null });
    expect(search("allocates", [], [onReview])).toEqual([]);
  });
});

describe("the preview", () => {
  it("keeps the deletion beside what replaced it and numbers the new side", () => {
    const lines = preview(PATCH, 41);
    expect(lines.map((line) => line.kind)).toEqual([
      "context",
      "context",
      "del",
      "add",
      "add",
      "context",
      "context",
    ]);
    expect(lines.filter((line) => line.kind === "add").map((line) => line.line)).toEqual([42, 43]);
  });

  it("centres on the first change when the hit is a file", () => {
    const lines = preview(PATCH, null, 3);
    expect(lines.map((line) => line.text)).toContain("const added = 3;");
  });

  it("holds to the number of lines it was asked for", () => {
    expect(preview(PATCH, 41, 3)).toHaveLength(3);
  });
});

/** A review of two repositories, the second one first in the store's order. */
function loadedReview(): void {
  const repositories: RepositoryChange[] = [
    {
      path: "repos/a",
      branch: "main",
      base: null,
      files: [file("src/one.ts"), file("src/two.ts")],
      warnings: [],
    },
    { path: "repos/b", branch: "main", base: null, files: [file("src/three.ts")], warnings: [] },
  ];
  let index = 0;
  useStore.setState({
    repositories,
    files: repositories.flatMap((repo) =>
      repo.files.map((one) => ({
        id: `${repo.path}/${one.path}`,
        index: index++,
        repo: repo.path,
        file: one,
      })),
    ),
    focusId: null,
  });
}

describe("J and K", () => {
  it("walk the open threads by repository, then file, then line", () => {
    loadedReview();
    useStore.setState(
      withComments([
        comment({ id: "c_b", repo: "repos/b", path: "src/three.ts", line: 5 }),
        comment({ id: "c_a2", repo: "repos/a", path: "src/two.ts", line: 5 }),
        comment({ id: "c_a1_late", repo: "repos/a", path: "src/one.ts", line: 90 }),
        comment({ id: "c_a1_early", repo: "repos/a", path: "src/one.ts", line: 7 }),
      ]),
    );

    const walked: (string | null)[] = [];
    for (let step = 0; step < 4; step += 1) walked.push(useStore.getState().stepThread(1));
    expect(walked).toEqual(["c_a1_early", "c_a1_late", "c_a2", "c_b"]);
  });

  it("wrap at both ends", () => {
    loadedReview();
    useStore.setState(
      withComments([
        comment({ id: "c_first", repo: "repos/a", path: "src/one.ts", line: 7 }),
        comment({ id: "c_last", repo: "repos/b", path: "src/three.ts", line: 5 }),
      ]),
    );

    useStore.setState({ focusId: "c_last" });
    expect(useStore.getState().stepThread(1)).toBe("c_first");
    expect(useStore.getState().stepThread(-1)).toBe("c_last");
  });

  it("skip what is closed", () => {
    loadedReview();
    useStore.setState(
      withComments([
        comment({ id: "c_open", repo: "repos/a", path: "src/one.ts", line: 7 }),
        comment({
          id: "c_done",
          repo: "repos/a",
          path: "src/two.ts",
          line: 5,
          status: "resolved",
        }),
      ]),
    );

    expect(useStore.getState().stepThread(1)).toBe("c_open");
    expect(useStore.getState().stepThread(1)).toBe("c_open");
  });

  it("make the thread's file the current one, so the diff and the rail follow", () => {
    loadedReview();
    useStore.setState(
      withComments([comment({ id: "c_b", repo: "repos/b", path: "src/three.ts", line: 5 })]),
    );

    useStore.getState().stepThread(1);
    expect(useStore.getState().repo).toBe("repos/b");
    expect(useStore.getState().path).toBe("src/three.ts");
    expect(useStore.getState().focusId).toBe("c_b");
  });

  it("have nothing to walk in a review with no open thread", () => {
    loadedReview();
    useStore.setState(withComments([]));
    expect(useStore.getState().stepThread(1)).toBeNull();
  });
});

describe("R", () => {
  it("resolves the focused thread", async () => {
    loadedReview();
    useStore.setState(withComments([comment({ id: "c_one" })]));
    useStore.setState({ focusId: "c_one", user: "kim.p", busy: {} });
    const answered = comment({ id: "c_one", status: "resolved", resolvedBy: "kim.p" });
    const fetches: string[] = [];
    globalThis.fetch = ((url: string) => {
      fetches.push(url);
      return Promise.resolve(new Response(JSON.stringify(answered)));
    }) as unknown as typeof fetch;

    await useStore.getState().resolveFocused();

    expect(fetches).toEqual(["/api/comments/c_one/resolve"]);
    expect(useStore.getState().comments[0]?.status).toBe("resolved");
  });

  it("does nothing on a thread that is already closed", async () => {
    loadedReview();
    useStore.setState(withComments([comment({ id: "c_one", status: "resolved" })]));
    useStore.setState({ focusId: "c_one", busy: {} });
    const fetches: string[] = [];
    globalThis.fetch = ((url: string) => {
      fetches.push(url);
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    await useStore.getState().resolveFocused();

    expect(fetches).toEqual([]);
  });
});

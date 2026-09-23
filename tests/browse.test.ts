/** Browsing a repository outside its diff (DA-37): the tree, one file whole, and a comment
 * anchored on a line the change set does not carry. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, createSession, DomainError } from "../src/core/domain/index.ts";
import { isRepositoryPath, listTree, readFileAt } from "../src/core/git/browse.ts";
import type { Comment } from "../src/core/storage/index.ts";
import type { FileContent, RepositoryTree } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";

const REPO = "repos/g/one";
/** A second repository whose one change is a rename, with no line of it touched. */
const RENAMED = "repos/g/two";
const KEEP = Array.from({ length: 10 }, (_, index) => `keep ${index + 1}`);
const EDIT = Array.from({ length: 30 }, (_, index) => `edit ${index + 1}`);

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
}

function write(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`);
}

let root: string;
let dir: string;
let head: string;
let config: Config;
let app: Hono;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-browse-"));
  dir = join(root, REPO);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, ".diffalanche"), { recursive: true });
  writeFileSync(join(root, ".diffalanche", "config.json"), '{ "roots": ["repos"], "depth": 2 }\n');
  write(join(dir, "keep.txt"), KEEP);
  write(join(dir, "edit.txt"), EDIT);
  write(join(dir, "gone.txt"), ["gone"]);
  writeFileSync(join(dir, "bin.dat"), Buffer.from([1, 0, 2]));
  write(join(dir, ".gitignore"), ["secret.env"]);
  symlinkSync("keep.txt", join(dir, "link"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "init");
  head = git(dir, "rev-parse", "HEAD").trim();
  // Two lines in at the top, so every line below the hunk sits two further down on disk.
  write(join(dir, "edit.txt"), [...EDIT.slice(0, 2), "added a", "added b", ...EDIT.slice(2)]);
  unlinkSync(join(dir, "gone.txt"));
  write(join(dir, "new.txt"), ["new"]);
  write(join(dir, "secret.env"), ["TOKEN=1"]);

  const two = join(root, RENAMED);
  mkdirSync(two, { recursive: true });
  write(
    join(two, "old.txt"),
    Array.from({ length: 10 }, (_, index) => `old ${index + 1}`),
  );
  git(two, "init", "-q", "-b", "main");
  git(two, "add", "-A");
  git(two, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "init");
  git(two, "mv", "old.txt", "new.txt");

  config = await loadConfig({ root });
  await createSession(config.dataDir, "browse", { mode: "head" }, undefined);
  await createSession(config.dataDir, "narrow", { mode: "head" }, undefined, {
    use: false,
    scope: [{ repo: REPO, paths: ["edit.txt"] }],
  });
  app = createApp({
    activity: createActivityLog(),
    config,
    events: createEventStream(),
    review: createReviewService(config),
    ui: { read: async () => null },
  });
  // The first read scans, and it is what writes the change set a comment is anchored from.
  expect((await app.request("/api/review")).status).toBe(200);
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the tree of a repository", () => {
  it("merges the base revision and the working tree by path", async () => {
    const tree = await listTree(dir, head);
    expect(tree).toEqual([
      { path: ".gitignore", base: true, worktree: true },
      { path: "bin.dat", base: true, worktree: true },
      { path: "edit.txt", base: true, worktree: true },
      { path: "gone.txt", base: true, worktree: false },
      { path: "keep.txt", base: true, worktree: true },
      { path: "link", base: true, worktree: true },
      { path: "new.txt", base: false, worktree: true },
    ]);
  });

  it("is served for a repository of the review, and refused for one it does not show", async () => {
    const response = await app.request(`/api/repos/${REPO}/tree`);
    expect(response.status).toBe(200);
    const tree = (await response.json()) as RepositoryTree;
    expect(tree.sha).toBe(head);
    expect(tree.files.map((one) => one.path)).toContain("keep.txt");
    expect(tree.files.map((one) => one.path)).not.toContain("secret.env");

    const missing = await app.request("/api/repos/repos/g/none/tree");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("no-such-repository");
  });

  it("lists only the files a task's scope names", async () => {
    const response = await app.request(`/api/repos/${REPO}/tree?review=narrow`);
    const tree = (await response.json()) as RepositoryTree;
    expect(tree.files.map((one) => one.path)).toEqual(["edit.txt"]);
  });
});

describe("one file whole", () => {
  it("reads the working tree and the base revision", async () => {
    expect(await readFileAt(dir, "keep.txt", "worktree")).toEqual({
      text: `${KEEP.join("\n")}\n`,
      omitted: null,
    });
    expect(await readFileAt(dir, "gone.txt", { sha: head })).toEqual({
      text: "gone\n",
      omitted: null,
    });
    expect(await readFileAt(dir, "gone.txt", "worktree")).toBeNull();
    expect(await readFileAt(dir, "new.txt", { sha: head })).toBeNull();
  });

  it("reads a link as its target, and a binary or oversized file as omitted", async () => {
    expect(await readFileAt(dir, "link", "worktree")).toEqual({ text: "keep.txt", omitted: null });
    expect(await readFileAt(dir, "link", { sha: head })).toEqual({
      text: "keep.txt",
      omitted: null,
    });
    expect(await readFileAt(dir, "bin.dat", "worktree")).toEqual({ text: null, omitted: "binary" });
    expect(await readFileAt(dir, "bin.dat", { sha: head })).toEqual({
      text: null,
      omitted: "binary",
    });
    expect(await readFileAt(dir, "keep.txt", "worktree", 10)).toEqual({
      text: null,
      omitted: "too-large",
    });
    expect(await readFileAt(dir, "keep.txt", { sha: head }, 10)).toEqual({
      text: null,
      omitted: "too-large",
    });
  });

  it("never reads a file git does not list, nor a path that steps outside", async () => {
    expect(await readFileAt(dir, "secret.env", "worktree")).toBeNull();
    expect(await readFileAt(dir, ".git/config", "worktree")).toBeNull();
    expect(await readFileAt(dir, "../one/keep.txt", "worktree")).toBeNull();
    for (const path of ["", "/etc/passwd", "a//b", "./keep.txt", "a/../keep.txt", "a\\b"]) {
      expect(isRepositoryPath(path)).toBe(false);
    }
    expect(isRepositoryPath("src/a b/c.ts")).toBe(true);
  });

  it("is served with the revision it was read at", async () => {
    const worktree = await app.request(`/api/repos/${REPO}/file?path=keep.txt`);
    expect(worktree.status).toBe(200);
    expect(await worktree.json()).toEqual({
      repo: REPO,
      path: "keep.txt",
      rev: "worktree",
      sha: null,
      text: `${KEEP.join("\n")}\n`,
      omitted: null,
    } satisfies FileContent);

    const base = await app.request(`/api/repos/${REPO}/file?path=gone.txt&rev=base`);
    expect(((await base.json()) as FileContent).sha).toBe(head);
  });

  it("refuses what is not a file of this task, and a request that names none", async () => {
    const status = async (url: string) => (await app.request(url)).status;
    expect(await status(`/api/repos/${REPO}/file?path=secret.env`)).toBe(404);
    expect(await status(`/api/repos/${REPO}/file?path=gone.txt`)).toBe(404);
    expect(await status(`/api/repos/${REPO}/file?path=keep.txt&review=narrow`)).toBe(404);
    expect(await status(`/api/repos/${REPO}/file`)).toBe(400);
    expect(await status(`/api/repos/${REPO}/file?path=keep.txt&rev=head`)).toBe(400);
  });
});

async function comment(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: REPO, severity: "nit", body: "context", ...body }),
  });
}

describe("a comment outside the change set", () => {
  it("anchors a line of an unchanged file from the file, in the same shape", async () => {
    const response = await comment({ path: "keep.txt", line: 5 });
    expect(response.status).toBe(201);
    const written = (await response.json()) as Comment;
    expect(written).toMatchObject({ path: "keep.txt", side: "new", line: 5 });
    expect(written.anchor).toEqual({
      lineContent: "keep 5",
      hunk: "@@ -2,7 +2,7 @@",
      before: ["keep 2", "keep 3", "keep 4"],
      after: ["keep 6", "keep 7", "keep 8"],
    });
  });

  it("anchors the old side from the base revision", async () => {
    const written = (await (
      await comment({ path: "keep.txt", line: 1, side: "old" })
    ).json()) as Comment;
    expect(written.anchor).toEqual({
      lineContent: "keep 1",
      hunk: "@@ -1,4 +1,4 @@",
      before: [],
      after: ["keep 2", "keep 3", "keep 4"],
    });
  });

  it("numbers the other side of a changed file past the hunks above the line", async () => {
    // New line 20 is old line 18: the hunk at the top put two lines in.
    const written = (await (await comment({ path: "edit.txt", line: 20 })).json()) as Comment;
    expect(written.anchor).toEqual({
      lineContent: "edit 18",
      hunk: "@@ -15,7 +17,7 @@",
      before: ["edit 15", "edit 16", "edit 17"],
      after: ["edit 19", "edit 20", "edit 21"],
    });
  });

  it("numbers the other side from the hunk when the window starts inside one", async () => {
    // New line 8 is three below the hunk `@@ -1,5 +1,7 @@`: its window starts at new 5, old 3.
    const onNew = (await (await comment({ path: "edit.txt", line: 8 })).json()) as Comment;
    expect(onNew.anchor).toEqual({
      lineContent: "edit 6",
      hunk: "@@ -3,7 +5,7 @@",
      before: ["edit 3", "edit 4", "edit 5"],
      after: ["edit 7", "edit 8", "edit 9"],
    });
    const onOld = (await (
      await comment({ path: "edit.txt", line: 6, side: "old" })
    ).json()) as Comment;
    expect(onOld.anchor).toEqual({
      lineContent: "edit 6",
      hunk: "@@ -3,7 +5,7 @@",
      before: ["edit 3", "edit 4", "edit 5"],
      after: ["edit 7", "edit 8", "edit 9"],
    });
  });

  it("reads the old side of a renamed file under the name the base has it by", async () => {
    const response = await comment({ repo: RENAMED, path: "new.txt", line: 5, side: "old" });
    expect(response.status).toBe(201);
    expect(((await response.json()) as Comment).anchor).toEqual({
      lineContent: "old 5",
      hunk: "@@ -2,7 +2,7 @@",
      before: ["old 2", "old 3", "old 4"],
      after: ["old 6", "old 7", "old 8"],
    });
  });

  it("refuses a line past the end of the file", async () => {
    const response = await comment({ path: "keep.txt", line: 11 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid-anchor",
      message: `line 11 of ${REPO}/keep.txt is past its end on the new side: the file has 10 lines`,
    });
  });

  it("keeps the change set's refusal where the file has nothing to read", async () => {
    const binary = await comment({ path: "bin.dat", line: 1 });
    expect(((await binary.json()) as { error: string }).error).toBe("line-not-in-diff");
    const ignored = await comment({ path: "secret.env", line: 1 });
    expect(((await ignored.json()) as { error: string }).error).toBe("line-not-in-diff");
  });

  it("is refused by the domain without a source, which is what the CLI keeps", async () => {
    const error = await addComment(config.dataDir, "browse", {
      repo: REPO,
      path: "keep.txt",
      line: 5,
      severity: "nit",
      body: "context",
      author: "f",
      role: "human",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("line-not-in-diff");
  });
});

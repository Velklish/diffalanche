import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { findRepositories, refreshRepository, scanReview } from "../src/core/change-set.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { parseDiff, scan } from "../src/core/index.ts";
import type { DiffCache } from "../src/core/storage/index.ts";
import { readDiffCache, writeDiffCache } from "../src/core/storage/index.ts";
import type { BaseSpec } from "../src/core/types.ts";

/** The change set of a root, the way the server reads it before it caches it. */
async function changeSet(root: string): Promise<DiffCache> {
  const config = await loadConfig({ root });
  const { cache } = await scanReview(config, { mode: "head" });
  return cache;
}

const SMALL = PROFILES.small;

const REPO = "repos/core/cargos-api";
const STAGED_MARK = "// staged edit, added by the test";

let root: string;
let bundle: DiffCache;
let stagedBundle: DiffCache;
let statusBefore: string;
let statusAfterScan: string;
let statusStaged: string;
let statusAfterStagedScan: string;
let stagedEditPath: string;

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function status(repo: string): string {
  return git(repo, ["status", "--porcelain"]);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-change-set-"));
  generate({ out: root, seed: 7, profile: SMALL });
  const repo = join(root, REPO);

  statusBefore = status(repo);
  bundle = await changeSet(root);
  statusAfterScan = status(repo);

  // The change set is the working tree against HEAD, so a staged change belongs
  // to it. Staging happens here, in the test's own fixture — never in the reader.
  writeFileSync(join(repo, "staged-new.ts"), "export const staged = 1;\n");
  git(repo, ["add", "staged-new.ts"]);
  // A TypeScript file, so the appended marker is a comment and not, say, a
  // broken line in .gitmodules, which git reads as configuration.
  stagedEditPath = git(repo, ["ls-files"])
    .split("\n")
    .find((path) => path.endsWith(".ts")) as string;
  appendFileSync(join(repo, stagedEditPath), `${STAGED_MARK}\n`);
  git(repo, ["add", stagedEditPath]);

  statusStaged = status(repo);
  stagedBundle = await changeSet(root);
  statusAfterStagedScan = status(repo);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("change set", () => {
  it("reads the whole synthetic review, repository by repository", () => {
    expect(bundle.totals.repositories).toBe(SMALL.repos);
    expect(bundle.totals.files).toBe(SMALL.files);
    expect(bundle.totals.lines).toBe(SMALL.lines);
  });

  it("lists the sibling worktree but not the nested submodule", async () => {
    const found = await scan(root, { roots: ["repos"], depth: 2, exclude: [] });
    const paths = found.repositories.map((repo) => repo.path);
    expect(paths).toContain("repos/core/cargos-api-worktree");
    expect(paths.some((path) => path.includes("vendor/lib"))).toBe(false);
    // The worktree is clean, so it carries no changes and the review omits it.
    expect(bundle.repositories.map((repo) => repo.path)).not.toContain(
      "repos/core/cargos-api-worktree",
    );
  });

  it("shows an untracked file as an addition", () => {
    const added = bundle.repositories.flatMap((repo) =>
      repo.files.filter((file) => file.status === "added"),
    );
    expect(added).toHaveLength(SMALL.repos);
    for (const file of added) {
      expect(file.deletions).toBe(0);
      expect(file.patch).toContain("--- /dev/null");
    }
  });

  it("takes staged changes: the base is HEAD, not the index", () => {
    const repo = stagedBundle.repositories.find((one) => one.path === REPO);
    const staged = repo?.files.find((file) => file.path === "staged-new.ts");
    expect(staged).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    // Listed once: a staged new file comes from the diff, not from the untracked list.
    expect(repo?.files.filter((file) => file.path === "staged-new.ts")).toHaveLength(1);

    const edited = repo?.files.find((file) => file.path === stagedEditPath);
    expect(edited?.patch).toContain(STAGED_MARK);
  });

  it("carries the structured hunks, which is what diff.json stores", () => {
    // The cache is the only source that has them: anchor capture reads them
    // there, and the review response drops them (`tests/server.test.ts`).
    const files = bundle.repositories.flatMap((repo) => repo.files);
    expect(files.some((file) => file.hunks.length > 0)).toBe(true);
    // The counts still come out, and they are what the totals are built from.
    expect(files.some((file) => file.additions + file.deletions > 0)).toBe(true);
  });

  it("leaves the repository untouched: the tool only reads git", () => {
    expect(statusAfterScan).toBe(statusBefore);
    expect(statusAfterStagedScan).toBe(statusStaged);
  });
});

describe("refreshing one repository", () => {
  it("does not lose the patch of another one written at the same moment", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "diffalanche-refresh-"));
    try {
      generate({ out: fixture, seed: 3, profile: SMALL });
      const config = await loadConfig({ root: fixture });
      const base: BaseSpec = { mode: "head" };
      await writeDiffCache(config.dataDir, "synth", (await scanReview(config, base)).cache);

      const repos = (await findRepositories(config)).filter((path) =>
        existsSync(join(fixture, path, ".git")),
      );
      const [first, second] = [repos[0] as string, repos[1] as string];
      writeFileSync(join(fixture, first, "one.ts"), "export const one = 1;\n");
      writeFileSync(join(fixture, second, "two.ts"), "export const two = 2;\n");

      // Both patch the same file. Without the session lock the second read
      // starts before the first write lands, and one of the two is overwritten.
      await Promise.all([
        refreshRepository(config, "synth", base, first),
        refreshRepository(config, "synth", base, second),
      ]);

      const cache = await readDiffCache(config.dataDir, "synth");
      const files = (path: string) =>
        cache?.repositories.find((one) => one.path === path)?.files.map((one) => one.path) ?? [];
      expect(files(first)).toContain("one.ts");
      expect(files(second)).toContain("two.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("parseDiff", () => {
  const raw = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
    "diff --git a/src/b.ts b/src/b.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.ts",
    "@@ -0,0 +1,2 @@",
    "+export const x = 1;",
    "+export const y = 2;",
    "",
  ].join("\n");

  it("keeps a pure rename, which carries no hunks at all", () => {
    const rename = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");
    const files = parseDiff(rename);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      // Having no hunks is not the same as having no content to show.
      omitted: null,
    });
    expect(files[0]?.patch).toContain("rename to src/new.ts");
  });

  it("splits the output into one patch per file and counts the changed lines", () => {
    const files = parseDiff(raw);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0]).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
    expect(files[1]).toMatchObject({ status: "added", additions: 2, deletions: 0 });
    expect(files[0]?.patch).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(files[0]?.patch).toContain("@@ -1,3 +1,3 @@");
  });
});

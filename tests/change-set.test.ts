import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { parseDiff, scan } from "../src/core/index.ts";
import type { ReviewBundle } from "../src/core/types.ts";
import { buildReviewBundle } from "../src/server/index.ts";

const SMALL = PROFILES.small;

const REPO = "repos/core/cargos-api";
const STAGED_MARK = "// staged edit, added by the test";

let root: string;
let bundle: ReviewBundle;
let stagedBundle: ReviewBundle;
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
  bundle = await buildReviewBundle(root);
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
  stagedBundle = await buildReviewBundle(root);
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

  it("leaves the structured hunks out of the review response", () => {
    // The renderer reads `patch`; carrying the hunks too costs more CPU per
    // scrolled frame than the budget of `docs/SPEC.md` section 6 has.
    const files = bundle.repositories.flatMap((repo) => repo.files);
    expect(files.every((file) => file.hunks.length === 0)).toBe(true);
    // The counts still come out, and they are what the totals are built from.
    expect(files.some((file) => file.additions + file.deletions > 0)).toBe(true);
  });

  it("leaves the repository untouched: the tool only reads git", () => {
    expect(statusAfterScan).toBe(statusBefore);
    expect(statusAfterStagedScan).toBe(statusStaged);
  });
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

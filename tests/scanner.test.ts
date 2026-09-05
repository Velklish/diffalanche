import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { scan } from "../src/core/index.ts";
import type { ScanResult } from "../src/core/types.ts";

const FULL_SCAN = { roots: ["repos"], depth: 2, exclude: [] };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "synth",
      GIT_AUTHOR_EMAIL: "synth@example.invalid",
      GIT_COMMITTER_NAME: "synth",
      GIT_COMMITTER_EMAIL: "synth@example.invalid",
    },
  });
}

/** A repository with one commit, which is the least a worktree can be added to. */
function initRepository(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "--quiet", "-m", "base"]);
}

describe("scan of the synthetic review", () => {
  let root: string;
  let result: ScanResult;
  let statusBefore: Map<string, string>;
  let statusAfter: Map<string, string>;

  /** Every `repos/<group>/<repo>` of the synthetic review, the worktree included. */
  function fixtureRepositories(): string[] {
    const base = join(root, "repos");
    return readdirSync(base, { withFileTypes: true })
      .filter((one) => one.isDirectory())
      .flatMap((group) =>
        readdirSync(join(base, group.name), { withFileTypes: true })
          .filter((one) => one.isDirectory())
          .map((repo) => `repos/${group.name}/${repo.name}`),
      );
  }

  function statuses(paths: string[]): Map<string, string> {
    return new Map(paths.map((path) => [path, git(join(root, path), ["status", "--porcelain"])]));
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-scan-"));
    generate({ out: root, seed: 11, profile: PROFILES.small });

    // Enumerated from the filesystem, not from a scan: a baseline taken after
    // the first scan would leave that scan unchecked.
    statusBefore = statuses(fixtureRepositories());
    result = await scan(root, FULL_SCAN);
    statusAfter = statuses(fixtureRepositories());
  }, 120_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists every repository by its path relative to the root", () => {
    expect(result.repositories.map((repo) => repo.path)).toContain("repos/core/cargos-api");
    for (const repo of result.repositories) {
      expect(repo.absolutePath).toBe(join(root, ...repo.path.split("/")));
    }
    // The small profile has three repositories with changes plus the clean worktree.
    expect(result.repositories).toHaveLength(PROFILES.small.repos + 1);
  });

  it("lists the sibling worktree as its own repository and warns about it", () => {
    const worktree = result.repositories.find(
      (repo) => repo.path === "repos/core/cargos-api-worktree",
    );
    expect(worktree?.kind).toBe("worktree");
    expect(result.warnings).toContainEqual({
      path: "repos/core/cargos-api-worktree",
      message: "worktree of repos/core/cargos-api",
    });
  });

  it("does not descend into a repository, so the nested submodule is not listed", () => {
    expect(result.repositories.some((repo) => repo.path.includes("vendor/lib"))).toBe(false);
  });

  it("leaves every repository untouched: a scan only reads the filesystem", () => {
    expect(statusAfter).toEqual(statusBefore);
    expect(statusBefore.size).toBe(result.repositories.length);
  });
});

describe("scan of a hand-made root", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-scan-fixture-"));
    initRepository(join(root, "repos/group/api"));
    initRepository(join(root, "repos/group/web"));
    // Three levels below `repos`, one deeper than `depth`.
    initRepository(join(root, "repos/group/deep/nested"));
    initRepository(join(root, "repos/vendor/tool"));
    initRepository(join(root, "repos/subgroup/api"));
    // Inside a repository, and shallow enough that only the descent guard hides it.
    initRepository(join(root, "repos/group/api/vendor/lib"));
    // A worktree of a repository that is not under the root: nothing to warn about.
    const outside = join(root, "outside/lib");
    initRepository(outside);
    git(outside, ["worktree", "add", "--quiet", join(root, "repos/group/lib-worktree")]);
    // A `.git` file pointing at a submodule git directory is not a worktree pointer.
    mkdirSync(join(root, "repos/group/sub"), { recursive: true });
    writeFileSync(
      join(root, "repos/group/sub/.git"),
      `gitdir: ${join(root, "repos/group/api/.git/modules/sub")}\n`,
    );
    // A worktree whose pointer is relative, which git itself never writes.
    const relMain = join(root, "repos/group/rel-main");
    initRepository(relMain);
    git(relMain, ["worktree", "add", "--quiet", join(root, "repos/group/rel-worktree")]);
    writeFileSync(
      join(root, "repos/group/rel-worktree/.git"),
      "gitdir: ../rel-main/.git/worktrees/rel-worktree\n",
    );
    // A symbolic link to a repository, which the walk must not follow.
    symlinkSync(join(root, "repos/group/api"), join(root, "repos/group/link"));
    mkdirSync(join(root, "repos/closed"), { recursive: true });
    chmodSync(join(root, "repos/closed"), 0o000);
  });

  afterAll(() => {
    chmodSync(join(root, "repos/closed"), 0o755);
    rmSync(root, { recursive: true, force: true });
  });

  it("stops at depth: a repository one level too deep is not listed", async () => {
    const result = await scan(root, FULL_SCAN);
    const paths = result.repositories.map((repo) => repo.path);
    expect(paths).toContain("repos/group/api");
    expect(paths).not.toContain("repos/group/deep/nested");
  });

  it("does not descend into a repository, with depth left to spend", async () => {
    const result = await scan(root, { ...FULL_SCAN, depth: 4 });
    const paths = result.repositories.map((repo) => repo.path);
    expect(paths).toContain("repos/group/api");
    expect(paths).not.toContain("repos/group/api/vendor/lib");
  });

  it("does not follow a symbolic link to a repository", async () => {
    const result = await scan(root, FULL_SCAN);
    expect(result.repositories.map((repo) => repo.path)).not.toContain("repos/group/link");
  });

  it("reads a submodule pointer as an ordinary repository, not a worktree", async () => {
    const result = await scan(root, FULL_SCAN);
    const sub = result.repositories.find((repo) => repo.path === "repos/group/sub");
    expect(sub?.kind).toBe("repo");
    expect(result.warnings.map((warning) => warning.path)).not.toContain("repos/group/sub");
  });

  it("does not warn about a worktree whose main repository is outside the root", async () => {
    const result = await scan(root, FULL_SCAN);
    const worktree = result.repositories.find((repo) => repo.path === "repos/group/lib-worktree");
    expect(worktree?.kind).toBe("worktree");
    expect(result.warnings.map((warning) => warning.path)).not.toContain(
      "repos/group/lib-worktree",
    );
  });

  it("warns about a worktree whose pointer is relative", async () => {
    const result = await scan(root, FULL_SCAN);
    expect(readFileSync(join(root, "repos/group/rel-worktree/.git"), "utf8")).toContain("../");
    expect(result.warnings).toContainEqual({
      path: "repos/group/rel-worktree",
      message: "worktree of repos/group/rel-main",
    });
  });

  it("skips a directory excluded by name and one excluded by path", async () => {
    const byName = await scan(root, { ...FULL_SCAN, exclude: ["vendor"] });
    expect(byName.repositories.map((repo) => repo.path)).not.toContain("repos/vendor/tool");
    expect(byName.repositories.map((repo) => repo.path)).toContain("repos/group/api");

    const byPath = await scan(root, { ...FULL_SCAN, exclude: ["**/group"] });
    expect(byPath.repositories.map((repo) => repo.path)).not.toContain("repos/group/api");
    expect(byPath.repositories.map((repo) => repo.path)).toContain("repos/vendor/tool");
    // `**/` is whole segments: a name that merely ends with the excluded one stays.
    expect(byPath.repositories.map((repo) => repo.path)).toContain("repos/subgroup/api");

    // `.gitignore` spells a directory with a trailing slash; so may `exclude`.
    const trailing = await scan(root, { ...FULL_SCAN, exclude: ["vendor/"] });
    expect(trailing.repositories.map((repo) => repo.path)).not.toContain("repos/vendor/tool");
  });

  it("walks through a root that is itself a repository instead of reviewing it", async () => {
    const result = await scan(join(root, "repos/group"), {
      roots: ["."],
      depth: 2,
      exclude: [],
    });
    expect(result.repositories.map((repo) => repo.path)).not.toContain("");
    const inside = await scan(join(root, "repos/group/api"), {
      roots: ["."],
      depth: 2,
      exclude: [],
    });
    expect(inside.repositories.map((repo) => repo.path)).toEqual(["vendor/lib"]);
    expect(inside.warnings).toContainEqual({
      path: ".",
      message: "root is itself a repository; it is not reviewed",
    });
  });

  // Root reads a directory whatever its mode, so the case cannot be staged there.
  it.skipIf(process.getuid?.() === 0)("warns about a directory it cannot read", async () => {
    const result = await scan(root, FULL_SCAN);
    const warning = result.warnings.find((one) => one.path === "repos/closed");
    expect(warning?.message).toContain("directory cannot be read");
    // The scan carries on: an unreadable directory costs its own subtree, nothing else.
    expect(result.repositories.map((repo) => repo.path)).toContain("repos/group/api");
  });
});

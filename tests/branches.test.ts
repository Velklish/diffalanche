/**
 * `GET /api/repos/branches` (DA-24): the branches the base picker chooses from,
 * summarised over the whole root. A base is one spec per session applied to
 * every repository, so the list is the union of their branches with how many
 * repositories carry each ([07-server.md](../docs/reference/07-server.md)).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import type { BranchList } from "../src/server/routes/branches.ts";
import { listBranches } from "../src/server/routes/branches.ts";
import { makeRoot, REPOS } from "./helpers/fixture-root.ts";

let root: string;
let config: Config;
let listed: BranchList;

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
}

function branch(name: string) {
  return listed.branches.find((one) => one.name === name);
}

beforeAll(async () => {
  root = makeRoot();
  const [alpha, beta] = REPOS;

  // A clone stands in for a remote: `git clone` writes `refs/remotes/origin/*`
  // and the `origin/HEAD` that names the default branch, which is exactly what
  // the route reads and what a `git init` fixture never has.
  const bare = mkdtempSync(join(tmpdir(), "diffalanche-remote-"));
  git(join(root, alpha), ["clone", "--bare", "-q", ".", bare]);
  git(join(root, alpha), ["remote", "add", "origin", bare]);
  git(join(root, alpha), ["fetch", "-q", "origin"]);
  git(join(root, alpha), ["remote", "set-head", "origin", "main"]);
  // A second remote, and a branch only one repository has.
  git(join(root, alpha), ["remote", "add", "upstream", bare]);
  git(join(root, alpha), ["fetch", "-q", "upstream"]);
  git(join(root, beta), ["branch", "release/2026.9"]);

  config = await loadConfig({ root });
  listed = await listBranches(config);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the branches of the root", () => {
  it("counts a branch once, with the repositories that have it", () => {
    expect(branch("main")).toMatchObject({ remote: null, repositories: REPOS.length });
  });

  it("names the remote a branch belongs to, and leaves a local one without one", () => {
    expect(branch("origin/main")?.remote).toBe("origin");
    expect(branch("upstream/main")?.remote).toBe("upstream");
    expect(branch("main")?.remote).toBeNull();
  });

  it("marks the branch the remote points its HEAD at", () => {
    expect(branch("origin/main")?.default).toBe(true);
    expect(branch("main")?.default).toBe(false);
  });

  it("does not list the HEAD pointer itself, which is not a branch", () => {
    expect(branch("origin/HEAD")).toBeUndefined();
  });

  it("keeps a branch only one repository has", () => {
    expect(branch("release/2026.9")).toMatchObject({ remote: null, repositories: 1 });
  });

  it("puts the default branch first, then the ones most repositories have", () => {
    const names = listed.branches.map((one) => one.name);
    expect(names[0]).toBe("origin/main");
    expect(names.indexOf("main")).toBeLessThan(names.indexOf("release/2026.9"));
  });

  it("names a branch the way `branch:<name>` takes it", () => {
    // The picker hands `name` to the same parser the CLI uses, untranslated.
    expect(branch("origin/main")?.name).toBe("origin/main");
  });
});

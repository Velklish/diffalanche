import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkIgnore, GIT_NULL, git, gitLines } from "../src/core/git/run.ts";

describe("read-only Git configuration policy", () => {
  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-git-policy-"));
    repo = join(root, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_NULL, GIT_CONFIG_SYSTEM: GIT_NULL },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("sets GIT_CONFIG_NOSYSTEM for buffered and streaming Git reads", async () => {
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "0");
    const args = ["-c", "alias.readenv=!printf '%s\\n' \"$GIT_CONFIG_NOSYSTEM\"", "readenv"];
    expect(await git(repo, args)).toBe("1\n");
    const lines: string[] = [];
    expect(
      await gitLines(repo, args, (line) => {
        lines.push(line);
        return true;
      }),
    ).toBe("done");
    expect(lines).toEqual(["1"]);
  });

  it("uses the default user ignore file while leaving global core.excludesFile unread", async () => {
    const configHome = join(root, "config");
    mkdirSync(join(configHome, "git"), { recursive: true });
    writeFileSync(join(configHome, "git/ignore"), "default.tmp\n");
    const custom = join(root, "custom-ignore");
    writeFileSync(custom, "custom.tmp\n");
    writeFileSync(join(root, ".gitconfig"), `[core]\n\texcludesFile = ${JSON.stringify(custom)}\n`);
    writeFileSync(join(repo, ".gitignore"), "local.tmp\n");
    writeFileSync(join(repo, ".git/info/exclude"), "info.tmp\n");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    const paths = ["default.tmp", "custom.tmp", "local.tmp", "info.tmp", "visible.ts"];
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    expect(
      execFileSync("git", ["check-ignore", "--stdin"], {
        cwd: repo,
        env: inherited,
        input: paths.join("\n"),
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .sort(),
    ).toEqual(["custom.tmp", "info.tmp", "local.tmp"]);
    expect(await checkIgnore(repo, paths)).toEqual(
      new Set(["default.tmp", "local.tmp", "info.tmp"]),
    );
    execFileSync("git", ["config", "core.excludesFile", custom], { cwd: repo });
    expect(await checkIgnore(repo, paths)).toEqual(
      new Set(["custom.tmp", "local.tmp", "info.tmp"]),
    );
  });

  it("documents the minimum Git version, runtime check and global ignore boundary", () => {
    const reference = readFileSync(new URL("../docs/reference/02-git.md", import.meta.url), "utf8");
    expect(reference).toContain("The reader requires Git 2.32 or newer");
    expect(reference).toContain("does not check the version at runtime");
    expect(reference).toContain(
      "A `core.excludesFile` set only in global configuration is not read",
    );
  });
});

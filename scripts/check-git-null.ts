/** `bun scripts/check-git-null.ts`: whether a file planted where `/dev/null` would resolve reaches
 * the reader's git, run on the Windows runner (DA-45.1, [02-git.md](../docs/reference/02-git.md)). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exit, stdout } from "node:process";
import { GIT_NULL, git } from "../src/core/git/run.ts";

const repo = mkdtempSync(join(tmpdir(), "git-null-"));
// Drive-relative on Windows: the drive of this process and the drive of git's `cwd` can differ.
const places = [...new Set([resolve(GIT_NULL), resolve(repo, GIT_NULL)])];
const planted: { path: string; made: boolean }[] = [];
for (const path of places) {
  if (existsSync(path)) continue;
  planted.push({ path, made: !existsSync(dirname(path)) });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "[user]\n\tname = planted\n[safe]\n\tdirectory = *\n");
}
const failures: string[] = [];
try {
  execFileSync("git", ["init", "-q", repo]);
  const list = await git(repo, ["config", "--show-origin", "--list"]);
  for (const path of places) {
    const by = planted.some((one) => one.path === path) ? "by this check" : "already there";
    stdout.write(`planted ${path} (${by})\n`);
  }
  stdout.write(`${list}\n`);
  if (list.includes("planted") || list.includes("safe.directory")) {
    failures.push("the reader's git read the planted file");
  }
  const hooks = spawnSync(
    "git",
    ["-c", `core.hooksPath=${GIT_NULL}`, "rev-parse", "--git-path", "hooks/pre-commit"],
    {
      cwd: repo,
      encoding: "utf8",
    },
  );
  stdout.write(`hooks resolve to ${hooks.stdout.trim()}\n`);
  if (hooks.stderr.trim() !== "") failures.push(`the hooks pin warns: ${hooks.stderr.trim()}`);
} finally {
  rmSync(repo, { recursive: true, force: true });
  for (const one of planted) {
    rmSync(one.made ? dirname(one.path) : one.path, { recursive: true, force: true });
  }
}
for (const failure of failures) stdout.write(`FAIL ${failure}\n`);
exit(failures.length === 0 ? 0 : 1);

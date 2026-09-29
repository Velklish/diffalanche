/** `bun scripts/check-git-null.ts`: whether a file planted where `/dev/null` would resolve reaches
 * the reader's git, run on the Windows runner (DA-45.1, [02-git.md](../docs/reference/02-git.md)). */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdout } from "node:process";
import { GIT_NULL, git } from "../src/core/git/run.ts";

const repo = mkdtempSync(join(tmpdir(), "git-null-"));
// Drive-relative on Windows: the drive of this process and the drive of git's `cwd` can differ.
const places = [...new Set([resolve(GIT_NULL), resolve(repo, GIT_NULL)])];
const planted: { path: string; made: boolean }[] = [];
const failures: string[] = [];
try {
  for (const path of places) {
    if (existsSync(path)) continue;
    planted.push({ path, made: !existsSync(dirname(path)) });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "[user]\n\tname = planted\n");
  }
  execFileSync("git", ["init", "-q", repo]);
  const list = await git(repo, ["config", "--show-origin", "--list"]);
  for (const path of places) {
    const by = planted.some((one) => one.path === path) ? "by this check" : "already there";
    stdout.write(`planted ${path} (${by})\n`);
  }
  stdout.write(`${list}\n`);
  if (list.includes("planted")) failures.push("the reader's git read the planted file");
  const outside = list
    .split("\n")
    .filter((line) => line.startsWith("file:") && !line.startsWith("file:.git/config"));
  if (outside.length > 0)
    failures.push(`the reader's git read a file outside the repository:\n${outside.join("\n")}`);
} finally {
  rmSync(repo, { recursive: true, force: true });
  for (const one of planted) {
    rmSync(one.made ? dirname(one.path) : one.path, { recursive: true, force: true });
  }
}
for (const failure of failures) stdout.write(`FAIL ${failure}\n`);
process.exitCode = failures.length === 0 ? 0 : 1;

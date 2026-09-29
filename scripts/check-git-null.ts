/** `bun scripts/check-git-null.ts`: whether a file planted where `/dev/null` would resolve reaches
 * the reader's git, run on the Windows runner (DA-45.1, [02-git.md](../docs/reference/02-git.md)). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exit, stdout } from "node:process";
import { GIT_NULL, git } from "../src/core/git/run.ts";

const planted = resolve(GIT_NULL);
const plant = !existsSync(planted);
const made = plant && !existsSync(dirname(planted));
if (plant) {
  mkdirSync(dirname(planted), { recursive: true });
  writeFileSync(planted, "[user]\n\tname = planted\n[safe]\n\tdirectory = *\n");
}
const repo = mkdtempSync(join(tmpdir(), "git-null-"));
const failures: string[] = [];
try {
  execFileSync("git", ["init", "-q", repo]);
  const list = await git(repo, ["config", "--show-origin", "--list"]);
  stdout.write(`planted ${planted} (${plant ? "by this check" : "already there"})\n${list}\n`);
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
  if (plant) rmSync(made ? dirname(planted) : planted, { recursive: true, force: true });
}
for (const failure of failures) stdout.write(`FAIL ${failure}\n`);
exit(failures.length === 0 ? 0 : 1);

/** A root in the layout of `docs/SPEC.md` section 10, one commit, edited line and untracked file
 * per repository, by a git with its own identity and no machine config: the same on any laptop. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIT_NULL } from "../../src/core/git/run.ts";

/** The repositories of the fixture, by their path relative to the root. */
export const REPOS = ["repos/group/alpha", "repos/group/beta"] as const;

/** The line the fixture edits, and what it says after the edit. */
export const EDITED_LINE = 5;
export const EDITED_AFTER = "five, changed";

const LINES = ["one", "two", "three", "four", "five", "six", "seven", "eight"];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_NULL, GIT_CONFIG_SYSTEM: GIT_NULL },
  });
}

/** Puts the working trees back as `makeRoot` left them, without git: repositories are built once
 * per test file and every test starts from the same change set. */
export function resetWorkingTrees(root: string): void {
  for (const repo of REPOS) {
    const edited = LINES.map((line, index) => (index === EDITED_LINE - 1 ? EDITED_AFTER : line));
    writeFileSync(join(root, repo, "file.txt"), `${edited.join("\n")}\n`);
    writeFileSync(join(root, repo, "untracked.txt"), "added by the fixture\n");
  }
}

export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-cli-"));
  mkdirSync(join(root, ".diffalanche"), { recursive: true });
  writeFileSync(
    join(root, ".diffalanche", "config.json"),
    `${JSON.stringify({ roots: ["repos"], depth: 2 }, null, 2)}\n`,
  );

  for (const repo of REPOS) {
    const dir = join(root, repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "file.txt"), `${LINES.join("\n")}\n`);
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["add", "-A"]);
    git(dir, [
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=fixture",
      "commit",
      "-qm",
      "init",
    ]);
    const edited = LINES.map((line, index) => (index === EDITED_LINE - 1 ? EDITED_AFTER : line));
    writeFileSync(join(dir, "file.txt"), `${edited.join("\n")}\n`);
    writeFileSync(join(dir, "untracked.txt"), "added by the fixture\n");
  }
  return root;
}

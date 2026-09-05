import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FileChange, RepositoryChange } from "./types.ts";

const run = promisify(execFile);

/** One `git diff` over the synthetic review is a few megabytes. */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

/**
 * Reads the change set of one repository in `head` mode: the working tree
 * against HEAD, with untracked files as additions. `git diff HEAD` rather than
 * `git diff`, so a staged change is part of the review — `docs/SPEC.md` section
 * 3, decision 4 defines the base as HEAD, not the index. Git is read through
 * the binary and never written to.
 */
export async function readRepositoryChange(
  root: string,
  repoPath: string,
): Promise<RepositoryChange> {
  const cwd = join(root, repoPath);
  const [branch, diff, untracked] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["diff", "HEAD", "--no-color", "--no-ext-diff", "-U3"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const files = parseDiff(diff);
  for (const path of untracked.split("\0").filter(Boolean)) {
    const file = await readUntracked(cwd, path);
    if (file) files.push(file);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { path: repoPath, branch: branch.trim(), base: "HEAD", files };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return stdout;
}

/**
 * An untracked file is an addition. A staged new file is already in `git diff
 * HEAD` and is not listed here, so the two sources never count the same file
 * twice.
 */
async function readUntracked(cwd: string, path: string): Promise<FileChange | null> {
  const content = await readFile(join(cwd, path));
  if (content.includes(0)) return null;
  const text = content.toString("utf8");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const tail = text.endsWith("\n") ? "" : "\n\\ No newline at end of file";
  const patch =
    `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n` +
    `@@ -0,0 +1,${lines.length} @@\n${body}${tail}\n`;
  return { path, oldPath: null, status: "added", additions: lines.length, deletions: 0, patch };
}

/** Splits `git diff` output into one patch per file. Binary files are dropped. */
export function parseDiff(raw: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | null = null;
  let body: string[] = [];
  let inHunk = false;

  const flush = () => {
    if (current) current.patch = `${body.join("\n")}\n`;
  };

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const [oldPath, path] = headerPaths(line);
      current = { path, oldPath, status: "modified", additions: 0, deletions: 0, patch: "" };
      files.push(current);
      body = [line];
      inHunk = false;
      continue;
    }
    if (!current) continue;
    body.push(line);
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line.startsWith("+")) current.additions += 1;
      else if (line.startsWith("-")) current.deletions += 1;
      continue;
    }
    if (line.startsWith("--- ")) current.oldPath = pathOf(line.slice(4));
    else if (line.startsWith("+++ ")) current.path = pathOf(line.slice(4)) ?? current.oldPath ?? "";
    else if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename to ")) current.status = "renamed";
  }
  flush();

  // A pure rename carries no hunks at all; it is still a file of the change set.
  return files.filter(
    (file) => file.path !== "" && (file.patch.includes("\n@@") || file.status === "renamed"),
  );
}

/**
 * `diff --git a/old b/new` is the only place a pure rename names its paths: it
 * has no `---` and `+++` lines. The split is on ` b/`, which a path containing
 * that sequence would defeat; the real reader (DA-7) parses the header properly.
 */
function headerPaths(line: string): [string, string] {
  const rest = line.slice("diff --git ".length);
  const split = rest.lastIndexOf(" b/");
  if (split === -1) return ["", ""];
  return [rest.slice(0, split).replace(/^a\//, ""), rest.slice(split + 3)];
}

/** `--- a/src/x.ts` and `+++ b/src/x.ts` carry a one-letter prefix; `/dev/null` carries none. */
function pathOf(value: string): string | null {
  if (value === "/dev/null") return null;
  const slash = value.indexOf("/");
  return slash === -1 ? value : value.slice(slash + 1);
}

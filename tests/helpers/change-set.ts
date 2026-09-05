/**
 * Builds the change set of a fixture repository in the shape anchor capture
 * reads: hunks with per-line old and new numbers. Core-a's DA-7 produces this
 * from `gitdiff-parser`; the test parses `git diff` itself, so the anchors it
 * checks are measured against git's own output rather than against another
 * copy of the same parser.
 */
import { execFileSync } from "node:child_process";
import type { Hunk, RepositoryChange } from "../../src/core/types.ts";

export function readHunks(root: string, repoPath: string): RepositoryChange {
  const diff = execFileSync("git", ["diff", "HEAD", "--no-color", "--no-ext-diff", "-U3"], {
    cwd: `${root}/${repoPath}`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const files: RepositoryChange["files"] = [];
  let hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      hunks = [];
      hunk = null;
      // Only `path`, `hunks`, and `omitted` are read by anchor capture; the
      // rest of a `FileChange` is filled so the value is one.
      files.push({
        path: line.slice(line.lastIndexOf(" b/") + 3),
        oldPath: null,
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: "",
        hunks,
        omitted: null,
      });
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (hunk === null) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "insert", content: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "delete", content: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ type: "context", content: line.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return {
    path: repoPath,
    branch: "main",
    base: { mode: "head", ref: "HEAD", sha: "HEAD" },
    files,
    warnings: [],
  };
}

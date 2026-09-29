/** Which lines of a file are still the lines of an earlier commit, by `git blame` — the first step
 * of re-anchoring ([02-git.md](../../../docs/reference/02-git.md), "Blame"). */
import { GitError } from "./errors.ts";
import { git, repositoryDrivers } from "./run.ts";

/** One line of porcelain output that starts a line's record: `<sha> <orig> <final>[ <count>]`. */
const RECORD = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/;

/** Each line of `path` at `at` that git traces back to `boundary` unchanged: the boundary's line
 * number to the line's number now; `null` when git has no answer, which is not an empty map. */
export async function blameFrom(
  cwd: string,
  path: string,
  boundary: string,
  at: "worktree" | { sha: string },
): Promise<Map<number, number> | null> {
  const drivers = await repositoryDrivers(cwd);
  if (drivers === null) return null;
  // `^<boundary>` with no positive revision annotates the working tree; `<boundary>..` would
  // annotate HEAD instead, which leaves out every edit not yet committed.
  const args = ["blame", "--porcelain", "-M", "--no-textconv", `^${boundary}`];
  if (at !== "worktree") args.push(at.sha);
  let raw: string;
  try {
    raw = await git(cwd, [...args, "--", path], drivers);
  } catch (error) {
    // A path the history does not have, or a boundary that is not a commit, is an answer.
    if (error instanceof GitError && error.failure === "exited") return null;
    throw error;
  }
  return parseBlame(raw, boundary);
}

/** The porcelain records attributed to `boundary`; a content line starts with a tab and never
 * matches, so a line of code that looks like a record cannot be read as one. */
export function parseBlame(raw: string, boundary: string): Map<number, number> {
  const lines = new Map<number, number>();
  for (const row of raw.split("\n")) {
    const match = RECORD.exec(row);
    if (match === null || match[1] !== boundary) continue;
    lines.set(Number(match[2]), Number(match[3]));
  }
  return lines;
}

/** Text search over a working tree: `git grep` for a fixed string, case folded, tracked and
 * untracked files alike and binaries left out ([02-git.md](../../../docs/reference/02-git.md)). */
import { gitLines } from "./run.ts";

/** One line that holds the query: the path relative to the repository, its number, its text. */
type GrepMatch = { path: string; line: number; text: string };

type GrepOptions = {
  /** The most matches kept; git is stopped at the first one past it. */
  limit: number;
  /** The most matches kept from one file; the rest of it is reached by opening it. */
  perFile: number;
  /** The files the search is narrowed to, or `null` for the whole working tree. */
  paths?: readonly string[] | null;
};

/** What the repository's own configuration could change about the output, pinned back. */
const PINNED = ["grep.column=false", "grep.fullName=false"];

/** Lines git may print per match kept before the search gives up: a bound on the whole read. */
const READ_PER_KEPT = 20;

/** Lines of one file passed over before it is set aside and git asked again without it. */
const SKIPPED_PER_FILE = 100;

/** How many files may be set aside that way before the search calls itself capped. */
const SET_ASIDE = 20;

const ARGS = ["grep", "-n", "-z", "-I", "-F", "-i", "--untracked", "--no-color", "-e"];

/** Matches in git's order and whether the read stopped with more left; a file of one word repeated
 * is set aside after its lines rather than eating the read (02-git.md, "Text search"). */
export async function grepWorktree(
  cwd: string,
  query: string,
  { limit, perFile, paths = null }: GrepOptions,
): Promise<{ matches: GrepMatch[]; capped: boolean }> {
  const matches: GrepMatch[] = [];
  // A list of no paths is no search at all, where an empty pathspec would be the whole tree.
  if (paths !== null && paths.length === 0) return { matches, capped: false };
  const kept = new Map<string, number>();
  const setAside: string[] = [];
  const finished = new Set<string>();
  let read = 0;

  for (let run = 0; run <= SET_ASIDE; run += 1) {
    const spec = [
      ...(paths ?? []).map((path) => `:(literal)${path}`),
      ...setAside.map((path) => `:(exclude,literal)${path}`),
    ];
    const skipped = new Map<string, number>();
    const seen = new Set<string>();
    let hog: string | null = null;
    let full = false;
    const ended = await gitLines(
      cwd,
      [...ARGS, query, "--", ...spec],
      (row) => {
        // `<path> NUL <line> NUL <text>`: the path may hold anything but a NUL, the text too.
        const first = row.indexOf("\0");
        const second = row.indexOf("\0", first + 1);
        if (first < 0 || second < 0) return true;
        const path = row.slice(0, first);
        // A file an earlier run read past is in `matches` already.
        if (finished.has(path)) return true;
        seen.add(path);
        read += 1;
        if (matches.length >= limit || read > limit * READ_PER_KEPT) {
          full = true;
          return false;
        }
        const count = kept.get(path) ?? 0;
        if (count >= perFile) {
          const passed = (skipped.get(path) ?? 0) + 1;
          skipped.set(path, passed);
          if (passed < SKIPPED_PER_FILE) return true;
          hog = path;
          return false;
        }
        kept.set(path, count + 1);
        matches.push({
          path,
          line: Number(row.slice(first + 1, second)),
          text: row.slice(second + 1),
        });
        return true;
      },
      PINNED,
    );
    if (hog === null || full) return { matches, capped: ended === "stopped" };
    setAside.push(hog);
    for (const path of seen) finished.add(path);
  }
  return { matches, capped: true };
}

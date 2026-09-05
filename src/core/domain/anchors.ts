/**
 * Capturing the anchor of a line comment from the change set: the line's own
 * text, the header of the hunk it sits in, and three lines of context on each
 * side (`docs/SPEC.md` section 3, decision 6). This is what Phase 3 re-anchors
 * from after the code moves, so it is taken once, when the comment is written.
 */
import type { Anchor, Side } from "../storage/index.ts";
import type { DiffLine, FileChange, Hunk, RepositoryChange } from "../types.ts";
import { DomainError } from "./errors.ts";

/** Lines of context kept on each side of the anchored line. */
const CONTEXT = 3;

function lineNumber(line: DiffLine, side: Side): number | null {
  return side === "new" ? line.newLine : line.oldLine;
}

/**
 * Finds the file in the change set, refusing with what is actually wrong: the
 * repository has no changes, the file has none, or the file was left out of the
 * diff and has no lines to anchor to at all.
 */
function findFile(repositories: RepositoryChange[], repo: string, path: string): FileChange {
  const repository = repositories.find((one) => one.path === repo);
  if (repository === undefined) {
    throw new DomainError(
      "line-not-in-diff",
      `${repo} has no changes in this review, so a line of ${path} cannot be anchored`,
    );
  }
  const file = repository.files.find((one) => one.path === path);
  if (file === undefined) {
    throw new DomainError("line-not-in-diff", `${repo}/${path} is not in the change set`);
  }
  if (file.omitted !== null) {
    throw new DomainError(
      "line-not-in-diff",
      `${repo}/${path} is ${file.omitted} and carries no diff lines; anchor the comment on the file instead`,
    );
  }
  return file;
}

/** How far a line is from a hunk on the chosen side; `0` while inside it. */
function distanceTo(hunk: Hunk, side: Side, line: number): number {
  const numbers = hunk.lines
    .map((one) => lineNumber(one, side))
    .filter((one): one is number => one !== null);
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return Number.POSITIVE_INFINITY;
  if (line >= first && line <= last) return 0;
  return line < first ? first - line : line - last;
}

function nearest(file: FileChange, side: Side, line: number): Hunk | null {
  let best: Hunk | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hunk of file.hunks) {
    const distance = distanceTo(hunk, side, line);
    if (distance < bestDistance) {
      best = hunk;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The anchor of a line comment. A line the change set does not have is refused
 * with the nearest hunk named, because "line 42 is not in the diff" alone
 * leaves the writer guessing where the diff actually is.
 */
export function captureAnchor(
  repositories: RepositoryChange[],
  repo: string,
  path: string,
  side: Side,
  line: number,
): Anchor {
  const file = findFile(repositories, repo, path);

  for (const hunk of file.hunks) {
    // The context is the neighbourhood in the file the comment is about, so it
    // is taken from the lines that side has — `context` and `insert` for `new`,
    // `context` and `delete` for `old`. The raw list holds both sides, and
    // slicing it puts text that never existed in that file into `before` and
    // `after`, which is what re-anchoring later matches against.
    const onSide = hunk.lines.filter((one) => lineNumber(one, side) !== null);
    const index = onSide.findIndex((one) => lineNumber(one, side) === line);
    if (index === -1) continue;
    const found = onSide[index];
    if (found === undefined) continue;
    return {
      lineContent: found.content,
      hunk: hunk.header,
      before: onSide.slice(Math.max(0, index - CONTEXT), index).map((one) => one.content),
      after: onSide.slice(index + 1, index + 1 + CONTEXT).map((one) => one.content),
    };
  }

  const closest = nearest(file, side, line);
  throw new DomainError(
    "line-not-in-diff",
    closest === null
      ? `${repo}/${path} has no hunks in the change set, so line ${line} cannot be anchored`
      : `line ${line} of ${repo}/${path} is not in the change set on the ${side} side; ` +
          `the nearest hunk is ${closest.header}`,
  );
}

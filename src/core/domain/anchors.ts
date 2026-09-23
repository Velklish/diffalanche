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

/** How far a line is from a hunk on the chosen side; `0` inside it, `null` when the hunk has no lines on that side. */
function distanceTo(hunk: Hunk, side: Side, line: number): number | null {
  const numbers = hunk.lines
    .map((one) => lineNumber(one, side))
    .filter((one): one is number => one !== null);
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return null;
  if (line >= first && line <= last) return 0;
  return line < first ? first - line : line - last;
}

/** `null` means no hunk of the file has lines on this side, which is not the same as no hunks. */
function nearest(file: FileChange, side: Side, line: number): Hunk | null {
  let best: Hunk | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hunk of file.hunks) {
    const distance = distanceTo(hunk, side, line);
    if (distance === null) continue;
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

  if (file.hunks.length === 0) {
    throw new DomainError(
      "line-not-in-diff",
      `${repo}/${path} has no hunks in the change set, so line ${line} cannot be anchored`,
    );
  }

  const closest = nearest(file, side, line);
  if (closest !== null) {
    throw new DomainError(
      "line-not-in-diff",
      `line ${line} of ${repo}/${path} is not in the change set on the ${side} side; ` +
        `the nearest hunk is ${closest.header}`,
    );
  }

  const other: Side = side === "new" ? "old" : "new";
  throw new DomainError(
    "line-not-in-diff",
    `${repo}/${path} is ${file.status} and its hunks have lines on the ${other} side only, ` +
      `so line ${line} cannot be anchored on the ${side} side; anchor it on the ${other} side`,
  );
}

/** `@@ -a,b +c,d @@` as numbers; a count git leaves out is one. */
function hunkRange(header: string): { old: [number, number]; new: [number, number] } | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (match === null) return null;
  const [, a, b, c, d] = match;
  return { old: [Number(a), Number(b ?? 1)], new: [Number(c), Number(d ?? 1)] };
}

/** Where a line outside every hunk's changes sits on the other side: shifted by what the hunks at
 * or above it added or took away. */
function otherSideLine(file: FileChange | null, side: Side, line: number): number {
  let shift = 0;
  for (const hunk of file?.hunks ?? []) {
    const range = hunkRange(hunk.header);
    if (range === null) continue;
    const [start, count] = range[side];
    // A hunk that starts at or above the line counts whole: a window beginning inside one begins in
    // its trailing context, after every change it holds. A count of zero sits after line `start`.
    if (count === 0 ? start >= line : start > line) break;
    shift += range.new[1] - range.old[1];
  }
  return side === "new" ? line - shift : line + shift;
}

/** The anchor of a line the change set does not carry, read from the file itself; `hunk` is the
 * header git would print for the context around it ([04-domain.md](../../../docs/reference/04-domain.md)). */
export function captureFromFile(
  text: string,
  side: Side,
  line: number,
  file: FileChange | null,
  name: string,
): Anchor {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const index = line - 1;
  const found = lines[index];
  if (found === undefined) {
    throw new DomainError(
      "invalid-anchor",
      `line ${line} of ${name} is past its end on the ${side} side: the file has ${lines.length} lines`,
    );
  }
  const before = lines.slice(Math.max(0, index - CONTEXT), index);
  const after = lines.slice(index + 1, index + 1 + CONTEXT);
  const start = line - before.length;
  const count = before.length + 1 + after.length;
  const other = otherSideLine(file, side, start);
  const hunk =
    side === "new"
      ? `@@ -${other},${count} +${start},${count} @@`
      : `@@ -${start},${count} +${other},${count} @@`;
  return { lineContent: found, hunk, before, after };
}

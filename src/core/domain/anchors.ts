/** The anchor of a line comment, taken once when it is written: Phase 3 re-anchors from it
 * ([04-domain.md](../../../docs/reference/04-domain.md), "Anchor capture"). */
import type { Anchor, Side } from "../storage/index.ts";
import type { DiffLine, FileChange, Hunk, RepositoryChange } from "../types.ts";
import { DomainError } from "./errors.ts";

/** Lines of context kept on each side of the anchored line. */
const CONTEXT = 3;

function lineNumber(line: DiffLine, side: Side): number | null {
  return side === "new" ? line.newLine : line.oldLine;
}

/** The file in the change set, or a refusal naming what is wrong: no changes in the repository,
 * none in the file, or a file left out of the diff with no lines to anchor to. */
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

/** A line the change set does not have is refused with the nearest hunk named: the bare refusal
 * leaves the writer guessing where the diff is. */
export function captureAnchor(
  repositories: RepositoryChange[],
  repo: string,
  path: string,
  side: Side,
  line: number,
): Anchor {
  const file = findFile(repositories, repo, path);

  for (const hunk of file.hunks) {
    // Context from the anchored side's lines only: the raw list holds both sides, and text from
    // the other would never have existed in that file (04-domain.md, "Anchor capture").
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
      "line-not-in-diff",
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

/** The re-anchoring cut-offs; the cases they were set by are in `tests/reanchor.test.ts` and
 * [04-domain.md](../../../docs/reference/04-domain.md), "Re-anchoring". */
export const LINE_SIMILARITY = 0.6;
export const MATCH_SCORE = 0.7;
export const MATCH_MARGIN = 0.1;
/** How much of a candidate's score is its own line; the rest is the six lines around it. */
const LINE_WEIGHT = 0.7;

/** Indentation and runs of spaces say nothing about which line it is. */
function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Edit distance, or any number above `limit` once no alignment can stay within it. */
function distance(left: string, right: string, limit: number): number {
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let i = 1; i <= left.length; i += 1) {
    const row = [i];
    let lowest = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      row.push(value);
      if (value < lowest) lowest = value;
    }
    if (lowest > limit) return limit + 1;
    previous = row;
  }
  return previous[right.length] as number;
}

/** 1 less the edit distance over the longer line, whitespace collapsed; anything under `floor`
 * answers 0 without being worked out, since the caller drops it anyway. */
export function similarity(left: string, right: string, floor = 0): number {
  const a = normalise(left);
  const b = normalise(right);
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  const limit = Math.floor((1 - floor) * longest);
  if (Math.abs(a.length - b.length) > limit) return 0;
  const edits = distance(a, b, limit);
  return edits > limit ? 0 : 1 - edits / longest;
}

/** How well the lines around `index` agree with the anchor's context, 1 with none to compare. */
function contextScore(anchor: Anchor, lines: readonly string[], index: number): number {
  const expected = [
    ...anchor.before.map((text, at) => ({ text, at: index - anchor.before.length + at })),
    ...anchor.after.map((text, at) => ({ text, at: index + 1 + at })),
  ];
  if (expected.length === 0) return 1;
  let sum = 0;
  for (const { text, at } of expected) {
    const found = lines[at];
    if (found !== undefined) sum += similarity(text, found);
  }
  return sum / expected.length;
}

/** Whether the anchored line and its context are exactly where the comment already is. */
function inPlace(anchor: Anchor, lines: readonly string[], line: number): boolean {
  const index = line - 1;
  if (lines[index] !== anchor.lineContent) return false;
  const before = anchor.before.every(
    (text, at) => lines[index - anchor.before.length + at] === text,
  );
  return before && anchor.after.every((text, at) => lines[index + 1 + at] === text);
}

/** The fuzzy step: the line the anchor now matches, or `null` when none clears the thresholds or
 * two come within the margin of each other — a comment never moves to a guess. */
export function locate(anchor: Anchor, lines: readonly string[], line: number): number | null {
  if (inPlace(anchor, lines, line)) return line;
  let best = -1;
  let bestScore = -1;
  let runnerUp = -1;
  for (const [index, text] of lines.entries()) {
    const own = similarity(anchor.lineContent, text, LINE_SIMILARITY);
    if (own < LINE_SIMILARITY) continue;
    const score = LINE_WEIGHT * own + (1 - LINE_WEIGHT) * contextScore(anchor, lines, index);
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = index;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (best === -1 || bestScore < MATCH_SCORE) return null;
  if (runnerUp > bestScore - MATCH_MARGIN) return null;
  return best + 1;
}

/** Where a new-side line of a change set sits at its base: `null` for a line the base never had,
 * and the line itself for a file the change set does not list. */
export function baseLineOf(file: FileChange | null, line: number): number | null {
  if (file === null) return line;
  if (file.omitted !== null || file.status === "added") return null;
  for (const hunk of file.hunks) {
    for (const one of hunk.lines) if (one.newLine === line) return one.oldLine;
  }
  return otherSideLine(file, "new", line);
}

/** A file's text as line numbers count it: a final newline ends the last line. */
export function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

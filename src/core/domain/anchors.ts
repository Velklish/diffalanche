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
      lineContent: normalizeLine(found.content),
      hunk: hunk.header,
      before: onSide
        .slice(Math.max(0, index - CONTEXT), index)
        .map((one) => normalizeLine(one.content)),
      after: onSide.slice(index + 1, index + 1 + CONTEXT).map((one) => normalizeLine(one.content)),
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
  const lines = fileLines(text);
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

export type AnchorMatch =
  | { kind: "matched"; line: number; endLine: number | null; anchor: Anchor }
  | { kind: "orphaned" };

export function normalizeLine(line: string): string {
  return line.replace(/\r$/, "");
}

export function fileLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function similarity(left: string, right: string): number {
  const a = left.trim();
  const b = right.trim();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/** A verified git span has priority; the text fallback accepts exactly one qualifying span. */
export function locateAnchor(
  saved: { anchor: Anchor; endLine: number | null },
  text: string,
  mapped?: { lines: number[]; content: string[] },
): AnchorMatch {
  const lines = fileLines(text);
  const body =
    saved.anchor.rangeContent?.map(normalizeLine) ??
    (saved.endLine === null ? [normalizeLine(saved.anchor.lineContent)] : null);
  if (body === null || body.length === 0) return { kind: "orphaned" };
  const finish = (start: number, end: number): AnchorMatch => ({
    kind: "matched",
    line: start,
    endLine: saved.endLine === null ? null : end,
    anchor: {
      ...captureFromFile(text, "new", start, null, "anchor target"),
      ...(saved.endLine === null ? {} : { rangeContent: lines.slice(start - 1, end) }),
    },
  });
  if (
    mapped !== undefined &&
    mapped.lines.length > 0 &&
    mapped.lines.length === mapped.content.length &&
    mapped.lines.every(
      (at, i) =>
        at > 0 &&
        (i === 0 || at > (mapped.lines[i - 1] ?? 0)) &&
        lines[at - 1] === normalizeLine(mapped.content[i] ?? ""),
    )
  ) {
    const first = mapped.lines[0];
    const last = mapped.lines.at(-1);
    if (first !== undefined && last !== undefined) return finish(first, last);
  }
  let candidate: number | null = null;
  for (let start = 0; start + body.length <= lines.length; start += 1) {
    const core =
      body.reduce((sum, value, i) => sum + similarity(value, lines[start + i] ?? ""), 0) /
      body.length;
    const context = [
      ...saved.anchor.before.map((value, i) => ({
        value,
        at: start - saved.anchor.before.length + i,
      })),
      ...saved.anchor.after.map((value, i) => ({ value, at: start + 1 + i })),
    ];
    const contextScore =
      context.length === 0
        ? core
        : context.reduce(
            (sum, { value, at }) =>
              sum + (lines[at] === undefined ? 0 : similarity(value, lines[at] ?? "")),
            0,
          ) / context.length;
    const score = context.length === 0 ? core : 0.8 * core + 0.2 * contextScore;
    const weak = body.every((value) => !/[\p{L}\p{N}_]/u.test(value));
    if (
      core < 0.85 ||
      score < 0.9 ||
      (weak && (context.length === 0 || contextScore !== 1 || core !== 1))
    )
      continue;
    if (candidate !== null) return { kind: "orphaned" };
    candidate = start;
  }
  return candidate === null ? { kind: "orphaned" } : finish(candidate + 1, candidate + body.length);
}

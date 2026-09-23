/** The context a hunk header's `↑ N lines` brings in: lines of the working tree put above the hunk,
 * numbered on both sides ([08-ui.md](../../docs/reference/08-ui.md)). */
import type { ChangeData, HunkData } from "react-diff-view";

/** How many lines one press brings in, at most. */
export const CONTEXT_STEP = 20;

/** The lines of a file as the diff numbers them: a trailing newline ends the last one. */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** For each hunk, how many new-side lines lie between it and the hunk above — or the top of the
 * file — that no hunk shows. */
export function gapsAbove(hunks: HunkData[]): number[] {
  let shown = 0;
  return hunks.map((hunk) => {
    const gap = Math.max(0, hunk.newStart - 1 - shown);
    shown = hunk.newStart + hunk.newLines - 1;
    return gap;
  });
}

/** The hunk with `count` lines of the file above it; the header stays, so what is keyed by it —
 * the decoration, the live marker — stays too. */
export function withLinesAbove(hunk: HunkData, lines: string[], count: number): HunkData {
  if (count <= 0) return hunk;
  const above: ChangeData[] = [];
  for (let back = count; back >= 1; back -= 1) {
    const newLineNumber = hunk.newStart - back;
    above.push({
      type: "normal",
      isNormal: true,
      oldLineNumber: hunk.oldStart - back,
      newLineNumber,
      content: lines[newLineNumber - 1] ?? "",
    });
  }
  return {
    ...hunk,
    oldStart: hunk.oldStart - count,
    newStart: hunk.newStart - count,
    oldLines: hunk.oldLines + count,
    newLines: hunk.newLines + count,
    changes: [...above, ...hunk.changes],
  };
}

/** The new-side lines the expansion put above each hunk, by hunk index; `starts` are the hunks'
 * own first new-side lines, as the patch has them. */
export function linesAbove(starts: number[], above: Record<number, number>): Map<number, number[]> {
  const byHunk = new Map<number, number[]>();
  for (const [index, count] of Object.entries(above)) {
    const start = starts[Number(index)];
    if (start === undefined || count <= 0) continue;
    byHunk.set(
      Number(index),
      Array.from({ length: count }, (_, at) => start - count + at),
    );
  }
  return byHunk;
}

/** The new-side lines a patch shows, and the new-side line each of its hunks starts at. */
export function newSideLines(patch: string): { lines: Set<number>; starts: number[] } {
  const lines = new Set<number>();
  const starts: number[] = [];
  let line = 0;
  let inHunk = false;
  for (const row of patch.split("\n")) {
    if (row.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (row.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 1);
      starts.push(line);
      inHunk = true;
      continue;
    }
    if (!inHunk || (row[0] !== "+" && row[0] !== " ")) continue;
    lines.add(line);
    line += 1;
  }
  return { lines, starts };
}

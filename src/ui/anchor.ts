/** Where a comment attaches, in the screen's words: the level is read from the nulls
 * (`docs/SPEC.md` section 7), and lines are numbered on the new side, as the store holds them. */
import type { ComposerTarget } from "./store.ts";
import type { Comment } from "./types.ts";

/** The line `C` and the perf harness open the composer on: the first added line, or for a pure
 * deletion the first new-side line of its first hunk, which is where the deletion left a gap. */
export function firstAddedLine(patch: string): number {
  let line = 1;
  let first: number | null = null;
  let inHunk = false;
  for (const row of patch.split("\n")) {
    // `+++ b/…` of the other half of a type change starts with a plus too.
    if (row.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (row.startsWith("@@")) {
      const start = /\+(\d+)/.exec(row)?.[1];
      line = start === undefined ? 1 : Number(start);
      first ??= line;
      inHunk = true;
      continue;
    }
    // The `+++ b/<path>` of the header starts with a plus and is not a line.
    if (!inHunk) continue;
    if (row.startsWith("+")) return line;
    // A deletion is not on the new side, so it does not advance its counter;
    // everything else — a context line, and the ` ` of an empty one — does.
    if (!row.startsWith("-") && !row.startsWith("\\")) line += 1;
  }
  return first ?? 1;
}

/** The composer's first row, `→ new side · CargoService.cs L41–43 · 3 lines` for a range, and the
 * level itself for an anchor with no line (`docs/design/HANDOFF.md` section 2). */
export function composerLabel(target: ComposerTarget, endLine: number | null): string {
  if (target.repo === null) return "→ review";
  if (target.path === null) return `→ ${target.repo} · repository`;
  if (target.line === null) return `→ ${target.path} · file`;
  const side = target.side === "old" ? "old side" : "new side";
  const lines = endLine === null ? 1 : endLine - target.line + 1;
  const range = lines > 1 ? `L${target.line}–${endLine}` : `L${target.line}`;
  return `→ ${side} · ${target.path} ${range} · ${lines} ${lines === 1 ? "line" : "lines"}`;
}

/** What a thread card says it is attached to (HANDOFF.md section 3): `L42–45`, `file`, `review`.
 * The repository is not in it: the card draws it as a button of its own, a jump (DA-54). */
export function threadAnchor(comment: Comment): string {
  if (comment.repo === null) return "review";
  if (comment.path === null) return "repository";
  if (comment.line === null) return "file";
  if (comment.endLine === null) return `L${comment.line}`;
  return `L${comment.line}–${comment.endLine}`;
}

/** The export's anchor, `src/a.ts:42-45`: the domain's `anchorLabel` again, which sits behind the
 * Node API (08-ui.md, "Types of the on-disk format"); `tests/ui-anchor.test.ts` pairs the two. */
export function exportAnchor(comment: Comment): string {
  if (comment.repo === null) return "review";
  if (comment.path === null) return "repository";
  if (comment.line === null) return comment.path;
  if (comment.endLine === null) return `${comment.path}:${comment.line}`;
  return `${comment.path}:${comment.line}-${comment.endLine}`;
}

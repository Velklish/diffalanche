/**
 * Where a comment attaches, in the words the screen uses for it. The anchor
 * level is read from the nulls, as `docs/SPEC.md` section 7 defines it, and the
 * lines are numbered on the new side, as the store holds them.
 */
import type { ComposerTarget, RailScope } from "./store.ts";
import type { Comment } from "./types.ts";

/**
 * The line the `C` key and the perf harness open the composer on: the first
 * line the change set adds to this file. A patch with no added line — a pure
 * deletion — falls back to the first line of the new side, which is where the
 * deletion left a gap.
 */
export function firstAddedLine(patch: string): number {
  let line = 1;
  let first: number | null = null;
  let inHunk = false;
  for (const row of patch.split("\n")) {
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

/**
 * The first row of the composer: `→ new side · CargoService.cs L41–43 · 3 lines`
 * for a range, and the level itself for the anchors that have no line
 * (`docs/design/HANDOFF.md` section 2).
 */
export function composerLabel(target: ComposerTarget, endLine: number | null): string {
  if (target.repo === null) return "→ review";
  if (target.path === null) return `→ ${target.repo} · repository`;
  if (target.line === null) return `→ ${target.path} · file`;
  const side = target.side === "old" ? "old side" : "new side";
  const lines = endLine === null ? 1 : endLine - target.line + 1;
  const range = lines > 1 ? `L${target.line}–${endLine}` : `L${target.line}`;
  return `→ ${side} · ${target.path} ${range} · ${lines} ${lines === 1 ? "line" : "lines"}`;
}

/**
 * What a thread card says it is attached to (`docs/design/HANDOFF.md` section
 * 3): `L42–45`, `file`, `review`, and, on the tab that spans the whole review,
 * the repository in front of it — on the file's own tab that would be the same
 * word on every card.
 */
export function threadAnchor(comment: Comment, scope: RailScope): string {
  const where =
    comment.repo === null
      ? "review"
      : comment.path === null
        ? "repository"
        : comment.line === null
          ? "file"
          : comment.endLine === null
            ? `L${comment.line}`
            : `L${comment.line}–${comment.endLine}`;
  if (scope === "file" || comment.repo === null) return where;
  return `${comment.repo.split("/").at(-1)} · ${where}`;
}

/**
 * The anchor as the export writes it: `src/a.ts:42-45`. This is the domain's
 * own `anchorLabel` written again, for the reason `src/ui/types.ts` gives about
 * its wire shapes — that module reaches the storage barrel, and the barrel
 * reaches the Node API. `tests/ui-anchor.test.ts` checks the two agree on every
 * anchor level.
 */
export function exportAnchor(comment: Comment): string {
  if (comment.repo === null) return "review";
  if (comment.path === null) return "repository";
  if (comment.line === null) return comment.path;
  if (comment.endLine === null) return `${comment.path}:${comment.line}`;
  return `${comment.path}:${comment.line}-${comment.endLine}`;
}

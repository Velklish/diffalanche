/** Re-anchoring after code edits: every line comment of a changed file is placed again by blame,
 * then by its text, or marked `orphaned` ([04-domain.md](../../../docs/reference/04-domain.md)). */

import { byCodePoint } from "../order.ts";
import type { Anchor, Comment, Side } from "../storage/index.ts";
import { readComments, readReview, updateSession } from "../storage/index.ts";
import type { FileChange, RepositoryChange, ScanWarning } from "../types.ts";
import { baseLineOf, captureAnchor, captureFromFile, linesOf, locate } from "./anchors.ts";
import type { FileSource } from "./comments.ts";
import { DomainError } from "./errors.ts";
import { commentInScope } from "./scope.ts";

/** The lines of `path` at `at` that git traces back to `boundary`: its line number to theirs now,
 * `null` when git has no answer. */
export type BlameSource = (
  repo: string,
  path: string,
  boundary: string,
  at: "worktree" | { sha: string },
) => Promise<Map<number, number> | null>;

/** Where re-anchoring reads the files and their history from; the watcher passes git's. */
export type AnchorSources = { source: FileSource; blame: BlameSource };

/** One repository's entry of the change set before a rescan and after it; `null` has no changes. */
export type RepositoryMove = {
  repo: string;
  before: RepositoryChange | null;
  after: RepositoryChange | null;
};

/** The ids a pass moved, or re-read the context of, and the ids it marked `orphaned`. */
export type Reanchored = { moved: string[]; orphaned: string[] };

type Placement =
  | { id: string; was: string; line: number; endLine: number | null; anchor: Anchor }
  | { id: string; was: string; orphaned: true };

/** What a placement was worked out from: a write that changed any of it meanwhile wins. */
function stateOf(comment: Comment): string {
  const { side, line, endLine, status, anchor } = comment;
  return JSON.stringify({ side, line, endLine, status, anchor });
}

function fileOf(change: RepositoryChange | null, path: string): FileChange | null {
  return change?.files.find((one) => one.path === path) ?? null;
}

/** The paths whose entry is not what it was, one that came or went included: their text moved. */
function changedPaths(move: RepositoryMove): Set<string> {
  const paths = new Set(
    [...(move.before?.files ?? []), ...(move.after?.files ?? [])].map((one) => one.path),
  );
  const changed = new Set<string>();
  for (const path of paths) {
    const was = fileOf(move.before, path);
    const now = fileOf(move.after, path);
    if (
      was === null ||
      now === null ||
      was.patch !== now.patch ||
      was.status !== now.status ||
      was.omitted !== now.omitted
    ) {
      changed.add(path);
    }
  }
  return changed;
}

/** The anchor at the line found, from the change set when it carries that line as the text has
 * it, otherwise from the text: the change set may already be a rescan behind the file. */
function anchorAt(
  move: RepositoryMove,
  path: string,
  side: Side,
  line: number,
  text: string,
): Anchor {
  const lines = linesOf(text);
  if (move.after !== null) {
    try {
      const taken = captureAnchor([move.after], move.repo, path, side, line);
      if (taken.lineContent === lines[line - 1]) return taken;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  return captureFromFile(text, side, line, fileOf(move.after, path), `${move.repo}/${path}`);
}

/** Blame first, taken only when it lands on the anchored text; then the text itself. */
async function place(
  comment: Comment & { path: string; line: number; anchor: Anchor },
  move: RepositoryMove,
  sources: AnchorSources,
): Promise<Placement | null> {
  const side: Side = comment.side ?? "new";
  const was = stateOf(comment);
  const before = fileOf(move.before, comment.path);
  const oldSha = move.before?.base?.sha ?? null;
  const newSha = move.after?.base?.sha ?? oldSha;
  // The new side is read from disk; the old side from the base it has now, under its old name.
  const at =
    side === "new" ? comment.path : (fileOf(move.after, comment.path)?.oldPath ?? comment.path);
  const rev = side === "new" ? "worktree" : newSha === null ? null : { sha: newSha };
  if (rev === null) return null;
  const text = await sources.source(move.repo, at, rev);
  if (text === null)
    return comment.status === "open" ? { id: comment.id, was, orphaned: true } : null;
  const lines = linesOf(text);

  let found: number | null = null;
  const boundary = oldSha ?? newSha;
  const baseLine = side === "new" ? baseLineOf(before, comment.line) : comment.line;
  if (baseLine !== null && boundary !== null) {
    const now = (await sources.blame(move.repo, at, boundary, rev))?.get(baseLine);
    if (now !== undefined && lines[now - 1] === comment.anchor.lineContent) found = now;
  }
  found ??= locate(comment.anchor, lines, comment.line);
  if (found === null) {
    // A resolved thread's place is history: it stays where it was, and stays resolved.
    return comment.status === "open" ? { id: comment.id, was, orphaned: true } : null;
  }

  const endLine =
    comment.endLine === null
      ? null
      : Math.min(found + comment.endLine - comment.line, lines.length);
  const anchor = anchorAt(move, comment.path, side, found, text);
  const same =
    found === comment.line &&
    endLine === comment.endLine &&
    JSON.stringify(anchor) === JSON.stringify(comment.anchor);
  return same ? null : { id: comment.id, was, line: found, endLine, anchor };
}

type Placeable = Comment & { path: string; line: number; anchor: Anchor };

/** The line comments a move can have shifted: new-side ones on a file whose text changed, and
 * every one of the repository once its base moved; an orphaned one waits for a human. */
function placeable(comment: Comment, move: RepositoryMove, changed: Set<string>): boolean {
  if (comment.repo !== move.repo || comment.path === null || comment.line === null) return false;
  if (comment.anchor === null || comment.status === "orphaned") return false;
  const oldSha = move.before?.base?.sha;
  const newSha = move.after?.base?.sha;
  const baseMoved = oldSha !== undefined && newSha !== undefined && oldSha !== newSha;
  if (comment.side === "old") return baseMoved;
  return baseMoved || changed.has(comment.path);
}

/** One warning per repository that holds orphaned comments, shaped as the scan's warnings are and
 * sorted the way they are, so the two lists merge into one (04-domain.md, "Re-anchoring"). */
export function anchorWarnings(
  comments: Iterable<Pick<Comment, "repo" | "status">>,
): ScanWarning[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.status !== "orphaned" || comment.repo === null) continue;
    counts.set(comment.repo, (counts.get(comment.repo) ?? 0) + 1);
  }
  return [...counts.keys()].sort(byCodePoint).map((path) => {
    const count = counts.get(path) as number;
    const message =
      count === 1 ? "1 comment lost its anchor" : `${count} comments lost their anchor`;
    return { path, message };
  });
}

/** The warnings of a change set with those of its comments, in the order the scan sorts them. */
export function withAnchorWarnings(
  warnings: readonly ScanWarning[],
  comments: Iterable<Pick<Comment, "repo" | "status">>,
): ScanWarning[] {
  const anchors = anchorWarnings(comments);
  if (anchors.length === 0) return [...warnings];
  return [...warnings, ...anchors].sort(
    (a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message),
  );
}

/** The sources with every answer kept for the pass: comments on one file read it, and blame it,
 * once between them rather than once each. */
function remembered(sources: AnchorSources): AnchorSources {
  const texts = new Map<string, Promise<string | null>>();
  const blames = new Map<string, Promise<Map<number, number> | null>>();
  const key = (...parts: unknown[]) => JSON.stringify(parts);
  return {
    source: (repo, path, rev) => {
      const at = key(repo, path, rev);
      const known = texts.get(at) ?? sources.source(repo, path, rev);
      texts.set(at, known);
      return known;
    },
    blame: (repo, path, boundary, rev) => {
      const at = key(repo, path, boundary, rev);
      const known = blames.get(at) ?? sources.blame(repo, path, boundary, rev);
      blames.set(at, known);
      return known;
    },
  };
}

/** Places every line comment one repository's move can have shifted, and writes what changed in
 * one locked write; a comment written meanwhile keeps that write (04-domain.md, "Re-anchoring"). */
export async function reanchorRepository(
  dataDir: string,
  session: string,
  move: RepositoryMove,
  sources: AnchorSources,
): Promise<Reanchored> {
  const { scope } = await readReview(dataDir, session);
  const changed = changedPaths(move);
  const comments = (await readComments(dataDir, session)).filter(
    (comment): comment is Placeable =>
      commentInScope(scope, comment) && placeable(comment, move, changed),
  );
  const placements: Placement[] = [];
  const once = remembered(sources);
  for (const comment of comments) {
    const placement = await place(comment, move, once);
    if (placement !== null) placements.push(placement);
  }
  const outcome: Reanchored = { moved: [], orphaned: [] };
  if (placements.length === 0) return outcome;

  return updateSession(dataDir, session, ({ comments: current }) => {
    for (const placement of placements) {
      const comment = current.find((one) => one.id === placement.id);
      if (comment === undefined || stateOf(comment) !== placement.was) continue;
      if ("orphaned" in placement) {
        comment.status = "orphaned";
        outcome.orphaned.push(comment.id);
        continue;
      }
      comment.line = placement.line;
      comment.endLine = placement.endLine;
      comment.anchor = placement.anchor;
      outcome.moved.push(comment.id);
    }
    return outcome;
  });
}

/** Re-anchoring after code edits: every line comment of a changed file is placed again in place,
 * by blame, then by its text, or marked `orphaned` ([04-domain.md](../../../docs/reference/04-domain.md)). */
import { setImmediate as yieldToEvents } from "node:timers/promises";
import { byCodePoint } from "../order.ts";
import type { Anchor, Comment, Lock, Side } from "../storage/index.ts";
import { readComments, readReview, updateSession } from "../storage/index.ts";
import type { FileChange, RepositoryChange, ScanWarning } from "../types.ts";
import {
  BLAME_CONTEXT,
  baseLineOf,
  captureAnchor,
  captureFromFile,
  contextScore,
  inPlace,
  linesOf,
  locate,
  newSideOf,
  sameText,
  windowOf,
} from "./anchors.ts";
import type { FileSource } from "./comments.ts";
import { isOpen } from "./counters.ts";
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

/** Where re-anchoring reads the files and their history from; every writer passes git's. */
export type AnchorSources = { source: FileSource; blame: BlameSource };

/** One repository's entry of the change set before a write and after it; `null` has no changes. */
export type RepositoryMove = {
  repo: string;
  before: RepositoryChange | null;
  after: RepositoryChange | null;
};

/** The ids a pass moved or gave a new context, and the ids it marked `orphaned`. */
export type Reanchored = { moved: string[]; orphaned: string[] };

type Moved = { id: string; path: string; line: number; endLine: number | null; anchor: Anchor };
type Placement = Moved | { id: string; orphaned: true };

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

/** The sha of each side's base, `null` where an entry has none to say. */
function shas(move: RepositoryMove): { old: string | null; now: string | null } {
  return { old: move.before?.base?.sha ?? null, now: move.after?.base?.sha ?? null };
}

/** The anchor at the line found, from the change set when it carries that line as the text has
 * it, otherwise from the text: the change set may already be a rescan behind the file. */
function anchorAt(
  move: RepositoryMove,
  path: string,
  side: Side,
  line: number,
  lines: string[],
): Anchor {
  if (move.after !== null) {
    try {
      const taken = captureAnchor([move.after], move.repo, path, side, line);
      if (taken.lineContent === lines[line - 1]) return taken;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
  const text = `${lines.join("\n")}\n`;
  return captureFromFile(text, side, line, fileOf(move.after, path), `${move.repo}/${path}`);
}

/** What one comment is placed from: the file now, and — read only when a line is not in place —
 * the tree it was placed on, as the change set before the write describes it. */
type Ground = {
  lines: string[];
  /** That tree, `null` when the entry cannot say it; blame is then not asked. */
  was: () => Promise<string[] | null>;
  /** A line of that tree as a line of the base, `null` for a line the base never had. */
  baseLine: (line: number) => number | null;
  blame: () => Promise<Map<number, number> | null>;
};

/** Line `from` of the tree placed on, found in the file now near `near`: exactly there, by blame
 * when the anchor was taken from that tree, or by its text. */
async function placeLine(
  anchor: Anchor,
  from: number,
  near: number,
  ground: Ground,
  within?: [number, number],
): Promise<number | null> {
  if (inPlace(anchor, ground.lines, near)) return near;
  const was = await ground.was();
  const window = was === null ? null : windowOf(was, from);
  const base = window !== null && sameText(window, anchor) ? ground.baseLine(from) : null;
  if (base !== null) {
    const now = (await ground.blame())?.get(base);
    // Taken only on the anchored text with a context that agrees: blame follows history, and
    // an ignore-revs file or a copy can attribute a line to a place the comment never was.
    if (
      now !== undefined &&
      ground.lines[now - 1] === anchor.lineContent &&
      contextScore(anchor, ground.lines, now - 1) >= BLAME_CONTEXT
    ) {
      return now;
    }
  }
  return locate(anchor, ground.lines, near, within);
}

/** The end of a moved range: kept at its length when its lines read the same there, placed on
 * its own when they do not, and narrowed to what still reads the same when it cannot be. */
async function placeEnd(comment: Placeable, start: number, ground: Ground): Promise<number | null> {
  const end = comment.endLine as number;
  const span = end - comment.line;
  const was = await ground.was();
  const window = was === null ? null : windowOf(was, comment.line);
  const tree = window !== null && sameText(window, comment.anchor) ? was : null;
  // Without that tree, what the anchor itself kept is all that says what the range read.
  const known =
    tree === null
      ? [comment.anchor.lineContent, ...comment.anchor.after].slice(0, span + 1)
      : tree.slice(comment.line - 1, end);
  const reads = (offset: number) => ground.lines[start - 1 + offset] === known[offset];
  const readsAll = known.every((_, offset) => reads(offset));
  if (known.length === span + 1 && readsAll) return start + span;
  // A range that did not move keeps its end while nothing known of it says otherwise.
  if (start === comment.line && readsAll) return Math.min(end, ground.lines.length);
  const endAnchor = tree === null ? null : windowOf(tree, end);
  if (endAnchor !== null) {
    // Past the start, and no further than the file's own growth could have pushed the end.
    const reach = start + span + Math.max(0, ground.lines.length - (tree?.length ?? 0));
    const placed = await placeLine(endAnchor, end, start + span, ground, [start + 1, reach]);
    if (placed !== null && placed > start) return placed;
  }
  let kept = 0;
  while (kept + 1 < known.length && reads(kept + 1)) kept += 1;
  return kept === 0 ? null : start + kept;
}

type Placeable = Comment & { path: string; line: number; anchor: Anchor };

/** One comment placed against one move, or `null` when nothing about it changes. */
async function place(
  comment: Placeable,
  move: RepositoryMove,
  sources: AnchorSources,
): Promise<Placement | null> {
  const side: Side = comment.side ?? "new";
  const { old: oldSha, now: newSha } = shas(move);
  // A file the change set now names by another path carries the comment there (`git mv`).
  const renamed =
    fileOf(move.after, comment.path) === null
      ? (move.after?.files.find((one) => one.oldPath === comment.path) ?? null)
      : null;
  const path = renamed?.path ?? comment.path;
  const after = fileOf(move.after, path);
  const before = fileOf(move.before, comment.path);
  const at = side === "new" ? path : (after?.oldPath ?? path);
  const rev = side === "new" ? "worktree" : newSha === null ? null : { sha: newSha };
  if (rev === null) return null;
  const orphan = isOpen(comment) ? { id: comment.id, orphaned: true as const } : null;

  const text = await sources.source(move.repo, at, rev);
  if (text === null) {
    // Gone only when the change set says so: a file too large, binary, mid-save or stashed away
    // is not read now and is left for the next pass (04-domain.md, "Re-anchoring").
    if (side === "new") return after?.status === "deleted" ? orphan : null;
    return after !== null && after.omitted !== null ? null : orphan;
  }
  const lines = linesOf(text);

  // With no entry before, the tree placed on was its base, whose sha only the entry after names.
  const boundary = side === "new" ? (oldSha ?? newSha) : oldSha;
  const basePath = before?.oldPath ?? comment.path;
  let tree: Promise<string[] | null> | undefined;
  const readTree = async (): Promise<string[] | null> => {
    if (boundary === null) return null;
    const base = await sources.source(move.repo, basePath, { sha: boundary });
    const baseLines = base === null ? null : linesOf(base);
    return side === "new" ? newSideOf(before, baseLines) : baseLines;
  };
  const ground: Ground = {
    lines,
    was: () => {
      tree ??= readTree();
      return tree;
    },
    baseLine: (line) => (side === "new" ? baseLineOf(before, line) : line),
    blame: async () => (boundary === null ? null : sources.blame(move.repo, at, boundary, rev)),
  };

  const start = await placeLine(comment.anchor, comment.line, comment.line, ground);
  if (start === null) return orphan;
  const endLine = comment.endLine === null ? null : await placeEnd(comment, start, ground);
  const anchor = anchorAt(move, path, side, start, lines);
  const same =
    path === comment.path &&
    start === comment.line &&
    endLine === comment.endLine &&
    sameText(anchor, comment.anchor);
  return same ? null : { id: comment.id, path, line: start, endLine, anchor };
}

/** The line comments a move can have shifted: new-side ones on a file whose text changed, and old-
 * side ones once both entries name a base and it moved; an orphaned one waits for a human. */
function placeable(comment: Comment, move: RepositoryMove, changed: Set<string>): boolean {
  if (comment.repo !== move.repo || comment.path === null || comment.line === null) return false;
  if (comment.anchor === null || comment.status === "orphaned") return false;
  const { old, now } = shas(move);
  const baseMoved = old !== null && now !== null && old !== now;
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

/** What a pass over several moves did: the comments, and the repositories it placed every comment
 * of — the others ran out of time, and their writer keeps the entries it would have replaced. */
type Pass = Reanchored & { done: string[] };

type PassOptions = {
  held?: Lock;
  /** When the pass stops starting comments (`Date.now()`): a repository it did not finish is left. */
  deadline?: number;
};

/** Places every line comment the moves can have shifted and writes only what changed, inside the
 * hold of the `diff.json` write the moves are for (04-domain.md, "Re-anchoring"). */
export async function reanchorRepositories(
  dataDir: string,
  session: string,
  moves: readonly RepositoryMove[],
  sources: AnchorSources,
  options: PassOptions = {},
): Promise<Pass> {
  const outcome: Pass = { moved: [], orphaned: [], done: [] };
  if (moves.length === 0) return outcome;
  const { scope } = await readReview(dataDir, session);
  const comments = (await readComments(dataDir, session)).filter((comment) =>
    commentInScope(scope, comment),
  );
  const placements: Placement[] = [];
  const once = remembered(sources);
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  for (const move of moves) {
    const changed = changedPaths(move);
    const found: Placement[] = [];
    let finished = true;
    for (const comment of comments) {
      if (!placeable(comment, move, changed)) continue;
      if (Date.now() >= deadline) {
        finished = false;
        break;
      }
      const placement = await place(comment as Placeable, move, once);
      if (placement !== null) found.push(placement);
      // The scoring is synchronous: between comments the process answers whatever is waiting.
      await yieldToEvents();
    }
    // Half a repository is not written: its writer keeps that entry, and the next one starts over.
    if (!finished) continue;
    placements.push(...found);
    outcome.done.push(move.repo);
  }
  // A context that only its hunk header moved in is not written, and `updatedAt` stays.
  if (placements.length === 0) return outcome;

  return updateSession(
    dataDir,
    session,
    ({ comments: current }) => {
      for (const placement of placements) {
        const comment = current.find((one) => one.id === placement.id);
        if (comment === undefined) continue;
        if ("orphaned" in placement) {
          comment.status = "orphaned";
          outcome.orphaned.push(comment.id);
          continue;
        }
        comment.path = placement.path;
        comment.line = placement.line;
        comment.endLine = placement.endLine;
        comment.anchor = placement.anchor;
        outcome.moved.push(comment.id);
      }
      return outcome;
    },
    options.held === undefined ? {} : { held: options.held },
  );
}

/** One repository's move alone, for a caller that holds nothing: its own lock is taken. */
export async function reanchorRepository(
  dataDir: string,
  session: string,
  move: RepositoryMove,
  sources: AnchorSources,
): Promise<Reanchored> {
  const { moved, orphaned } = await reanchorRepositories(dataDir, session, [move], sources);
  return { moved, orphaned };
}

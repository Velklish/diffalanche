/**
 * Global search (`docs/design/HANDOFF.md` section 6) over what the MVP has:
 * the files of the change set and the comments of the session. Unchanged files
 * come with browsing (DA-37), text search with the index (DA-38) and symbols
 * with tree-sitter (DA-39) — all Phase 2 (`docs/SPEC.md` section 3, decision
 * 13), so nothing here knows about them.
 *
 * Ranking is substring first and word overlap second, which is what a path and
 * a sentence both answer to: `store/live` finds `src/ui/store.ts` through the
 * words, and `live.ts` finds it whole.
 */
import { byCodePoint } from "../core/order.ts";
import type { FileEntry } from "./store.ts";
import type { Comment } from "./types.ts";

/** One row of the results column. */
export type SearchHit = {
  kind: "file" | "comment";
  /** `<repo>/<path>` for a file, the thread's id for a comment. */
  id: string;
  repo: string;
  path: string;
  /** The line the preview centres on; `null` for a file, which centres on its first change. */
  line: number | null;
  /** What the row shows: the path, or the first line of the comment. */
  label: string;
  /**
   * The tag beside it. The handoff's five are `file`, `file · unchanged`,
   * `symbol`, `comment` and `comment · orphaned`; the MVP has two of them —
   * unchanged files come with browsing (DA-37), text with the index (DA-38),
   * symbols with tree-sitter (DA-39), and `orphaned` is not a status the format
   * carries yet (Phase 3).
   */
  tag: "file" | "comment";
  score: number;
};

/** One row of the preview column. */
export type PreviewLine = {
  /** Its place in the patch: what the rows are keyed by, since deletions have no number. */
  at: number;
  /** The new-side number, or `null` for a line only the old side has. */
  line: number | null;
  text: string;
  kind: "add" | "del" | "context";
};

/** How many rows the results column holds; past that the query is not a search. */
const LIMIT = 40;

/** How many lines of code the preview shows around its target. */
export const PREVIEW_LINES = 12;

/** A whole-word or path-segment match is worth more than one inside a word. */
const WHOLE = 100;
const AT_BOUNDARY = 40;
const PER_WORD = 12;

/**
 * The hits of one query, best first. An empty query has no hits: the modal
 * opens on its placeholder rather than on a list of the whole review.
 */
export function search(query: string, files: FileEntry[], comments: Comment[]): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const words = needle.split(/\s+/).filter((word) => word !== "");

  const hits: SearchHit[] = [];
  for (const entry of files) {
    const score = rank(entry.id.toLowerCase(), needle, words);
    if (score === 0) continue;
    hits.push({
      kind: "file",
      id: entry.id,
      repo: entry.repo,
      path: entry.file.path,
      line: null,
      label: entry.file.path,
      tag: "file",
      score,
    });
  }
  for (const comment of comments) {
    if (comment.repo === null || comment.path === null) continue;
    const haystack = `${comment.body} ${comment.author} ${comment.path}`.toLowerCase();
    const score = rank(haystack, needle, words);
    if (score === 0) continue;
    hits.push({
      kind: "comment",
      id: comment.id,
      repo: comment.repo,
      path: comment.path,
      line: comment.line,
      label: firstLine(comment.body),
      tag: "comment",
      score,
    });
  }

  // The score first, then the path, so the same query always lists the same
  // rows in the same order — the reader's second `⌘K` is not a new list.
  hits.sort((a, b) => b.score - a.score || byCodePoint(a.id, b.id));
  return hits.slice(0, LIMIT);
}

/**
 * Substring and word overlap. The whole query inside the target is the strong
 * signal; a query whose words are scattered over it — `store live`, `ui a.ts` —
 * still counts, once per word.
 */
function rank(haystack: string, needle: string, words: string[]): number {
  let score = 0;
  const at = haystack.indexOf(needle);
  if (at >= 0) {
    score += WHOLE;
    // The start of a path segment, of a word, or of the string itself: what a
    // person typing `store.ts` means is the file, not the sentence about it.
    if (at === 0 || /[^a-z0-9]/.test(haystack[at - 1] as string)) score += AT_BOUNDARY;
  }
  for (const word of words) {
    if (word !== needle && haystack.includes(word)) score += PER_WORD;
  }
  return score;
}

function firstLine(body: string): string {
  return body.split("\n")[0] ?? body;
}

/**
 * The lines the preview column shows: the new side of the patch around a
 * target, with the deletions kept in place so the reader sees what the change
 * replaced. A file has no target of its own, so it centres on its first change
 * — which is what the person searching for a path came to look at.
 */
export function preview(patch: string, target: number | null, span = PREVIEW_LINES): PreviewLine[] {
  const rows: PreviewLine[] = [];
  let at = 0;
  let started = false;
  let firstChange = -1;

  for (const row of patch.split("\n")) {
    if (row.startsWith("@@")) {
      at = Number(/\+(\d+)/.exec(row)?.[1] ?? 1);
      started = true;
      continue;
    }
    if (!started) continue;
    const kind = row[0];
    const text = row.slice(1);
    if (kind === "-") {
      rows.push({ at: rows.length, line: null, text, kind: "del" });
      continue;
    }
    if (kind === "+") {
      if (firstChange < 0) firstChange = rows.length;
      rows.push({ at: rows.length, line: at, text, kind: "add" });
      at += 1;
      continue;
    }
    if (kind !== " ") continue;
    rows.push({ at: rows.length, line: at, text, kind: "context" });
    at += 1;
  }

  const centre =
    target === null
      ? firstChange < 0
        ? 0
        : firstChange
      : Math.max(
          0,
          rows.findIndex((row) => row.line === target),
        );
  const from = Math.max(0, centre - Math.floor(span / 2));
  return rows.slice(from, from + span);
}

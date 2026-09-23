/** Global search of handoff section 6: what it finds and how it ranks it are in
 * [08-ui.md](../../docs/reference/08-ui.md), "Global search". */
import { byCodePoint } from "../core/order.ts";
import type { FileEntry } from "./store.ts";
import type { Comment } from "./types.ts";

/** One row of the results column. */
export type SearchHit = {
  /** `plain` is a file the review does not carry: it opens in browse mode. */
  kind: "file" | "plain" | "comment";
  /** `<repo>/<path>` for a file, the thread's id for a comment. */
  id: string;
  repo: string;
  path: string;
  /** The line the preview centres on; `null` for a file, which centres on its first change. */
  line: number | null;
  /** What the row shows: the path, or the first line of the comment. */
  label: string;
  /** The tag beside it: the handoff's `file`, `file · unchanged` and `comment`; `symbol` is
   * DA-39's, and `comment · orphaned` waits for the status Phase 3 adds. */
  tag: "file" | "file · unchanged" | "comment";
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
export function search(
  query: string,
  files: FileEntry[],
  comments: Comment[],
  unchanged: { repo: string; path: string }[] = [],
): SearchHit[] {
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
  for (const { repo, path } of unchanged) {
    const id = `${repo}/${path}`;
    const score = rank(id.toLowerCase(), needle, words);
    if (score === 0) continue;
    hits.push({
      kind: "plain",
      id,
      repo,
      path,
      line: null,
      label: path,
      tag: "file · unchanged",
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
    // The header of the other half of a type change: `--- /dev/null` and
    // `+++ b/…` would read as a deletion and an addition.
    if (row.startsWith("diff --git ")) {
      started = false;
      continue;
    }
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

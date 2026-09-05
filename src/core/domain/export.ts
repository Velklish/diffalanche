/**
 * The markdown export: open comments grouped by repository, the layout of
 * `docs/design/HANDOFF.md` section 9. The UI's `raw` tab shows exactly this
 * text and `Copy .md` copies it, so it is the export, not a rendering of one.
 */
import { byCodePoint } from "../order.ts";
import type { Comment, Review } from "../storage/index.ts";
import { formatBase } from "./sessions.ts";

/** Where a comment sits, written the way the export names it. */
export function anchorLabel(comment: Comment): string {
  if (comment.repo === null) return "review";
  if (comment.path === null) return "repository";
  if (comment.line === null) return comment.path;
  if (comment.endLine === null) return `${comment.path}:${comment.line}`;
  return `${comment.path}:${comment.line}-${comment.endLine}`;
}

/** Keeps a multi-line body inside its list item. */
function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${prefix}${line}`))
    .join("\n");
}

/**
 * A block quote is per line, not per paragraph: marking only the first line
 * drops everything after a blank one out of the quote.
 */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/**
 * By code point, never by locale: the export ships from `npx` on Node and from
 * a Bun binary, and `localeCompare` would order the same review differently in
 * the two depending on the machine's ICU data.
 */
function order(a: Comment, b: Comment): number {
  return byCodePoint(a.path ?? "", b.path ?? "") || (a.line ?? 0) - (b.line ?? 0);
}

/** "1 comment", "3 comments": the export is read by people. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function section(title: string, comments: Comment[]): string[] {
  const lines = [`## ${title} — ${plural(comments.length, "comment")}`, ""];
  for (const comment of [...comments].sort(order)) {
    lines.push(`- **${comment.severity}** · \`${anchorLabel(comment)}\``, "");
    lines.push(indent(comment.body, "  "), "");
    for (const reply of comment.replies) {
      lines.push(indent(quote(`**${reply.author}** (${reply.role}) — ${reply.body}`), "  "), "");
    }
  }
  return lines;
}

/**
 * The export of the comments it is given: the caller decides whether that is
 * the open ones or all of them (`export [--status open|all]`). The heading
 * counts the open comments among them, as the design's meta line does.
 */
export function exportMarkdown(review: Review, comments: Comment[]): string {
  const open = comments.filter((comment) => comment.status === "open").length;
  const title = review.title === null ? "" : ` — ${review.title}`;
  const lines = [
    `# Review ${review.name}${title}`,
    "",
    `base ${formatBase(review.base)} · ${plural(open, "open comment")}`,
    "",
  ];

  const wholeReview = comments.filter((comment) => comment.repo === null);
  if (wholeReview.length > 0) lines.push(...section("Review", wholeReview));

  const repositories = [
    ...new Set(
      comments.map((comment) => comment.repo).filter((repo): repo is string => repo !== null),
    ),
  ].sort(byCodePoint);
  for (const repo of repositories) {
    lines.push(
      ...section(
        repo,
        comments.filter((comment) => comment.repo === repo),
      ),
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

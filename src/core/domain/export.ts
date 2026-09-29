/** The markdown export of `docs/design/HANDOFF.md` section 9; the UI's `raw` tab and `Copy .md`
 * use this very text ([04-domain.md](../../../docs/reference/04-domain.md), "Markdown export"). */
import { byCodePoint } from "../order.ts";
import type { Comment, Review } from "../storage/index.ts";
import { isOpen } from "./counters.ts";
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

/** Per line, not per paragraph: marking only the first line drops everything after a blank one
 * out of the quote. */
function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** By path, then line, by code point and never by locale ([order.ts](../order.ts) says why). */
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
    // Orphaned is open, and says so: the line named is where it was, not where it is.
    const lost = comment.status === "orphaned" ? " · orphaned" : "";
    lines.push(`- **${comment.severity}** · \`${anchorLabel(comment)}\`${lost}`, "");
    lines.push(indent(comment.body, "  "), "");
    for (const reply of comment.replies) {
      lines.push(indent(quote(`**${reply.author}** (${reply.role}) — ${reply.body}`), "  "), "");
    }
  }
  return lines;
}

/** The export of the comments it is given, open or all as the caller chose; the heading counts
 * the open ones among them, as the design's meta line does. */
export function exportMarkdown(review: Review, comments: Comment[]): string {
  const open = comments.filter(isOpen).length;
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

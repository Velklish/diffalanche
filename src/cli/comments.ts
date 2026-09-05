/**
 * What the comment commands share: the body they are given, where a comment
 * sits, and how a thread is printed. `docs/SPEC.md` sections 8 and 9.
 */
import type { Config } from "../core/config/index.ts";
import { anchorLabel } from "../core/domain/index.ts";
import { findRepositories } from "../core/index.ts";
import type { Comment, Reply, Role } from "../core/storage/index.ts";
import { ROLES, SEVERITIES, SIDES } from "../core/storage/index.ts";
import type { Arguments } from "./args.ts";
import { required } from "./args.ts";
import { repositoryNotFound, UsageError } from "./errors.ts";
import type { Output } from "./output.ts";
import { readStandardInput } from "./stdin.ts";

export { ROLES, SEVERITIES, SIDES };

/** `docs/SPEC.md` section 8: an agent that names neither is an agent. */
export const DEFAULT_AUTHOR = "agent";
export const DEFAULT_ROLE: Role = "agent";

/**
 * The body of a comment or a reply. `-` reads standard input, which is how a
 * long finding gets in without the shell mangling it.
 */
export async function readBody(args: Arguments, io: Output): Promise<string> {
  const value = required(args, "body");
  if (value !== "-") return requireText(value);
  // A trailing newline is how a heredoc and a pipe both end; it is not content.
  return requireText((await (io.input ?? readStandardInput)()).replace(/\n+$/, ""));
}

function requireText(body: string): string {
  if (body.trim() === "") throw new UsageError("--body: expected text, got nothing");
  return body;
}

/**
 * Refuses a `--repo` that names no repository under the root. It runs before
 * anything a command writes: a path nothing is at is a mistyped flag, and a
 * command that has already rewritten `diff.json` or stored a comment on a
 * repository the review does not have leaves the mistake behind it.
 */
export async function assertRepository(config: Config, repo: string): Promise<void> {
  const found = await findRepositories(config);
  if (!found.includes(repo)) throw repositoryNotFound(repo);
}

/** Where a comment sits, in one string: the anchor levels of `docs/SPEC.md` section 7. */
export function where(comment: Comment): string {
  if (comment.repo === null) return "the review";
  if (comment.path === null) return comment.repo;
  return `${comment.repo}/${anchorLabel(comment)}`;
}

/** The first line of a body, for a table that has one row per thread. */
export function firstLine(body: string): string {
  const [line = ""] = body.split("\n");
  return line;
}

function message(author: string, role: Role, at: string): string {
  return `${author} (${role}) at ${at}`;
}

/**
 * One thread as a person reads it: the comment, the lines its anchor was taken
 * from with the anchored one marked, and every reply.
 */
export function thread(comment: Comment): string {
  const lines = [
    `${comment.id}  ${comment.severity}  ${comment.status}`,
    `${where(comment)}${comment.side === null ? "" : ` (${comment.side})`}`,
    message(comment.author, comment.role, comment.createdAt),
    "",
    comment.body,
    "",
  ];
  if (comment.anchor !== null) {
    lines.push(`anchor  ${comment.anchor.hunk}`);
    for (const before of comment.anchor.before) lines.push(`    ${before}`);
    lines.push(`  > ${comment.anchor.lineContent}`);
    for (const after of comment.anchor.after) lines.push(`    ${after}`);
    lines.push("");
  }
  if (comment.resolvedBy !== null) {
    lines.push(`resolved by ${comment.resolvedBy} at ${comment.resolvedAt}`, "");
  }
  for (const reply of comment.replies) lines.push(...replyLines(reply));
  return `${lines.join("\n").trimEnd()}\n`;
}

function replyLines(reply: Reply): string[] {
  return [`${reply.id}  ${message(reply.author, reply.role, reply.createdAt)}`, "", reply.body, ""];
}

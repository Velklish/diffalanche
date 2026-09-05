/** `list`: the comments of the review session, filtered (`docs/SPEC.md` section 8). */

import type { CommentFilter } from "../../core/domain/index.ts";
import { list as listComments } from "../../core/domain/index.ts";
import { choice, flag, noExtra, text } from "../args.ts";
import type { Command } from "../command.ts";
import { firstLine, SEVERITIES, where } from "../comments.ts";
import { UsageError } from "../errors.ts";
import { json, table } from "../output.ts";

const STATUSES = ["open", "resolved", "all"] as const;

export const list: Command = {
  spec: {
    name: "list",
    about: "the comments of the review session",
    options: {
      status: {
        type: "string",
        value: "<open|resolved|all>",
        about: "which comments; default: open",
      },
      repo: { type: "string", value: "<path>", about: "only this repository" },
      severity: {
        type: "string",
        value: "<critical|warning|nit|question>",
        about: "only this severity",
      },
      unanswered: {
        type: "boolean",
        about: "only threads whose last message is from a human",
      },
      json: { type: "boolean", about: "print the comments with their anchors" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const repo = text(args, "repo");
    const severity = choice(args, "severity", SEVERITIES);
    const filter: CommentFilter = {
      status: choice(args, "status", STATUSES) ?? "open",
      ...(repo === undefined ? {} : { repo }),
      ...(severity === undefined ? {} : { severity }),
      ...(flag(args, "unanswered") ? { unanswered: true } : {}),
    };

    const session = await context.session();
    const { dataDir } = await context.config();
    // A `--repo` here is checked against the comments, not against the root: a
    // repository that was renamed or removed still has everything that was ever
    // said about it, and `list` is how it is read back.
    if (repo !== undefined) {
      const everything = await listComments(dataDir, session);
      if (!everything.some((comment) => comment.repo === repo)) {
        throw new UsageError(`--repo: no comment in this review session is on "${repo}"`);
      }
    }
    const comments = await listComments(dataDir, session, filter);

    if (flag(args, "json")) {
      json(context.io, comments);
      return 0;
    }
    if (comments.length === 0) {
      context.io.out("no comments match\n");
      return 0;
    }
    context.io.out(
      `${table(
        comments.map((comment) => [
          comment.id,
          comment.severity,
          comment.status,
          where(comment),
          comment.author,
          firstLine(comment.body),
        ]),
      )}\n`,
    );
    return 0;
  },
};

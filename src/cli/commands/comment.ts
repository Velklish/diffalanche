/**
 * `comment`: a new comment, with its anchor taken from the change set
 * (`docs/SPEC.md` sections 8 and 9). This is how an agent opens a finding.
 */

import { addComment, readSession } from "../../core/domain/index.ts";
import { refreshRepository } from "../../core/index.ts";
import { choice, count, noExtra, requiredChoice, text } from "../args.ts";
import type { Command } from "../command.ts";
import {
  assertRepository,
  DEFAULT_AUTHOR,
  DEFAULT_ROLE,
  ROLES,
  readBody,
  SEVERITIES,
  SIDES,
  where,
} from "../comments.ts";

export const comment: Command = {
  spec: {
    name: "comment",
    about: "open a comment on a line, a file, a repository, or the review",
    options: {
      repo: { type: "string", value: "<path>", about: "the repository; without it, the review" },
      path: { type: "string", value: "<path>", about: "the file inside the repository" },
      line: { type: "string", value: "<n>", about: "the line in the file" },
      "end-line": { type: "string", value: "<n>", about: "the last line of a range" },
      side: { type: "string", value: "<new|old>", about: "which side of the diff; default: new" },
      severity: {
        type: "string",
        value: "<critical|warning|nit|question>",
        about: "how bad it is",
      },
      body: { type: "string", value: "<text|->", about: "the finding; - reads standard input" },
      author: {
        type: "string",
        value: "<name>",
        about: `who is writing; default: ${DEFAULT_AUTHOR}`,
      },
      role: { type: "string", value: "<human|agent>", about: `default: ${DEFAULT_ROLE}` },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const severity = requiredChoice(args, "severity", SEVERITIES);
    const body = await readBody(args, context.io);
    const repo = text(args, "repo") ?? null;
    const path = text(args, "path") ?? null;
    const line = count(args, "line") ?? null;

    const session = await context.session();
    const config = await context.config();
    // Before anything is written: a comment stored on a repository the review
    // does not have shows up in `list` and in `export` and nowhere in the UI.
    if (repo !== null) await assertRepository(config, repo);
    // The anchor is captured from `diff.json`, so the repository the line is in
    // is read again first: a comment written right after an edit has to point
    // at the line that is there now.
    if (line !== null && repo !== null) {
      const review = await readSession(config.dataDir, session);
      await refreshRepository(config, session, review.base, repo);
    }

    const written = await addComment(config.dataDir, session, {
      repo,
      path,
      line,
      endLine: count(args, "end-line") ?? null,
      side: choice(args, "side", SIDES) ?? "new",
      severity,
      body,
      author: text(args, "author") ?? DEFAULT_AUTHOR,
      role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
    });
    context.io.out(`${written.id} opened on ${where(written)}\n`);
    return 0;
  },
};

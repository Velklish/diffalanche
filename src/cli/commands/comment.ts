/** `comment`: a new comment, anchored from the change set or, for a line it does not carry, from
 * the file itself (`docs/SPEC.md` sections 8 and 9; ADR-004, amendment of 2026-09-23). */

import {
  addComment,
  assertAnchorInScope,
  assertAnchorLevels,
  readSession,
} from "../../core/domain/index.ts";
import { fileSourceAt } from "../../core/git/browse.ts";
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
    const endLine = count(args, "end-line") ?? null;

    const session = await context.session();
    const config = await context.config();
    const review = await readSession(config.dataDir, session);
    // Before anything is written: a comment stored on a repository the review
    // does not have shows up in `list` and in `export` and nowhere in the UI.
    if (repo !== null) await assertRepository(config, repo);
    // And before the repository is read again: a comment outside the scope is
    // refused, so an anchor the task is not about costs no git process on its
    // way to the refusal. The domain checks it too, for every caller.
    assertAnchorInScope(review, repo, path);
    // And the levels, for the same reason: an anchor that is not a level is
    // refused by `addComment` anyway, after the read this saves.
    assertAnchorLevels({ repo, path, line, endLine });
    // The anchor is captured from `diff.json`, so the repository the line is in
    // is read again first: a comment written right after an edit has to point
    // at the line that is there now.
    if (line !== null && repo !== null) {
      await refreshRepository(config, session, review.base, repo, review.scope);
    }

    // A line outside the change set is anchored from the file itself, as the UI's are (ADR-004).
    const written = await addComment(
      config.dataDir,
      session,
      {
        repo,
        path,
        line,
        endLine,
        side: choice(args, "side", SIDES) ?? "new",
        severity,
        body,
        author: text(args, "author") ?? DEFAULT_AUTHOR,
        role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
      },
      { source: fileSourceAt(config.root) },
    );
    context.io.out(`${written.id} opened on ${where(written)}\n`);
    return 0;
  },
};

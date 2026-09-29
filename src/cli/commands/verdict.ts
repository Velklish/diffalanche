/** `resolve` and `reopen`: the status of a thread, which only a human sets; the refusal is the
 * domain's, since a skill is advice ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)). */

import type { Verdict } from "../../core/domain/index.ts";
import {
  get as getComment,
  readSession,
  reopen as reopenComment,
  resolve as resolveComment,
} from "../../core/domain/index.ts";
import { fileSourceAt } from "../../core/git/browse.ts";
import { refreshRepository } from "../../core/index.ts";
import type { Arguments } from "../args.ts";
import { choice, count, noExtra, positional, text } from "../args.ts";
import type { Command } from "../command.ts";
import { DEFAULT_AUTHOR, DEFAULT_ROLE, ROLES, where } from "../comments.ts";
import { UsageError } from "../errors.ts";

const ROLE_OPTION = {
  type: "string",
  value: "<human|agent>",
  about: `only human may; default: ${DEFAULT_ROLE}`,
} as const;

const AUTHOR_OPTION = {
  type: "string",
  value: "<name>",
  about: `who is writing; default: ${DEFAULT_AUTHOR}`,
} as const;

function verdict(args: Arguments, note: string | undefined): Verdict {
  return {
    author: text(args, "author") ?? DEFAULT_AUTHOR,
    role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
    ...(note === undefined ? {} : { note }),
  };
}

export const resolve: Command = {
  spec: {
    name: "resolve",
    arguments: "<id>",
    about: "close a thread; --role human is required",
    options: {
      note: { type: "string", value: "<text>", about: "written into the thread before it closes" },
      author: AUTHOR_OPTION,
      role: ROLE_OPTION,
    },
  },
  run: async (context, args) => {
    const id = positional(args, 0, "<id>");
    noExtra(args, 1);
    const session = await context.session();
    const { dataDir } = await context.config();
    const comment = await resolveComment(dataDir, session, id, verdict(args, text(args, "note")));
    context.io.out(`${comment.id} resolved by ${comment.resolvedBy}\n`);
    return 0;
  },
};

export const reopen: Command = {
  spec: {
    name: "reopen",
    arguments: "<id>",
    about: "open a thread again; --role human is required",
    options: {
      note: { type: "string", value: "<text>", about: "written into the thread as it opens" },
      line: {
        type: "string",
        value: "<n>",
        about: "the line the comment belongs to now; required for an orphaned one",
      },
      "end-line": { type: "string", value: "<n>", about: "the last line of a range" },
      author: AUTHOR_OPTION,
      role: ROLE_OPTION,
    },
  },
  run: async (context, args) => {
    const id = positional(args, 0, "<id>");
    noExtra(args, 1);
    const line = count(args, "line");
    const endLine = count(args, "end-line");
    if (line === undefined && endLine !== undefined) {
      throw new UsageError("--end-line: the range needs its first line, --line");
    }
    const session = await context.session();
    const config = await context.config();
    const given = verdict(args, text(args, "note"));
    // The anchor is taken from `diff.json`, so the comment's repository is read again first, as
    // `comment` does; for a role the domain refuses anyway, nothing is read.
    if (line !== undefined && given.role === "human") {
      const found = await getComment(config.dataDir, session, id);
      if (found.repo !== null && found.path !== null) {
        const review = await readSession(config.dataDir, session);
        await refreshRepository(config, session, review.base, found.repo, review.scope);
      }
    }
    const comment = await reopenComment(
      config.dataDir,
      session,
      id,
      { ...given, ...(line === undefined ? {} : { line, endLine: endLine ?? null }) },
      { source: fileSourceAt(config.root) },
    );
    context.io.out(
      line === undefined
        ? `${comment.id} is open again\n`
        : `${comment.id} is open again on ${where(comment)}\n`,
    );
    return 0;
  },
};

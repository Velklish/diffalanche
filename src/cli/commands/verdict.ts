/**
 * `resolve` and `reopen`: the status of a thread. Only a human sets it, and the
 * refusal is the domain's — a skill is advice, and an agent that never read one
 * could still close a thread ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)).
 */

import type { Verdict } from "../../core/domain/index.ts";
import { reopen as reopenComment, resolve as resolveComment } from "../../core/domain/index.ts";
import type { Arguments } from "../args.ts";
import { choice, noExtra, positional, text } from "../args.ts";
import type { Command } from "../command.ts";
import { DEFAULT_AUTHOR, DEFAULT_ROLE, ROLES } from "../comments.ts";

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
      author: AUTHOR_OPTION,
      role: ROLE_OPTION,
    },
  },
  run: async (context, args) => {
    const id = positional(args, 0, "<id>");
    noExtra(args, 1);
    const session = await context.session();
    const { dataDir } = await context.config();
    const comment = await reopenComment(dataDir, session, id, verdict(args, text(args, "note")));
    context.io.out(`${comment.id} is open again\n`);
    return 0;
  },
};

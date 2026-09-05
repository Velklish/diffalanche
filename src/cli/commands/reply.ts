/** `reply <id>`: a message inside a thread (`docs/SPEC.md` sections 8 and 9). */
import { reply as addReply } from "../../core/domain/index.ts";
import { choice, noExtra, positional, text } from "../args.ts";
import type { Command } from "../command.ts";
import { DEFAULT_AUTHOR, DEFAULT_ROLE, ROLES, readBody } from "../comments.ts";

export const reply: Command = {
  spec: {
    name: "reply",
    arguments: "<id>",
    about: "reply in a thread",
    options: {
      body: { type: "string", value: "<text|->", about: "the message; - reads standard input" },
      author: {
        type: "string",
        value: "<name>",
        about: `who is writing; default: ${DEFAULT_AUTHOR}`,
      },
      role: { type: "string", value: "<human|agent>", about: `default: ${DEFAULT_ROLE}` },
    },
  },
  run: async (context, args) => {
    const id = positional(args, 0, "<id>");
    noExtra(args, 1);
    const body = await readBody(args, context.io);
    const session = await context.session();
    const { dataDir } = await context.config();
    const comment = await addReply(dataDir, session, id, {
      body,
      author: text(args, "author") ?? DEFAULT_AUTHOR,
      role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
    });
    const last = comment.replies.at(-1);
    // The first word of the line is the id a script reads back, so there is no
    // stand-in for it: a thread that came back without the reply just written
    // is not a case with a sensible answer.
    if (last === undefined) throw new Error(`${comment.id} came back without the reply`);
    context.io.out(`${last.id} added to ${comment.id}\n`);
    return 0;
  },
};

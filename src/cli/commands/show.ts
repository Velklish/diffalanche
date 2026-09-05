/** `show <id>`: one comment with its thread and its anchor (`docs/SPEC.md` section 8). */
import { get } from "../../core/domain/index.ts";
import { flag, noExtra, positional } from "../args.ts";
import type { Command } from "../command.ts";
import { thread } from "../comments.ts";
import { json } from "../output.ts";

export const show: Command = {
  spec: {
    name: "show",
    arguments: "<id>",
    about: "one comment with its thread and its anchor",
    options: {
      json: { type: "boolean", about: "print the comment record" },
    },
  },
  run: async (context, args) => {
    const id = positional(args, 0, "<id>");
    noExtra(args, 1);
    const session = await context.session();
    const { dataDir } = await context.config();
    const comment = await get(dataDir, session, id);
    if (flag(args, "json")) json(context.io, comment);
    else context.io.out(thread(comment));
    return 0;
  },
};

/** `version`: what is installed. It reads no configuration and no session. */
import { noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import { VERSION } from "../version.ts";

export const version: Command = {
  spec: { name: "version", about: "print the version of diffalanche", options: {} },
  run: async (context, args) => {
    noExtra(args, 0);
    context.io.out(`${VERSION}\n`);
    return 0;
  },
};

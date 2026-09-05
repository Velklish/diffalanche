/** What a command module exports: its definitions and what it does with them. */
import type { Arguments } from "./args.ts";
import type { Context } from "./context.ts";
import type { CommandSpec } from "./spec.ts";

export type Command = {
  spec: CommandSpec;
  /** The exit code; `0` for everything that worked. */
  run: (context: Context, args: Arguments) => Promise<number>;
};

/**
 * The commands both delivery channels expose, and the three exit codes of
 * [06-cli.md](../../docs/reference/06-cli.md): `0` for a run that worked, `1`
 * for a user error — one line on standard error — and `2` for anything the tool
 * did not expect, with the stack trace that is the only useful thing to say
 * about it.
 */
import { DomainError } from "../core/domain/index.ts";
import { StorageError } from "../core/storage/index.ts";
import type { UiAssets } from "../server/assets.ts";
import { flag, parse } from "./args.ts";
import type { Command } from "./command.ts";
import { comment } from "./commands/comment.ts";
import { diff } from "./commands/diff.ts";
import { exportReview } from "./commands/export.ts";
import { list } from "./commands/list.ts";
import { reply } from "./commands/reply.ts";
import { reviewBase, reviewList, reviewNew, reviewUse } from "./commands/review.ts";
import { serve } from "./commands/serve.ts";
import { show } from "./commands/show.ts";
import { reopen, resolve } from "./commands/verdict.ts";
import { version } from "./commands/version.ts";
import { createContext } from "./context.ts";
import { UsageError } from "./errors.ts";
import type { Output } from "./output.ts";
import { group, overview, usage } from "./spec.ts";
import { VERSION } from "./version.ts";

export type { Output } from "./output.ts";

/** In the order `--help` lists them: the review first, then what it is read with. */
const COMMANDS: Command[] = [
  serve,
  reviewNew,
  reviewUse,
  reviewList,
  reviewBase,
  diff,
  list,
  show,
  reply,
  comment,
  resolve,
  reopen,
  exportReview,
  version,
];

/** The command whose name the arguments start with, and what is left for it. */
function select(argv: string[]): { command: Command; rest: string[] } | undefined {
  // Longest first, so `review new` is matched before a one-word `review` ever
  // could be added next to it.
  const ordered = [...COMMANDS].sort(
    (a, b) => b.spec.name.split(" ").length - a.spec.name.split(" ").length,
  );
  for (const command of ordered) {
    const words = command.spec.name.split(" ");
    if (words.every((word, index) => argv[index] === word)) {
      return { command, rest: argv.slice(words.length) };
    }
  }
  return undefined;
}

/** The subcommands of a group, in the order `--help` lists them. */
function subcommands(prefix: string): string[] {
  return COMMANDS.filter((command) => command.spec.name.startsWith(`${prefix} `)).map((command) =>
    command.spec.name.slice(prefix.length + 1),
  );
}

/** The commands both delivery channels expose; the entry points only pick the UI assets. */
export async function run(argv: string[], ui: UiAssets, output: Output): Promise<number> {
  try {
    return await dispatch(argv, ui, output);
  } catch (error) {
    // Everything the tool refuses on purpose is one line: what is wrong, and
    // which file, field, or flag it is wrong in.
    if (
      error instanceof UsageError ||
      error instanceof DomainError ||
      error instanceof StorageError
    ) {
      output.err(`diffalanche: ${error.message.replace(/\s*\n\s*/g, " ")}\n`);
      return 1;
    }
    output.err(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return 2;
  }
}

async function dispatch(argv: string[], ui: UiAssets, output: Output): Promise<number> {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    output.out(
      overview(
        VERSION,
        COMMANDS.map((command) => command.spec),
      ),
    );
    return 0;
  }
  if (first === "--version") {
    output.out(`${VERSION}\n`);
    return 0;
  }

  const selected = select(argv);
  if (selected === undefined) {
    // `review` is a group and not a command: on its own, or with a subcommand
    // it does not have, it answers with what it does have rather than with
    // "unknown command: review", which reads as if there were no such word.
    const names = subcommands(first);
    if (names.length > 0) {
      if (argv.includes("--help") || argv.includes("-h")) {
        output.out(
          group(
            first,
            COMMANDS.filter((command) => command.spec.name.startsWith(`${first} `)).map(
              (command) => command.spec,
            ),
          ),
        );
        return 0;
      }
      throw new UsageError(`${first} needs a subcommand: ${names.join(", ")}`);
    }
    throw new UsageError(`unknown command: ${first} (run "diffalanche --help")`);
  }
  const args = parse(selected.command.spec, selected.rest);
  if (flag(args, "help")) {
    output.out(usage(selected.command.spec));
    return 0;
  }
  return selected.command.run(createContext(args, output, ui), args);
}

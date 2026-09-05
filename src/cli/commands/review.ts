/**
 * `review new`, `review use`, `review list`, and `review base`: the review
 * sessions of `docs/SPEC.md` section 8, each one call into the domain.
 */
import {
  createSession,
  formatBase,
  listSessions,
  parseBaseArgument,
  setBase,
  useSession,
} from "../../core/domain/index.ts";
import { flag, noExtra, positional, text } from "../args.ts";
import type { Command } from "../command.ts";
import { json, table } from "../output.ts";

/** The base a session gets when `review new` is not told one. */
const DEFAULT_BASE = "head";

const BASE_VALUE = "<head|branch|branch:<name>|<ref>>";

export const reviewNew: Command = {
  spec: {
    name: "review new",
    arguments: "<name>",
    about: "create a review session and make it current",
    options: {
      base: {
        type: "string",
        value: BASE_VALUE,
        about: `what the change set is read against; default: ${DEFAULT_BASE}`,
      },
      title: { type: "string", value: "<text>", about: "what the review is about" },
    },
  },
  run: async (context, args) => {
    const name = positional(args, 0, "<name>");
    noExtra(args, 1);
    const base = parseBaseArgument(text(args, "base") ?? DEFAULT_BASE);
    const { dataDir } = await context.config();
    const review = await createSession(dataDir, name, base, text(args, "title"));
    context.io.out(
      `created review session ${review.name} (base ${formatBase(review.base)}); it is now current\n`,
    );
    return 0;
  },
};

export const reviewUse: Command = {
  spec: {
    name: "review use",
    arguments: "<name>",
    about: "make a review session the current one",
    options: {},
  },
  run: async (context, args) => {
    const name = positional(args, 0, "<name>");
    noExtra(args, 1);
    const { dataDir } = await context.config();
    const review = await useSession(dataDir, name);
    context.io.out(
      `review session ${review.name} (base ${formatBase(review.base)}) is now current\n`,
    );
    return 0;
  },
};

export const reviewList: Command = {
  spec: {
    name: "review list",
    about: "the review sessions, most recently updated first",
    options: {
      json: { type: "boolean", about: "print the session records" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const { dataDir } = await context.config();
    const listed = await listSessions(dataDir);
    if (flag(args, "json")) {
      json(context.io, listed);
      return 0;
    }
    for (const warning of listed.warnings) context.io.err(`warning: ${warning}\n`);
    if (listed.sessions.length === 0) {
      context.io.out("no review sessions yet: create one with `diffalanche review new <name>`\n");
      return 0;
    }
    const rows = listed.sessions.map((session) => [
      `${session.current ? "*" : " "} ${session.name}`,
      formatBase(session.base),
      `${session.open} open`,
      `${session.resolved} resolved`,
      session.repositories === null ? "not scanned" : `${session.repositories} repositories`,
      session.title ?? "",
    ]);
    context.io.out(`${table(rows)}\n`);
    return 0;
  },
};

export const reviewBase: Command = {
  spec: {
    name: "review base",
    arguments: BASE_VALUE,
    about: "change what the change set of a review session is read against",
    options: {},
  },
  run: async (context, args) => {
    const value = positional(args, 0, BASE_VALUE);
    noExtra(args, 1);
    const session = await context.session();
    const { dataDir } = await context.config();
    const review = await setBase(dataDir, session, parseBaseArgument(value));
    context.io.out(`review session ${review.name}: base is now ${formatBase(review.base)}\n`);
    return 0;
  },
};

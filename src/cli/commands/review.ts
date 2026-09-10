/**
 * `review new`, `review use`, `review list`, `review base`, `review scope`, and
 * `review close`/`review reopen`: the review sessions of `docs/SPEC.md` section
 * 8, each one call into the domain.
 */
import { findRepositories } from "../../core/change-set.ts";
import {
  assertScope,
  closeSession,
  createSession,
  formatBase,
  formatScope,
  isEmptyChange,
  listSessions,
  narrowScope,
  parseBaseArgument,
  readSession,
  reopenSession,
  type ScopeChange,
  setBase,
  setScope,
  useSession,
  widenScope,
} from "../../core/domain/index.ts";
import type { Scope } from "../../core/storage/index.ts";
import type { Arguments } from "../args.ts";
import { choice, flag, noExtra, positional, text, texts } from "../args.ts";
import type { Command } from "../command.ts";
import { DEFAULT_AUTHOR, DEFAULT_ROLE, ROLES } from "../comments.ts";
import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { json, table } from "../output.ts";

/** The base a session gets when `review new` is not told one. */
const DEFAULT_BASE = "head";

const BASE_VALUE = "<head|branch|branch:<name>|<ref>>";

/** The two flags that name what a review task is about, written once. */
const SCOPE_OPTIONS = {
  repo: {
    type: "string",
    value: "<path>",
    multiple: true,
    about: "a whole repository of the scope; repeat for several",
  },
  path: {
    type: "string",
    value: "<repo>:<file>",
    multiple: true,
    about: "one file of one repository; repeat for several",
  },
} as const;

/**
 * `--path <repo>:<file>`. The repository comes first and the colon separates
 * them, so a path with a colon in it still reads: the first colon is the
 * separator and everything after it is the file.
 */
function parsePathFlag(value: string): { repo: string; path: string } {
  const colon = value.indexOf(":");
  const repo = colon === -1 ? "" : value.slice(0, colon);
  const path = colon === -1 ? "" : value.slice(colon + 1);
  if (repo === "" || path === "") {
    throw new UsageError(`--path: expected <repo>:<file>, got "${value}"`);
  }
  return { repo, path };
}

/** What the `--repo` and `--path` flags of one command add up to. */
function scopeChange(repos: string[], paths: string[]): ScopeChange {
  return { repos, paths: paths.map(parsePathFlag) };
}

/** The scope a set of flags names, or `null` when they name nothing at all. */
function scopeOf(change: ScopeChange): Scope {
  if (isEmptyChange(change)) return null;
  return widenScope([], change);
}

/** The scope of a session as `review scope` prints it, one row per entry. */
function scopeRows(scope: Scope): string[][] {
  return (scope ?? []).map((entry) => [
    entry.repo,
    entry.paths === null ? "the whole repository" : entry.paths.join(", "),
  ]);
}

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
      ...SCOPE_OPTIONS,
      "no-use": {
        type: "boolean",
        about: "create the task without making it current; prints its address",
      },
    },
  },
  run: async (context, args) => {
    const name = positional(args, 0, "<name>");
    noExtra(args, 1);
    const base = parseBaseArgument(text(args, "base") ?? DEFAULT_BASE);
    const scope = scopeOf(scopeChange(texts(args, "repo"), texts(args, "path")));
    const config = await context.config();
    // Before the session exists: a task whose scope names a repository the root
    // has not is a task that shows nothing, and it must not be left on disk for
    // the next `review list` to explain.
    if (scope !== null) assertScope(scope, await findRepositories(config));

    const use = !flag(args, "no-use");
    const review = await createSession(config.dataDir, name, base, text(args, "title"), {
      scope,
      use,
    });
    const about = review.scope === null ? "" : ` about ${formatScope(review.scope)}`;
    if (use) {
      context.io.out(
        `created review session ${review.name} (base ${formatBase(review.base)})${about}; ` +
          "it is now current\n",
      );
      return 0;
    }
    // The address rather than the name alone: an agent that opens a task hands
    // the human a link and leaves `current` where it is
    // ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
    context.io.out(
      `created review session ${review.name} (base ${formatBase(review.base)})${about}; ` +
        "current is unchanged\n",
    );
    context.io.out(`http://127.0.0.1:${config.port}/?review=${review.name}\n`);
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
      session.status,
      `${session.open} open`,
      `${session.resolved} resolved`,
      session.repositories === null ? "not scanned" : `${session.repositories} repositories`,
      `scope: ${session.scope === null ? "the whole root" : formatScope(session.scope)}`,
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

export const reviewScope: Command = {
  spec: {
    name: "review scope",
    about: "what the review session is about",
    options: {
      json: { type: "boolean", about: "print the scope as JSON" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const session = await context.session();
    const { dataDir } = await context.config();
    const review = await readSession(dataDir, session);
    if (flag(args, "json")) {
      json(context.io, { name: review.name, scope: review.scope });
      return 0;
    }
    if (review.scope === null) {
      context.io.out(`review session ${review.name} has no scope: it is about the whole root\n`);
      return 0;
    }
    context.io.out(`${table(scopeRows(review.scope))}\n`);
    return 0;
  },
};

export const reviewScopeAdd: Command = {
  spec: {
    name: "review scope add",
    about: "widen what the review session is about",
    options: { ...SCOPE_OPTIONS },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const change = scopeChange(texts(args, "repo"), texts(args, "path"));
    if (isEmptyChange(change)) throw new UsageError("--repo or --path is required");
    const session = await context.session();
    const config = await context.config();
    const review = await readSession(config.dataDir, session);
    const next = widenScope(review.scope, change);
    // Widening never leaves a comment outside the scope, so the consent to
    // delete comments is neither asked for nor needed here.
    const updated = await setScope(config.dataDir, session, next, await findRepositories(config), {
      dropComments: false,
    });
    context.io.out(
      `review session ${session}: the scope is now ${formatScope(updated.review.scope)}\n`,
    );
    return 0;
  },
};

export const reviewScopeRemove: Command = {
  spec: {
    name: "review scope remove",
    about: "narrow what the review session is about",
    options: {
      ...SCOPE_OPTIONS,
      "drop-comments": {
        type: "boolean",
        about: "delete the comments anchored under what is removed",
      },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const change = scopeChange(texts(args, "repo"), texts(args, "path"));
    if (isEmptyChange(change)) throw new UsageError("--repo or --path is required");
    const session = await context.session();
    const config = await context.config();
    const review = await readSession(config.dataDir, session);
    const next = narrowScope(review.scope, change);
    const updated = await setScope(config.dataDir, session, next, await findRepositories(config), {
      dropComments: flag(args, "drop-comments"),
    });
    const dropped =
      updated.dropped.length === 0
        ? ""
        : `; ${updated.dropped.length} comment${updated.dropped.length === 1 ? "" : "s"} deleted ` +
          `with it (${updated.dropped.map((comment) => comment.id).join(", ")})`;
    context.io.out(
      `review session ${session}: the scope is now ${formatScope(updated.review.scope)}${dropped}\n`,
    );
    return 0;
  },
};

/**
 * The session `review close` and `review reopen` work on: the name typed after
 * the command, else `--review`, else the current one. Several agents work on
 * several tasks at once, and each names the one it means
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
 */
async function named(context: Context, args: Arguments): Promise<string> {
  return args.positionals[0] ?? (await context.session());
}

export const reviewClose: Command = {
  spec: {
    name: "review close",
    arguments: "[<name>]",
    about: "mark a review session closed; comments still work on a closed one",
    options: {
      role: { type: "string", value: "<human|agent>", about: "only a human may close a task" },
      author: {
        type: "string",
        value: "<name>",
        about: `who closed it; default: ${DEFAULT_AUTHOR}`,
      },
    },
  },
  run: async (context, args) => {
    noExtra(args, 1);
    const { dataDir } = await context.config();
    // The role is checked in the domain, as it is for `resolve`: a task is
    // closed by a human ([ADR-004](../../../docs/adr/adr-004-agent-contract.md),
    // [ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
    const review = await closeSession(dataDir, await named(context, args), {
      author: text(args, "author") ?? DEFAULT_AUTHOR,
      role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
    });
    context.io.out(`review session ${review.name} is closed\n`);
    return 0;
  },
};

export const reviewReopen: Command = {
  spec: {
    name: "review reopen",
    arguments: "[<name>]",
    about: "open a closed review session again",
    options: {
      role: { type: "string", value: "<human|agent>", about: "only a human may reopen a task" },
      author: {
        type: "string",
        value: "<name>",
        about: `who is reopening it; default: ${DEFAULT_AUTHOR}`,
      },
    },
  },
  run: async (context, args) => {
    noExtra(args, 1);
    const { dataDir } = await context.config();
    const review = await reopenSession(dataDir, await named(context, args), {
      author: text(args, "author") ?? DEFAULT_AUTHOR,
      role: choice(args, "role", ROLES) ?? DEFAULT_ROLE,
    });
    context.io.out(`review session ${review.name} is open again\n`);
    return 0;
  },
};

/** `diff`: the change set of the session, rescanned and rewritten by every run that exits 0
 * ([06-cli.md](../../../docs/reference/06-cli.md)). */

import { relative, sep } from "node:path";
import { writeChangeSet } from "../../core/change-set.ts";
import type { Config } from "../../core/config/index.ts";
import {
  formatScope,
  list as listComments,
  readSession,
  repositoryInScope,
  withAnchorWarnings,
} from "../../core/domain/index.ts";
import { scanReview, totalsOf } from "../../core/index.ts";
import type { Comment, DiffCache } from "../../core/storage/index.ts";
import { commentsPath, StorageError, sessionDir, withLock } from "../../core/storage/index.ts";
import type { ScanWarning } from "../../core/types.ts";
import { flag, noExtra, text } from "../args.ts";
import type { Command } from "../command.ts";
import { repositoryNotFound, UsageError } from "../errors.ts";
import { json } from "../output.ts";

/** The change set as one patch to read, not to apply: two repositories' `a/…` would collide,
 * so a `#` line announces each (06-cli.md, "The change set"). */
function patch(cache: DiffCache): string {
  const parts: string[] = [];
  for (const repository of cache.repositories) {
    const base = repository.base === null ? "no base" : `against ${repository.base.ref}`;
    parts.push(`# ${repository.path} (${repository.branch}, ${base})\n`);
    for (const file of repository.files) {
      if (file.omitted !== null) {
        parts.push(`# ${file.path}: ${file.omitted}, listed without content\n`);
        continue;
      }
      parts.push(file.patch);
    }
  }
  return parts.join("");
}

/** What `--repo` leaves of the change set, totals counted again for what is printed; a path
 * with no repository was refused before the cache was written (06-cli.md, "The change set"). */
function narrow(cache: DiffCache, repo: string | undefined): DiffCache {
  if (repo === undefined) return cache;
  const repositories = cache.repositories.filter((one) => one.path === repo);
  return {
    ...cache,
    repositories,
    totals: totalsOf(repositories),
    warnings: cache.warnings.filter((warning) => warning.path === repo),
    ...(cache.rootWarnings === undefined
      ? {}
      : { rootWarnings: cache.rootWarnings.filter((warning) => warning.path === repo) }),
  };
}

/** The comments, or the refusal of a `comments.json` that cannot be read: a warning of `diff`,
 * which has already written `diff.json` by then (06-cli.md, "The change set"). */
async function readable(dataDir: string, session: string): Promise<Comment[] | StorageError> {
  try {
    return await listComments(dataDir, session);
  } catch (error) {
    if (error instanceof StorageError && error.file === commentsPath(dataDir, session))
      return error;
    throw error;
  }
}

/** The warning for that file, its path relative to the root as every warning's is. */
function unreadableWarning(config: Config, error: StorageError): ScanWarning {
  const reason = error.message.slice(error.file.length + 2);
  return {
    path: relative(config.root, error.file).split(sep).join("/"),
    message: `cannot be read, so no comment was re-anchored and orphans are not counted: ${reason}`,
  };
}

/** A repository whose comments the write could not place, its entry kept for the next writer; an
 * unreadable `comments.json` has its own warning above (06-cli.md, "Comments"). */
function pendingWarnings(written: {
  pending: string[];
  failure: unknown;
  unreadable: StorageError | null;
}): ScanWarning[] {
  if (written.unreadable !== null) return [];
  const why =
    written.failure === null
      ? "ran out of time"
      : `failed: ${written.failure instanceof Error ? written.failure.message : String(written.failure)}`;
  return written.pending.map((path) => ({
    path,
    message: `re-anchoring its comments ${why}; the next command that reads it tries again`,
  }));
}

export const diff: Command = {
  spec: {
    name: "diff",
    about: "the change set of the review session; rewrites diff.json",
    options: {
      repo: { type: "string", value: "<path>", about: "only this repository" },
      json: { type: "boolean", about: "print the change set as JSON" },
      patch: { type: "boolean", about: "print the change set as a unified patch (the default)" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const asJson = flag(args, "json");
    if (asJson && flag(args, "patch")) {
      throw new UsageError("--json and --patch ask for two different outputs; pass one");
    }
    const session = await context.session();
    const config = await context.config();
    const review = await readSession(config.dataDir, session);

    // The scope narrows what is read and stored (ADR-010); `--repo` narrows only what is
    // printed, so the cache never says the rest has no changes (06-cli.md, "The change set").
    const scanned = await scanReview(config, review.base, review.scope);
    // Before the write: an empty change set means the repository is there and
    // has nothing to show, and a path nothing is at must not print the same.
    const repo = text(args, "repo");
    if (repo !== undefined && !scanned.found.includes(repo)) throw repositoryNotFound(repo);
    // A repository the root has but the task is not about is refused by its own message: an
    // empty change set would read as "nothing changed there".
    if (repo !== undefined && !repositoryInScope(review.scope, repo)) {
      throw new UsageError(
        `no repository "${repo}" in the scope of review session "${review.name}", ` +
          `which is about ${formatScope(review.scope)}`,
      );
    }
    // Under the session's lock, like every other writer of this file: a write
    // between the watcher's read and its write is gone without a trace.
    const written = await withLock(sessionDir(config.dataDir, session), (held) =>
      writeChangeSet(config, session, held, scanned.cache),
    );

    // What is printed counts the orphaned comments in; the file keeps the scan's own list.
    const comments = written.unreadable === null ? await readable(config.dataDir, session) : null;
    const unreadable = written.unreadable ?? (comments instanceof StorageError ? comments : null);
    const counted = Array.isArray(comments) ? comments : [];
    const warnings = withAnchorWarnings(
      [...scanned.cache.warnings, ...pendingWarnings(written)],
      counted,
    );
    const narrowed = narrow({ ...scanned.cache, warnings }, repo);
    // About the session rather than a repository, so no `--repo` narrows it away.
    const shown =
      unreadable === null
        ? narrowed
        : { ...narrowed, warnings: [...narrowed.warnings, unreadableWarning(config, unreadable)] };

    if (asJson) {
      json(context.io, shown);
      return 0;
    }
    for (const warning of shown.warnings) {
      context.io.err(`warning: ${warning.path}: ${warning.message}\n`);
    }
    context.io.out(patch(shown));
    return 0;
  },
};

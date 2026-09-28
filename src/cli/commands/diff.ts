/** `diff`: the change set of the session, rescanned and rewritten by every run that exits 0
 * ([06-cli.md](../../../docs/reference/06-cli.md)). */
import { formatScope, readSession, repositoryInScope } from "../../core/domain/index.ts";
import { scanReview, totalsOf } from "../../core/index.ts";
import type { DiffCache } from "../../core/storage/index.ts";
import { sessionDir, withLock, writeDiffCache } from "../../core/storage/index.ts";
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
    await withLock(sessionDir(config.dataDir, session), async (held) => {
      await held.assertHeld();
      await writeDiffCache(config.dataDir, session, scanned.cache);
    });

    const shown = narrow(scanned.cache, repo);

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

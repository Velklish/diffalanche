/**
 * `diff`: the change set of the current review session, the same one the UI
 * shows. Every run scans the whole root and rewrites `diff.json`, so an agent
 * without a running server reads the review here (`docs/SPEC.md` section 8).
 */
import { readSession } from "../../core/domain/index.ts";
import { scanReview, totalsOf } from "../../core/index.ts";
import type { DiffCache } from "../../core/storage/index.ts";
import { writeDiffCache } from "../../core/storage/index.ts";
import { flag, noExtra, text } from "../args.ts";
import type { Command } from "../command.ts";
import { repositoryNotFound, UsageError } from "../errors.ts";
import { json } from "../output.ts";

/**
 * The change set as one patch. It is not a patch to apply — the files of one
 * repository are all `a/…` and `b/…`, and two repositories would collide — so
 * every repository is announced by a comment line before its files, the way
 * `git format-patch` puts prose above the diff it carries.
 */
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

/**
 * What `--repo` leaves of the change set: that repository and the warnings
 * about it. The totals are counted again, so the numbers of the output always
 * describe the repositories printed under them.
 *
 * A path the scan found no repository at never reaches this: it is refused
 * before the cache is written, because a mistyped flag must not leave the
 * review rewritten behind it.
 */
function narrow(cache: DiffCache, repo: string | undefined): DiffCache {
  if (repo === undefined) return cache;
  const repositories = cache.repositories.filter((one) => one.path === repo);
  return {
    ...cache,
    repositories,
    totals: totalsOf(repositories),
    warnings: cache.warnings.filter((warning) => warning.path === repo),
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

    // The scan covers the whole root and the cache holds all of it: `--repo`
    // narrows what is printed, never what is stored, because a cache with one
    // repository in it would tell the UI and the next `comment` that the rest
    // of the review has no changes.
    const scanned = await scanReview(config, review.base);
    // Before the write: an empty change set means the repository is there and
    // has nothing to show, and a path nothing is at must not print the same.
    const repo = text(args, "repo");
    if (repo !== undefined && !scanned.found.includes(repo)) throw repositoryNotFound(repo);
    await writeDiffCache(config.dataDir, session, scanned.cache);

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

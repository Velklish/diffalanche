/** `GET /api/repos/:repo/tree` and `…/file`: a repository of the review outside its diff, inside
 * the task's scope ([07-server.md](../../../docs/reference/07-server.md)). */
import { join } from "node:path";
import type { Context } from "hono";
import type { Config } from "../../core/config/index.ts";
import type { FileSource } from "../../core/domain/index.ts";
import { pathInScope } from "../../core/domain/index.ts";
import { fileSourceAt, listTree, readFileAt } from "../../core/git/browse.ts";
import type { FileContent, RepositoryChange, RepositoryTree } from "../../core/types.ts";
import type { ErrorBody } from "../errors.ts";
import { RequestError } from "../errors.ts";
import type { ReviewService } from "../review.ts";

/** The repository of the review a request names, with the scope it is read under; `null` when the
 * review does not show it. */
async function reviewed(
  review: ReviewService,
  repo: string,
  session: string | undefined,
): Promise<{ change: RepositoryChange; covers: (path: string) => boolean } | null> {
  const document = await review.document(session);
  const change = document.repositories.find((one) => one.path === repo);
  if (change === undefined) return null;
  return { change, covers: (path) => pathInScope(document.session.scope, repo, path) };
}

function missingRepository(c: Context, repo: string): Response {
  return c.json<ErrorBody>(
    { error: "no-such-repository", message: `no repository ${repo} in this change set` },
    404,
  );
}

export async function treeRoute(
  c: Context,
  config: Config,
  review: ReviewService,
  session: string | undefined,
): Promise<Response> {
  const repo = c.req.param("repo") ?? "";
  const found = await reviewed(review, repo, session);
  if (found === null) return missingRepository(c, repo);
  const sha = found.change.base?.sha ?? null;
  const files = await listTree(join(config.root, repo), sha);
  return c.json<RepositoryTree>({
    repo,
    sha,
    files: files.filter((one) => found.covers(one.path)),
  });
}

export async function fileRoute(
  c: Context,
  config: Config,
  review: ReviewService,
  session: string | undefined,
): Promise<Response> {
  const repo = c.req.param("repo") ?? "";
  const path = c.req.query("path");
  if (path === undefined || path === "") throw new RequestError("path is required");
  const rev = c.req.query("rev") ?? "worktree";
  if (rev !== "worktree" && rev !== "base") {
    throw new RequestError("rev has to be one of worktree, base");
  }
  const found = await reviewed(review, repo, session);
  if (found === null) return missingRepository(c, repo);
  const sha = rev === "base" ? (found.change.base?.sha ?? null) : null;
  const missing = (message: string) => c.json<ErrorBody>({ error: "no-such-file", message }, 404);
  // Outside the scope is not a file of this task, the way the tree does not list it (ADR-010).
  if (!found.covers(path)) {
    return missing(`${repo}/${path} is not in the scope of this review task`);
  }
  if (rev === "base" && sha === null) return missing(`${repo} has no base revision to read`);
  const read = await readFileAt(join(config.root, repo), path, sha === null ? "worktree" : { sha });
  if (read === null) {
    const where = rev === "base" ? "the base revision" : "the working tree";
    return missing(`${repo}/${path} is not in ${where}`);
  }
  return c.json<FileContent>({ repo, path, rev, sha, ...read });
}

/** What the domain reads a line from when the change set does not carry it (04-domain.md). */
export function fileSource(config: Config): FileSource {
  return fileSourceAt(config.root);
}

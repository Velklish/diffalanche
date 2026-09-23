/** `GET /api/search/text`: a fixed string in the working tree of every repository of the review,
 * capped and paged, each hit with its neighbours ([07-server.md](../../../docs/reference/07-server.md)). */
import { join } from "node:path";
import type { Context } from "hono";
import { mapWithLimit, SCAN_CONCURRENCY } from "../../core/change-set.ts";
import type { Config } from "../../core/config/index.ts";
import { scopeEntry } from "../../core/domain/index.ts";
import { readListed } from "../../core/git/browse.ts";
import { grepWorktree } from "../../core/git/grep.ts";
import type { TextHit, TextSearch } from "../../core/types.ts";
import { RequestError } from "../errors.ts";
import type { ReviewService } from "../review.ts";

/** The most matches one search reads, over every repository together. */
export const TEXT_CAP = 500;
/** The hits one page carries. */
export const TEXT_PAGE = 50;
/** The lines one file contributes: the list says which files hold the text, the file the rest. */
export const TEXT_PER_FILE = 3;
/** The lines shown on each side of a hit: with it, the preview column's eleven rows. */
export const TEXT_NEIGHBOURS = 5;
/** A shorter query matches most of every file, and is not a search. */
export const TEXT_MIN_QUERY = 2;

export async function textRoute(
  c: Context,
  config: Config,
  review: ReviewService,
  session: string | undefined,
): Promise<Response> {
  const query = (c.req.query("q") ?? "").trim();
  if (/[\n\0]/.test(query)) throw new RequestError("q is one line of text");
  const page = Number(c.req.query("page") ?? "0");
  if (!Number.isInteger(page) || page < 0) throw new RequestError("page is a whole number");
  const empty: TextSearch = { query, hits: [], page, next: null, total: 0, capped: false };
  if (query.length < TEXT_MIN_QUERY) return c.json(empty);

  const document = await review.document(session);
  const scope = document.session.scope;
  // Every repository at once, each read up to the whole cap; the order is the review's own.
  const found = await mapWithLimit(document.repositories, SCAN_CONCURRENCY, async (repo) => {
    const paths = scopeEntry(scope, repo.path)?.paths ?? null;
    const read = await grepWorktree(join(config.root, repo.path), query, {
      limit: TEXT_CAP,
      perFile: TEXT_PER_FILE,
      paths,
    });
    return { repo: repo.path, ...read };
  });
  const all = found.flatMap((one) => one.matches.map((match) => ({ repo: one.repo, ...match })));
  const capped = all.length > TEXT_CAP || found.some((one) => one.capped);
  const kept = all.slice(0, TEXT_CAP);
  const slice = kept.slice(page * TEXT_PAGE, (page + 1) * TEXT_PAGE);

  // The neighbours are read for this page only, one read per file however many hits it holds.
  const files = new Map<string, Promise<string[] | null>>();
  const linesOf = (repo: string, path: string) => {
    const key = `${repo}\n${path}`;
    let held = files.get(key);
    if (held === undefined) {
      held = readListed(join(config.root, repo), path).then((read) => {
        if (read === null || read.text === null) return null;
        const lines = read.text.split("\n");
        if (lines.at(-1) === "") lines.pop();
        return lines;
      });
      files.set(key, held);
    }
    return held;
  };
  const hits: TextHit[] = await Promise.all(
    slice.map(async (match) => {
      const lines = await linesOf(match.repo, match.path);
      const at = match.line - 1;
      return {
        ...match,
        before: lines?.slice(Math.max(0, at - TEXT_NEIGHBOURS), at) ?? [],
        after: lines?.slice(at + 1, at + 1 + TEXT_NEIGHBOURS) ?? [],
      };
    }),
  );
  const next = (page + 1) * TEXT_PAGE < kept.length ? page + 1 : null;
  return c.json<TextSearch>({ query, hits, page, next, total: kept.length, capped });
}

/** `GET /api/search/text`: a fixed string in the working tree of every repository of the review,
 * capped and paged, each hit with its neighbours ([07-server.md](../../../docs/reference/07-server.md)). */
import { join } from "node:path";
import type { Context } from "hono";
import { mapWithLimit, SCAN_CONCURRENCY } from "../../core/change-set.ts";
import type { Config } from "../../core/config/index.ts";
import { pathInScope, scopeEntry } from "../../core/domain/index.ts";
import { readListed } from "../../core/git/browse.ts";
import { grepWorktree } from "../../core/git/grep.ts";
import type { LanguageSpec, SymbolIndex } from "../../core/ml/symbols/index.ts";
import { BUNDLED_LANGUAGES, createSymbolIndex } from "../../core/ml/symbols/index.ts";
import type { SymbolHit, SymbolSearch, TextHit, TextSearch } from "../../core/types.ts";
import { RequestError } from "../errors.ts";
import type { EventStream } from "../events.ts";
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

  const hits: TextHit[] = await withNeighbours(config, slice);
  const next = (page + 1) * TEXT_PAGE < kept.length ? page + 1 : null;
  return c.json<TextSearch>({ query, hits, page, next, total: kept.length, capped });
}

/** The lines around each hit, one read of a file however many hits it holds; the paths came from
 * git, so the listing check of the file route is not asked again. */
async function withNeighbours<T extends { repo: string; path: string; line: number }>(
  config: Config,
  found: T[],
): Promise<(T & { before: string[]; after: string[] })[]> {
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
  return Promise.all(
    found.map(async (one) => {
      const lines = await linesOf(one.repo, one.path);
      const at = one.line - 1;
      return {
        ...one,
        before: lines?.slice(Math.max(0, at - TEXT_NEIGHBOURS), at) ?? [],
        after: lines?.slice(at + 1, at + 1 + TEXT_NEIGHBOURS) ?? [],
      };
    }),
  );
}

/** How many definitions one answer carries. */
export const SYMBOL_LIMIT = 20;

/** What indexing 300 files may take; what it took is recorded in 09-ml.md. */
export const SYMBOL_INDEX_BUDGET_MS = 20_000;

/** `GET /api/search/symbols`: the definitions whose names answer the query, in the repositories
 * of the review and inside its scope ([07-server.md](../../../docs/reference/07-server.md)). */
export async function symbolRoute(
  c: Context,
  config: Config,
  review: ReviewService,
  session: string | undefined,
  index: SymbolIndex,
): Promise<Response> {
  const query = (c.req.query("q") ?? "").trim();
  if (/[\n\0]/.test(query)) throw new RequestError("q is one line of text");
  if (query.length < TEXT_MIN_QUERY) {
    return c.json<SymbolSearch>({ query, hits: [], failed: index.failures() });
  }
  const document = await review.document(session);
  const scope = document.session.scope;
  // The index is per repository and shared by every task; the scope is applied to what it answers.
  const found = await index.query(document.repositories, query, SYMBOL_LIMIT, (def) =>
    pathInScope(scope, def.repo, def.path),
  );
  const hits: SymbolHit[] = await withNeighbours(config, found);
  return c.json<SymbolSearch>({ query, hits, failed: index.failures() });
}

/** The bundled languages and those of `config.json`: an entry of the same name replaces a bundled
 * one, and an extension a configured language names is its own. */
export function languagesOf(config: Config): LanguageSpec[] {
  const configured = Object.entries(config.grammars).map(([name, grammar]) => ({
    name,
    grammar: `${name}.wasm`,
    path: grammar.path,
    extensions: grammar.extensions,
    query: grammar.query,
  }));
  const named = new Set(configured.map((one) => one.name));
  return [...BUNDLED_LANGUAGES.filter((one) => !named.has(one.name)), ...configured];
}

/** The symbol index of a server, made when a review is first read; from then on every
 * `diff-changed` the stream carries is handed to it ([09-ml.md](../../../docs/reference/09-ml.md)). */
export function symbolIndexOf(config: Config, events: EventStream): () => SymbolIndex {
  let index: SymbolIndex | null = null;
  return () => {
    if (index !== null) return index;
    const made = createSymbolIndex({ root: config.root, languages: languagesOf(config) });
    events.subscribe({
      session: null,
      end: () => {},
      send: (frame) => {
        if (frame.event !== "diff-changed") return;
        const data = JSON.parse(frame.data) as { repo?: unknown; files?: unknown };
        if (typeof data.repo !== "string" || !Array.isArray(data.files)) return;
        const files = data.files.filter((one): one is string => typeof one === "string");
        void made.changed(data.repo, files).catch(() => {});
      },
    });
    index = made;
    return made;
  };
}

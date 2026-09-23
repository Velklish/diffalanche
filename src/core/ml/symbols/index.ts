/** The symbol index: definitions per repository, parsed with tree-sitter from the working tree,
 * built in the background and kept by the change set ([09-ml.md](../../../../docs/reference/09-ml.md)). */
import { access, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Language, Parser, Query } from "web-tree-sitter";
import { listTree, readListed } from "../../git/browse.ts";
import type { GrammarSource } from "./grammars.ts";
import { grammarSource } from "./grammars.ts";
import type { LanguageSpec, SymbolKind } from "./languages.ts";
import { SYMBOL_KINDS } from "./languages.ts";
import { matchScore } from "./match.ts";

export type { LanguageSpec } from "./languages.ts";
export { BUNDLED_LANGUAGES } from "./languages.ts";
export { matchScore } from "./match.ts";

/** One definition: where it is, what it is called, and the line that declares it. */
type SymbolDef = {
  repo: string;
  path: string;
  line: number;
  name: string;
  kind: SymbolKind;
  text: string;
};

/** A repository as the review shows it: its path, and the files of its change set with their
 * patches — what tells the index which files to read again. */
type RepositoryView = { path: string; files: readonly { path: string; patch: string }[] };

/** A language whose grammar or query would not load: only its files go unindexed. */
type LanguageFailure = { language: string; message: string };

type SymbolIndexOptions = {
  root: string;
  languages: readonly LanguageSpec[];
  source?: GrammarSource;
};

export type SymbolIndex = {
  /** Starts reading these repositories without waiting: what opening the review does. */
  warm: (repos: readonly RepositoryView[]) => void;
  /** The best definitions for `query` that `keep` keeps; a repository not read yet is read first. */
  query: (
    repos: readonly RepositoryView[],
    query: string,
    limit: number,
    keep?: (def: SymbolDef) => boolean,
  ) => Promise<SymbolDef[]>;
  /** A `diff-changed` frame: its files are read again, or the whole repository when the frame
   * cannot be trusted to name them — empty, or naming a path not on disk. */
  changed: (repo: string, files: readonly string[]) => Promise<void>;
  failures: () => LanguageFailure[];
};

type Loaded = { language: Language; query: Query };

/** The runtime, imported when the index is first asked: the CLI that never searches never loads it. */
type Runtime = typeof import("web-tree-sitter");

/** One repository: its definitions by file — every update chained onto them, so a question waits
 * for the updates asked before it — and the change set they were last checked against. */
type Held = { defs: Promise<Map<string, SymbolDef[]>>; seen: Map<string, string> };

const KINDS: ReadonlySet<string> = new Set(SYMBOL_KINDS);

/** One runtime a process: `Parser.init` a second time, under a parser another index is using,
 * corrupts the WASM memory both share (`memory access out of bounds`). */
let shared: Promise<Runtime> | null = null;

function runtimeFrom(grammars: GrammarSource): Promise<Runtime> {
  shared ??= (async () => {
    const loaded = await import("web-tree-sitter");
    await loaded.Parser.init({ wasmBinary: await grammars.runtime() });
    return loaded;
  })();
  // A runtime that failed to start is not kept: the next index asks again.
  shared.catch(() => {
    shared = null;
  });
  return shared;
}

function patchesOf(view: RepositoryView): Map<string, string> {
  return new Map(view.files.map((file) => [file.path, file.patch]));
}

/** The files whose patch differs between two change sets, those in only one of them included. */
function moved(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path));
}

export function createSymbolIndex({ root, languages, source }: SymbolIndexOptions): SymbolIndex {
  const byExtension = new Map<string, LanguageSpec>();
  for (const spec of languages) {
    for (const extension of spec.extensions) byExtension.set(extension.toLowerCase(), spec);
  }
  const grammars = source ?? grammarSource();
  const loaded = new Map<string, Promise<Loaded | null>>();
  const failed = new Map<string, string>();
  const repositories = new Map<string, Held>();

  const specOf = (path: string) => byExtension.get(extname(path).toLowerCase());

  const runtime = () => runtimeFrom(grammars);

  /** A language, or `null` when it would not load — remembered, so its files are skipped. */
  function load(spec: LanguageSpec): Promise<Loaded | null> {
    let held = loaded.get(spec.name);
    if (held === undefined) {
      held = (async () => {
        try {
          const { Language, Query } = await runtime();
          const bytes =
            spec.path === undefined
              ? await grammars.grammar(spec.grammar)
              : await readFile(spec.path);
          const language = await Language.load(bytes);
          return { language, query: new Query(language, spec.query) };
        } catch (error) {
          failed.set(spec.name, error instanceof Error ? error.message : String(error));
          return null;
        }
      })();
      loaded.set(spec.name, held);
    }
    return held;
  }

  async function indexFile(repo: string, path: string, parser: Parser): Promise<SymbolDef[]> {
    const spec = specOf(path);
    if (spec === undefined) return [];
    const read = await readListed(join(root, repo), path);
    if (read === null || read.text === null) return [];
    const language = await load(spec);
    if (language === null) return [];
    parser.setLanguage(language.language);
    const tree = parser.parse(read.text);
    if (tree === null) return [];
    try {
      const lines = read.text.split("\n");
      return language.query
        .captures(tree.rootNode)
        .filter((capture) => KINDS.has(capture.name))
        .map((capture) => {
          const line = capture.node.startPosition.row + 1;
          const kind = capture.name as SymbolKind;
          return { repo, path, line, name: capture.node.text, kind, text: lines[line - 1] ?? "" };
        });
    } finally {
      tree.delete();
    }
  }

  async function newParser(): Promise<Parser> {
    const { Parser } = await runtime();
    return new Parser();
  }

  /** Reads `paths` again into `defs`: a file that is gone, or defines nothing now, leaves it. */
  async function reread(repo: string, paths: readonly string[], defs: Map<string, SymbolDef[]>) {
    const parser = await newParser();
    try {
      for (const path of paths) {
        if (specOf(path) === undefined) continue;
        // One file that will not parse costs its own definitions, not the repository's.
        const found = await indexFile(repo, path, parser).catch(() => []);
        if (found.length > 0) defs.set(path, found);
        else defs.delete(path);
      }
    } finally {
      parser.delete();
    }
    return defs;
  }

  async function build(repo: string): Promise<Map<string, SymbolDef[]>> {
    const files = (await listTree(join(root, repo), null)).filter(
      (entry) => entry.worktree && specOf(entry.path) !== undefined,
    );
    return reread(
      repo,
      files.map((file) => file.path),
      new Map(),
    );
  }

  /** Puts `next` where the repository's definitions are; one that fails drops the repository, so
   * the next question builds it again rather than failing with it for ever. */
  function settle(repo: string, held: Held, next: Promise<Map<string, SymbolDef[]>>) {
    held.defs = next;
    next.catch(() => {
      if (repositories.get(repo) === held) repositories.delete(repo);
    });
    return next;
  }

  /** The repository's definitions as of the change set the review shows now. */
  function current(view: RepositoryView): Promise<Map<string, SymbolDef[]>> {
    const now = patchesOf(view);
    const held = repositories.get(view.path);
    if (held === undefined) {
      const made: Held = { defs: Promise.resolve(new Map()), seen: now };
      repositories.set(view.path, made);
      return settle(view.path, made, build(view.path));
    }
    // Any file whose content differs from what was read differs from the base too, so it is in
    // the change set; a patch that moved names exactly the files to read again.
    const stale = moved(held.seen, now);
    held.seen = now;
    if (stale.length === 0) return held.defs;
    return settle(
      view.path,
      held,
      held.defs.then((defs) => reread(view.path, stale, defs)),
    );
  }

  return {
    warm(repos) {
      for (const view of repos) void current(view).catch(() => {});
    },
    async query(repos, query, limit, keep = () => true) {
      const built = await Promise.all(repos.map((view) => current(view)));
      const scored: { def: SymbolDef; score: number; at: number }[] = [];
      built.forEach((defs, at) => {
        for (const list of defs.values()) {
          for (const def of list) {
            const score = matchScore(def.name, query);
            if (score > 0 && keep(def)) scored.push({ def, score, at });
          }
        }
      });
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          a.def.name.length - b.def.name.length ||
          a.at - b.at ||
          (a.def.path < b.def.path ? -1 : a.def.path > b.def.path ? 1 : 0) ||
          a.def.line - b.def.line,
      );
      return scored.slice(0, limit).map((one) => one.def);
    },
    async changed(repo, files) {
      const held = repositories.get(repo);
      if (held === undefined) return;
      const next = held.defs.then(async (defs) => {
        // Bun names the temporary file of an atomic write, and a fallback rescan names nothing.
        const present = await Promise.all(
          files.map((path) =>
            access(join(root, repo, path)).then(
              () => true,
              () => false,
            ),
          ),
        );
        if (files.length === 0 || present.includes(false)) return build(repo);
        return reread(repo, files, defs);
      });
      await settle(repo, held, next);
    },
    failures: () => [...failed].map(([language, message]) => ({ language, message })),
  };
}

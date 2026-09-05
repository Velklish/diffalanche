/**
 * The review the server hands out: the change set of the current session with
 * its comments and counters. It is built once, kept in memory, and rebuilt when
 * something says it changed — the whole document arrives in one response and
 * nothing is loaded lazily afterwards (`docs/SPEC.md` section 6).
 */
import { sameBase, scanReview } from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import { countReview, list, resolveSessionName } from "../core/domain/index.ts";
import { readRepositoryChange, scan } from "../core/index.ts";
import type { Base, DiffCache } from "../core/storage/index.ts";
import {
  readDiffCache,
  readReview,
  sessionDir,
  withLock,
  writeDiffCache,
} from "../core/storage/index.ts";
import type {
  FileChange,
  RepositoryChange,
  RepositoryKind,
  ReviewDocument,
  ScanWarning,
} from "../core/types.ts";

/** One repository as `GET /api/scan` reports it, before any session exists. */
export type ScannedRepository = {
  path: string;
  kind: RepositoryKind;
  branch: string;
  /** Whether it has anything to review against the base. */
  hasChanges: boolean;
  files: number;
};

export type ScanSummary = {
  root: string;
  repositories: ScannedRepository[];
  warnings: ScanWarning[];
};

export type ReviewService = {
  /**
   * The current session's document. Refuses with the domain's own
   * `no-current-session` or `no-such-session` when there is none.
   */
  document: () => Promise<ReviewDocument>;
  /** The same document serialised; built once per change, not once per request. */
  payload: () => Promise<string>;
  /** One repository of the change set, or `null` when it has no changes. */
  repository: (repo: string) => Promise<RepositoryChange | null>;
  /** The change set as a rescan left it on disk, taken as the document's own. */
  adopt: (cache: DiffCache) => void;
  /** Something changed underneath: the document is built again when next asked for. */
  invalidate: () => void;
  /**
   * Only the comments changed. Re-reading them costs a small file; rebuilding
   * the document would cost `diff.json`, which every comment write would then
   * charge the next reader for.
   */
  invalidateComments: () => void;
  /** Every repository under the root with whether it has changes: the first-run screen. */
  summary: () => Promise<ScanSummary>;
};

type State = { session: string; document: ReviewDocument; payload: string | null };

export function createReviewService(config: Config): ReviewService {
  let state: State | null = null;
  let pending: Promise<State> | null = null;
  /** Bumped by every invalidation, so a build that started before one is dropped. */
  let version = 0;
  let staleComments = false;

  async function current(): Promise<State> {
    const cached = state;
    if (cached !== null) {
      if (staleComments) {
        const comments = await list(config.dataDir, cached.session);
        staleComments = false;
        cached.document = { ...cached.document, comments, counters: countReview(comments) };
        cached.payload = null;
      }
      return cached;
    }
    if (pending === null) {
      const started = version;
      pending = build(config).then(
        (built) => {
          pending = null;
          if (version === started) state = built;
          return built;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  }

  return {
    document: async () => (await current()).document,
    payload: async () => {
      const held = await current();
      held.payload ??= JSON.stringify(held.document);
      return held.payload;
    },
    repository: async (repo) =>
      (await current()).document.repositories.find((one) => one.path === repo) ?? null,
    adopt: (cache) => {
      if (state === null) return;
      state.document = {
        ...state.document,
        repositories: cache.repositories.map(withoutHunks),
        totals: cache.totals,
        warnings: cache.warnings,
      };
      state.payload = null;
    },
    invalidate: () => {
      version += 1;
      state = null;
    },
    invalidateComments: () => {
      staleComments = true;
      if (state !== null) state.payload = null;
    },
    summary: async () => summarise(config),
  };
}

async function build(config: Config): Promise<State> {
  const session = await resolveSessionName(config.dataDir);
  const review = await readReview(config.dataDir, session);
  // The cache is the change set of the last scan. One computed against another
  // base answers a different question — `review base` is what puts it there —
  // so it is read again rather than trusted.
  const cached = await readDiffCache(config.dataDir, session);
  const cache =
    cached !== null && sameBase(cached.base, review.base) ? cached : await rebuild(config, session);
  const comments = await list(config.dataDir, session);
  return {
    session,
    payload: null,
    document: {
      root: config.root,
      repositories: cache.repositories.map(withoutHunks),
      totals: cache.totals,
      warnings: cache.warnings,
      session: review,
      comments,
      counters: countReview(comments),
    },
  };
}

/**
 * Reads every repository and writes `diff.json`. The hunks are read here and
 * kept only in the file: anchor capture is the one reader that needs them, and
 * the response drops them.
 */
async function rebuild(config: Config, session: string): Promise<DiffCache> {
  const review = await readReview(config.dataDir, session);
  const { cache } = await scanReview(config, review.base);
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
  });
  return cache;
}

/**
 * Every repository under the root, with whether it has anything to review. This
 * is the one answer that reads git per request: it is what the screen before
 * the first session shows, and there is no cache to answer it from.
 */
async function summarise(config: Config): Promise<ScanSummary> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  const base = await sessionBase(config);
  const repositories = await Promise.all(
    found.repositories.map(async (repository) => {
      const change = await readRepositoryChange(config.root, repository.path, base, {
        hunks: false,
      });
      return {
        path: repository.path,
        kind: repository.kind,
        branch: change.branch,
        hasChanges: change.files.length > 0,
        files: change.files.length,
      };
    }),
  );
  return { root: config.root, repositories, warnings: found.warnings };
}

/** Without a session there is no base to read against; the default one is HEAD. */
async function sessionBase(config: Config): Promise<Base> {
  try {
    const session = await resolveSessionName(config.dataDir);
    return (await readReview(config.dataDir, session)).base;
  } catch {
    return { mode: "head" };
  }
}

/** The same repository with the structured lines dropped; the patch is what the UI renders. */
function withoutHunks(repository: RepositoryChange): RepositoryChange {
  if (repository.files.every((file) => file.hunks.length === 0)) return repository;
  const files: FileChange[] = repository.files.map((file) =>
    file.hunks.length === 0 ? file : { ...file, hunks: [] },
  );
  return { ...repository, files };
}

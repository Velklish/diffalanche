/**
 * The review the server hands out: the change set of the current session with
 * its comments and counters. It is built once, kept in memory, and rebuilt when
 * something says it changed — the whole document arrives in one response and
 * nothing is loaded lazily afterwards (`docs/SPEC.md` section 6).
 */
import { filterChange, sameBase, sameScope, scanReview } from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import { countReview, list, repositoryInScope, resolveSessionName } from "../core/domain/index.ts";
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
  FileStatus,
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

/** One file a scope may be built from: what it is, not what it says. */
export type CandidateFile = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
};

/** One repository of the whole root, with the files that changed in it. */
export type CandidateRepository = {
  path: string;
  branch: string;
  files: CandidateFile[];
};

/**
 * What `GET /api/sessions/candidates` answers with: the change set of the whole
 * root, whatever the scope of the session is, so the scope editor has something
 * to pick from. It carries no patch and no hunks — a picker needs the names,
 * and the diff of a whole root is megabytes
 * ([07-server.md](../../docs/reference/07-server.md)).
 */
export type CandidateSet = {
  root: string;
  repositories: CandidateRepository[];
  warnings: ScanWarning[];
};

export type ReviewService = {
  /**
   * The document of a named session, or of the current one. Refuses with the
   * domain's own `no-current-session` or `no-such-session` when there is none.
   */
  document: (session?: string) => Promise<ReviewDocument>;
  /**
   * The same document serialised. The current session's is built once per
   * change and kept; a named one is built for the request that asked, because
   * a window opening another task must not evict the review everyone else is
   * reading.
   */
  payload: (session?: string) => Promise<string>;
  /**
   * One repository of the change set, or `null` when it has no changes. The
   * change set is a named session's when one is named, because a window on
   * `?review=` patches its own task and not the current one's
   * ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)); a named one is
   * read from the working tree rather than from that task's cache, which the
   * watcher does not keep fresh — see `freshRepository` below.
   */
  repository: (repo: string, session?: string) => Promise<RepositoryChange | null>;
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
  /** The change set of the whole root, scope ignored: what a scope is picked from. */
  candidates: () => Promise<CandidateSet>;
};

type State = { session: string; document: ReviewDocument; payload: string | null };

export function createReviewService(config: Config): ReviewService {
  let state: State | null = null;
  let pending: Promise<State> | null = null;
  /** Bumped by every invalidation, so a build that started before one is dropped. */
  let version = 0;
  /** Bumped by every write of the comments, so a read cannot clear a newer one. */
  let commentsWritten = 0;
  let staleComments = 0;

  async function current(): Promise<State> {
    const cached = state;
    if (cached !== null) {
      if (staleComments !== commentsWritten) {
        const reading = commentsWritten;
        const comments = await list(config.dataDir, cached.session);
        // A write that landed while the file was being read is not covered by
        // what was read, so the flag it set stays set.
        staleComments = reading;
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

  /**
   * The document of a session that is not the current one. It is built for the
   * request and not kept: the one document in memory is the review the page is
   * on, and a window that opens another task — from a link an agent printed —
   * must not take that away from it.
   */
  async function other(session: string): Promise<State> {
    const cached = state;
    if (cached !== null && cached.session === session) return current();
    return build(config, session);
  }

  return {
    document: async (session) =>
      (session === undefined ? await current() : await other(session)).document,
    payload: async (session) => {
      if (session !== undefined) {
        const held = await other(session);
        held.payload ??= JSON.stringify(held.document);
        return held.payload;
      }
      const held = await current();
      held.payload ??= JSON.stringify(held.document);
      return held.payload;
    },
    repository: async (repo, session) =>
      session === undefined
        ? ((await current()).document.repositories.find((one) => one.path === repo) ?? null)
        : freshRepository(config, session, repo),
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
      commentsWritten += 1;
      if (state !== null) state.payload = null;
    },
    summary: async () => summarise(config),
    candidates: async () => candidatesOf(config),
  };
}

async function build(config: Config, named?: string): Promise<State> {
  const session = await resolveSessionName(config.dataDir, named);
  const review = await readReview(config.dataDir, session);
  // The cache is the change set of the last scan. One computed against another
  // base — or for another scope — answers a different question, and `review
  // base` and a scope edit are what put it there, so it is read again rather
  // than trusted.
  const cached = await readDiffCache(config.dataDir, session);
  const cache =
    cached !== null && sameBase(cached.base, review.base) && sameScope(cached.scope, review.scope)
      ? cached
      : await rebuild(config, session);
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
  const { cache } = await scanReview(config, review.base, review.scope);
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
  });
  return cache;
}

/**
 * One repository of a **named** task, read from the working tree as it now
 * stands rather than from that task's `diff.json`.
 *
 * The cache would be wrong here. The watcher rescans and rewrites the cache of
 * the **current** session only ([05-watcher.md](../../docs/reference/05-watcher.md)),
 * so a task that is not current holds a change set frozen at the moment it was
 * last read — and this is the answer a live update patches the page with.
 * Measured on the synthetic review: served from the cache, the card of the
 * edited file never showed the edit, three times out of three, while the same
 * event on the current session showed it every time.
 *
 * It costs the four git processes of one repository — what the watcher pays for
 * the current session anyway — and not the whole scope's. The hunks are dropped
 * as everywhere else: the renderer reads the patch, and the structured lines
 * live in `diff.json` for anchor capture.
 */
async function freshRepository(
  config: Config,
  session: string,
  repo: string,
): Promise<RepositoryChange | null> {
  const review = await readReview(config.dataDir, session);
  // A repository the task is not about has nothing to say to it, and reading it
  // would be four git processes for a change set nothing may show.
  if (!repositoryInScope(review.scope, repo)) return null;
  const change = filterChange(
    review.scope,
    await readRepositoryChange(config.root, repo, review.base, { hunks: false }),
  );
  // A repository with nothing to show is not part of a change set: the route
  // turns that into the 404 the page reads as "it has left the review".
  return change.files.length === 0 ? null : change;
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

/**
 * The change set of the whole root, the scope of the session left out of it.
 * This is what the scope editor picks from, so it reads git per request the way
 * the scan does and carries names rather than diffs: the patch of a whole root
 * is megabytes, and a picker shows paths.
 */
async function candidatesOf(config: Config): Promise<CandidateSet> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  const base = await sessionBase(config);
  const read = await Promise.all(
    found.repositories.map((repository) =>
      readRepositoryChange(config.root, repository.path, base, { hunks: false }),
    ),
  );
  return {
    root: config.root,
    // A repository with nothing to show is not part of a change set, here as
    // everywhere else (`docs/SPEC.md` section 5).
    repositories: read
      .filter((change) => change.files.length > 0)
      .map((change) => ({
        path: change.path,
        branch: change.branch,
        files: change.files.map((file) => ({
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
      })),
    warnings: [
      ...found.warnings,
      ...read.flatMap((change) =>
        change.warnings.map((message) => ({ path: change.path, message })),
      ),
    ],
  };
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

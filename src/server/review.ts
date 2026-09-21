/** The review the server hands out, one built document per session
 * ([07-server.md](../../docs/reference/07-server.md), `docs/SPEC.md` section 6). */
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  filterChange,
  mapWithLimit,
  SCAN_CONCURRENCY,
  sameBase,
  sameScope,
  scanReview,
} from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import { countReview, list, repositoryInScope, resolveSessionName } from "../core/domain/index.ts";
import { readRepositoryChange, scan } from "../core/index.ts";
import type { Base, DiffCache, Review } from "../core/storage/index.ts";
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
  /** The same document serialised: one per session, serialised once per change
   * ([07-server.md](../../docs/reference/07-server.md)). */
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
  /** The change set a rescan of that session left. It is recorded either way, and
   * the answer says whether a document was held for it to patch. */
  adopt: (session: string, cache: DiffCache) => boolean;
  /** Something changed underneath that session: its document is built again when next asked for. */
  invalidate: (session: string) => void;
  /** A repository under the root changed: every held document that could show it,
   * bar the followed session's, is dropped ([07-server.md](../../docs/reference/07-server.md)). */
  repositoryChanged: (repo: string) => void;
  /** Only the comments of that session changed: a small file, where rebuilding the
   * document would charge the next reader for the whole change set. */
  invalidateComments: (session: string) => void;
  /** Every repository under the root with whether it has changes: the first-run screen. */
  summary: () => Promise<ScanSummary>;
  /** The change set of the whole root, scope ignored: what a scope is picked from. */
  candidates: () => Promise<CandidateSet>;
};

/** What the server holds for one session: its document, and what is known to be newer. */
type Held = {
  document: ReviewDocument | null;
  payload: string | null;
  pending: Promise<ReviewDocument> | null;
  /** Bumped by every invalidation of this session, so a build that started before one is dropped. */
  version: number;
  /** The change set the last rescan handed over; it reaches memory before it reaches the file. */
  adopted: DiffCache | null;
  /** Repositories that changed while this session's document was being built, judged
   * against its scope when the build resolves and it has one. */
  signalled: string[];
  /** The write this session's comments were last known to be behind. */
  commentsWritten: number;
  /** The write the held comments are known to cover, taken when the read was asked for. */
  staleComments: number;
};

/** How many sessions keep a built document at once; each one is megabytes
 * ([07-server.md](../../docs/reference/07-server.md)). */
export const DOCUMENT_CACHE_LIMIT = 4;

export type ReviewServiceOptions = {
  /** The session the watcher keeps fresh. Any other one's `diff.json` is read
   * from git instead ([07-server.md](../../docs/reference/07-server.md)). */
  watched?: () => string | null;
};

export function createReviewService(
  config: Config,
  options: ReviewServiceOptions = {},
): ReviewService {
  const watched = options.watched ?? (() => null);
  const sessions = new Map<string, Held>();
  // One sequence over every session, so a read can be pinned to the moment it
  // was asked for and cannot clear a write that landed after that.
  let writes = 0;

  /** The entry of a session, made when it is new; asking for one makes it the newest. */
  function entryOf(session: string): Held {
    const found = sessions.get(session);
    if (found !== undefined) {
      sessions.delete(session);
      sessions.set(session, found);
      return found;
    }
    const made: Held = {
      document: null,
      payload: null,
      pending: null,
      version: 0,
      adopted: null,
      signalled: [],
      commentsWritten: writes,
      staleComments: writes,
    };
    sessions.set(session, made);
    trim(sessions);
    return made;
  }

  async function documentOf(session: string, asked: number): Promise<ReviewDocument> {
    const entry = entryOf(session);
    const cached = entry.document;
    if (cached !== null) {
      if (entry.commentsWritten <= entry.staleComments) return cached;
      const started = entry.version;
      const comments = await list(config.dataDir, session);
      const reread = { ...cached, comments, counters: countReview(comments) };
      // An invalidation that landed during the read threw this document away,
      // and a re-read of its comments must not put it back.
      if (entry.version !== started) return reread;
      // The read covers the writes up to the moment it was asked for; one that
      // landed after that is not covered, so the flag it set stays set.
      if (asked > entry.staleComments) entry.staleComments = asked;
      entry.document = reread;
      entry.payload = null;
      return reread;
    }
    if (entry.pending === null) {
      const started = entry.version;
      const startedWrites = writes;
      const followed = watched() === session;
      // What the watcher handed over is about the session it was following;
      // once it has moved on, that cache is as frozen as the file.
      if (!followed) entry.adopted = null;
      entry.signalled = [];
      entry.pending = build(config, session, entry, followed).then(
        (built) => {
          entry.pending = null;
          // A rescan may have landed while this was building: what it handed
          // over is newer than the file this read, so it settles the change set.
          const settled = followed ? withAdopted(built, entry) : built;
          // What changed while this was building is judged now, against the
          // scope the built document carries: a repository this task is not
          // about must not cost it its place.
          const touched = entry.signalled;
          entry.signalled = [];
          const stale = touched.some((repo) => repositoryInScope(settled.session.scope, repo));
          if (entry.version === started && !stale) {
            entry.document = settled;
            entry.payload = null;
            entry.staleComments = startedWrites;
          }
          return settled;
        },
        (error: unknown) => {
          entry.pending = null;
          throw error;
        },
      );
    }
    return entry.pending;
  }

  return {
    document: async (session) => {
      // Taken before the name is read from disk: a write that lands while it is
      // being read must not pass for one this read covers.
      const asked = writes;
      return documentOf(await resolveSessionName(config.dataDir, session), asked);
    },
    payload: async (session) => {
      const asked = writes;
      const name = await resolveSessionName(config.dataDir, session);
      const document = await documentOf(name, asked);
      const entry = sessions.get(name);
      // A document an invalidation kept out of the cache is serialised for the
      // request that asked and not kept.
      if (entry === undefined || entry.document !== document) return JSON.stringify(document);
      entry.payload ??= JSON.stringify(document);
      return entry.payload;
    },
    repository: async (repo, session) => {
      if (session !== undefined) return freshRepository(config, session, repo);
      const asked = writes;
      const document = await documentOf(await resolveSessionName(config.dataDir), asked);
      return document.repositories.find((one) => one.path === repo) ?? null;
    },
    adopt: (session, cache) => {
      const entry = entryOf(session);
      // The hunks go no further than `diff.json`, here as in the document: the
      // renderer reads `patch` and anchor capture reads the file.
      const taken: DiffCache = { ...cache, repositories: cache.repositories.map(withoutHunks) };
      entry.adopted = taken;
      const document = entry.document;
      if (document === null) return false;
      entry.document = {
        ...document,
        repositories: taken.repositories,
        totals: taken.totals,
        warnings: taken.warnings,
      };
      entry.payload = null;
      return true;
    },
    invalidate: (session) => {
      const entry = sessions.get(session);
      if (entry === undefined) return;
      entry.version += 1;
      entry.document = null;
      entry.payload = null;
      // `adopted` stands: a write to the data directory is not a change of the
      // working tree, and the rescan's change set is still the newest there is.
    },
    repositoryChanged: (repo) => {
      const followed = watched();
      for (const [name, entry] of sessions) {
        // The followed session's document is patched by the rescan itself.
        if (name === followed) continue;
        const document = entry.document;
        if (document === null) {
          // A build in flight has no scope to judge by yet, so the name is kept
          // and the question asked again when it resolves.
          if (entry.pending !== null) entry.signalled.push(repo);
          continue;
        }
        if (!repositoryInScope(document.session.scope, repo)) continue;
        entry.version += 1;
        entry.document = null;
        entry.payload = null;
        entry.adopted = null;
      }
    },
    invalidateComments: (session) => {
      writes += 1;
      const entry = sessions.get(session);
      if (entry === undefined) return;
      entry.commentsWritten = writes;
      entry.payload = null;
    },
    summary: async () => summarise(config),
    candidates: async () => candidatesOf(config),
  };
}

/** Drops the least recently asked-for sessions until the map is inside the limit;
 * one with a build in flight stays, so nothing loses the version it started on. */
function trim(sessions: Map<string, Held>): void {
  for (const [name, entry] of sessions) {
    if (sessions.size <= DOCUMENT_CACHE_LIMIT) break;
    if (entry.pending === null) sessions.delete(name);
  }
}

/** Whether a cache answers the question this session asks — which is not whether it is fresh. */
function answers(cache: DiffCache, review: Review): boolean {
  return sameBase(cache.base, review.base) && sameScope(cache.scope, review.scope);
}

/** The document with the change set of the last rescan, when that rescan still
 * answers what this session asks. */
function withAdopted(document: ReviewDocument, entry: Held): ReviewDocument {
  const cache = entry.adopted;
  if (cache === null || !answers(cache, document.session)) return document;
  return {
    ...document,
    repositories: cache.repositories,
    totals: cache.totals,
    warnings: cache.warnings,
  };
}

async function build(
  config: Config,
  session: string,
  entry: Held,
  followed: boolean,
): Promise<ReviewDocument> {
  const review = await readReview(config.dataDir, session);
  const cache = await changeSet(config, session, entry, review, followed);
  const comments = await list(config.dataDir, session);
  return {
    root: config.root,
    repositories: cache.repositories.map(withoutHunks),
    totals: cache.totals,
    warnings: cache.warnings,
    session: review,
    comments,
    counters: countReview(comments),
  };
}

/** The change set of a session: **a cache that matches on base and scope is not thereby
 * fresh**, and only the followed session has one ([07-server.md](../../docs/reference/07-server.md)). */
async function changeSet(
  config: Config,
  session: string,
  entry: Held,
  review: Review,
  followed: boolean,
): Promise<DiffCache> {
  // Memory and file alike: only the followed session has a change set anything
  // refreshes, because the watcher rescans one session.
  if (followed) {
    const adopted = entry.adopted;
    if (adopted !== null && answers(adopted, review)) return adopted;
    const cached = await readDiffCache(config.dataDir, session);
    if (cached !== null && answers(cached, review)) return cached;
  }
  return rebuild(config, session, review);
}

/** Reads every repository of the scope and writes `diff.json`; the hunks stay in the
 * file, where anchor capture is the one reader that needs them. */
async function rebuild(config: Config, session: string, review: Review): Promise<DiffCache> {
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
  // The path comes from the URL and goes to a `join` against the root, so
  // containment is checked here, before any git process starts.
  if (!underRoot(config.root, repo)) return null;
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

/** Whether a repository path names something inside the root: a path check,
 * no walk of the filesystem ([07-server.md](../../docs/reference/07-server.md)). */
function underRoot(root: string, repo: string): boolean {
  // `..foo` is a directory name and not a step up, so the separator is part of
  // what is compared.
  const step = relative(resolve(root), resolve(root, repo));
  return step !== "" && step !== ".." && !step.startsWith(`..${sep}`) && !isAbsolute(step);
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
  const repositories = await mapWithLimit(
    found.repositories,
    SCAN_CONCURRENCY,
    async (repository) => {
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
    },
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
  const read = await mapWithLimit(found.repositories, SCAN_CONCURRENCY, (repository) =>
    readRepositoryChange(config.root, repository.path, base, { hunks: false }),
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

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readRepositoryChange, scan } from "../core/index.ts";
import type { ReviewBundle, ScanConfig, ScanWarning } from "../core/types.ts";

const DEFAULT_CONFIG: ScanConfig = { roots: ["."], depth: 2, exclude: [] };

/**
 * The current session as it lies on disk. The two files pass through unparsed:
 * their shapes are `docs/SPEC.md` section 7, and the domain of DA-10 will own
 * them. Reading them here is a stopgap that DA-16 replaces with the real
 * server, together with the routes for comments, sessions, and the SSE stream.
 */
export type SessionFiles = {
  /** `review.json` of the current session, or `null` when there is none. */
  session: unknown;
  /** The `comments` array of `comments.json`. */
  comments: unknown[];
};

const NO_SESSION: SessionFiles = { session: null, comments: [] };

/** Scans the root once and returns the whole change set: the UI loads nothing lazily. */
export async function buildReviewBundle(root: string): Promise<ReviewBundle & SessionFiles> {
  const absoluteRoot = resolve(root);
  const config = await readConfig(absoluteRoot);
  const found = await scan(absoluteRoot, config);
  const scanned = await Promise.all(
    // The renderer reads `patch`; carrying the structured hunks as well costs
    // more CPU per scrolled frame than the budget of `docs/SPEC.md` section 6 has.
    found.repositories.map((repo) =>
      readRepositoryChange(absoluteRoot, repo.path, { mode: "head" }, { hunks: false }),
    ),
  );
  const repositories = scanned.filter((repo) => repo.files.length > 0);
  const warnings: ScanWarning[] = [
    ...found.warnings,
    ...scanned.flatMap((repo) => repo.warnings.map((message) => ({ path: repo.path, message }))),
  ];
  const files = repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  const lines = repositories.reduce(
    (sum, repo) =>
      sum + repo.files.reduce((inner, file) => inner + file.additions + file.deletions, 0),
    0,
  );
  return {
    root: absoluteRoot,
    repositories,
    totals: { repositories: repositories.length, files, lines },
    warnings,
    ...(await readSession(join(absoluteRoot, ".diffalanche"))),
  };
}

/** The session named by the `current` pointer, or the only one on disk. */
async function readSession(dataDir: string): Promise<SessionFiles> {
  const name = await currentSession(dataDir);
  if (name === null) return NO_SESSION;
  const dir = join(dataDir, "reviews", name);
  const session = await readJson(join(dir, "review.json"));
  const comments = await readJson(join(dir, "comments.json"));
  const list = (comments as { comments?: unknown })?.comments;
  return { session: session ?? null, comments: Array.isArray(list) ? list : [] };
}

async function currentSession(dataDir: string): Promise<string | null> {
  const pointer = (await readFile(join(dataDir, "current"), "utf8").catch(() => null))?.trim();
  if (pointer) return isSessionName(pointer) ? pointer : null;
  const entries = await readdir(join(dataDir, "reviews"), { withFileTypes: true }).catch(() => []);
  const directories = entries.filter((entry) => entry.isDirectory());
  const only = directories.length === 1 ? directories[0] : undefined;
  return only?.name ?? null;
}

/** A session name, never a path: the pointer must not lead out of the data directory. */
function isSessionName(name: string): boolean {
  return name !== "." && name !== ".." && !/[/\\]/.test(name);
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readConfig(root: string): Promise<ScanConfig> {
  try {
    const raw = await readFile(join(root, ".diffalanche", "config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ScanConfig>;
    return {
      roots: parsed.roots ?? DEFAULT_CONFIG.roots,
      depth: parsed.depth ?? DEFAULT_CONFIG.depth,
      exclude: parsed.exclude ?? DEFAULT_CONFIG.exclude,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

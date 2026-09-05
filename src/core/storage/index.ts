/**
 * The data directory: where a review session lives and how it is read and
 * written. `docs/SPEC.md` section 7 defines the layout, `docs/reference/03-storage.md`
 * describes what this module does with it.
 */
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { StorageError } from "./errors.ts";
import { withLock } from "./lock.ts";
import { parseComments, parseDiffCache, parseReview, toJson } from "./schema.ts";
import type { Comment, DiffCache, Review, SessionListing } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export { StorageError } from "./errors.ts";
export type { LockOptions } from "./lock.ts";
export { withLock } from "./lock.ts";
export { parseBase, toJson } from "./schema.ts";
export type {
  Anchor,
  Base,
  BaseMode,
  Comment,
  CommentStatus,
  CommentsFile,
  DiffCache,
  Reply,
  Review,
  Role,
  SessionListing,
  Severity,
  Side,
} from "./types.ts";
export { SCHEMA_VERSION } from "./types.ts";

/** The name of the data directory inside the root; `--data-dir` replaces the whole path. */
export const DATA_DIR_NAME = ".diffalanche";

/** The data directory of a root, the default before `--data-dir` is applied. */
export function dataDirOf(root: string): string {
  return resolve(root, DATA_DIR_NAME);
}

export function reviewsDir(dataDir: string): string {
  return resolve(dataDir, "reviews");
}

/**
 * A session name is a directory name and nothing more. Without this guard
 * `resolve` would happily leave the data directory: `../../repos/group/svc`
 * would put review files inside a reviewed repository, which the tool must
 * never write to. The domain checks names too, but the check belongs here as
 * well — this is the module that touches the file system, and `current` is a
 * hand-edited file whose content reaches these functions directly.
 */
function assertSessionSegment(dataDir: string, name: string): string {
  if (name === "" || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new StorageError(
      reviewsDir(dataDir),
      null,
      `"${name}" is not a review session name: it has to be a single path segment`,
    );
  }
  return name;
}

export function sessionDir(dataDir: string, name: string): string {
  return resolve(reviewsDir(dataDir), assertSessionSegment(dataDir, name));
}

export function currentPath(dataDir: string): string {
  return resolve(dataDir, "current");
}

export function reviewPath(dataDir: string, name: string): string {
  return resolve(sessionDir(dataDir, name), "review.json");
}

export function commentsPath(dataDir: string, name: string): string {
  return resolve(sessionDir(dataDir, name), "comments.json");
}

export function diffCachePath(dataDir: string, name: string): string {
  return resolve(sessionDir(dataDir, name), "diff.json");
}

/** Creates the data directory and its `reviews/` if they are not there yet. */
export async function ensureDataDir(dataDir: string): Promise<string> {
  await mkdir(reviewsDir(dataDir), { recursive: true });
  return dataDir;
}

export async function ensureSessionDir(dataDir: string, name: string): Promise<string> {
  const dir = sessionDir(dataDir, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Timestamps are written to the millisecond: two writes in one second differ. */
export function timestamp(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// files of a session
// ---------------------------------------------------------------------------

export async function readReview(dataDir: string, name: string): Promise<Review> {
  const path = reviewPath(dataDir, name);
  const text = await readText(path);
  if (text === null) throw new StorageError(path, null, "no such review session");
  return parseReview(path, text);
}

export async function writeReview(dataDir: string, name: string, review: Review): Promise<void> {
  await ensureSessionDir(dataDir, name);
  await writeFileAtomic(reviewPath(dataDir, name), toJson(review));
}

/** A session with no `comments.json` yet has no comments; both are the same thing. */
export async function readComments(dataDir: string, name: string): Promise<Comment[]> {
  const path = commentsPath(dataDir, name);
  const text = await readText(path);
  if (text === null) return [];
  return parseComments(path, text).comments;
}

export async function writeComments(
  dataDir: string,
  name: string,
  comments: Comment[],
): Promise<void> {
  await ensureSessionDir(dataDir, name);
  await writeFileAtomic(commentsPath(dataDir, name), toJson({ version: SCHEMA_VERSION, comments }));
}

/** The change set of the last scan, or `null` when nothing has been scanned yet. */
export async function readDiffCache(dataDir: string, name: string): Promise<DiffCache | null> {
  const path = diffCachePath(dataDir, name);
  const text = await readText(path);
  if (text === null) return null;
  return parseDiffCache(path, text);
}

export async function writeDiffCache(
  dataDir: string,
  name: string,
  diff: DiffCache,
): Promise<void> {
  await ensureSessionDir(dataDir, name);
  await writeFileAtomic(diffCachePath(dataDir, name), toJson(diff));
}

// ---------------------------------------------------------------------------
// the current session
// ---------------------------------------------------------------------------

/**
 * `current` is one line: the name of the current session and a newline. It is
 * a pointer and nothing else, so `cat current` answers the question and an
 * editor does not add a second line to it.
 */
export async function readCurrent(dataDir: string): Promise<string | null> {
  const text = await readText(currentPath(dataDir));
  if (text === null) return null;
  const name = text.trim();
  return name === "" ? null : name;
}

export async function writeCurrent(dataDir: string, name: string): Promise<void> {
  assertSessionSegment(dataDir, name);
  await ensureDataDir(dataDir);
  await writeFileAtomic(currentPath(dataDir), `${name}\n`);
}

// ---------------------------------------------------------------------------
// writing comments
// ---------------------------------------------------------------------------

/**
 * The read-modify-write every comment writer goes through: under the session's
 * lock, read `comments.json`, let `update` change the list in place, write it
 * back, and bump the session's `updatedAt`. Reading outside the lock and
 * writing inside it would lose the replies written in between.
 */
export async function updateComments<T>(
  dataDir: string,
  name: string,
  update: (comments: Comment[]) => T | Promise<T>,
): Promise<T> {
  const path = reviewPath(dataDir, name);
  // Before the lock, so a mistyped name does not leave an empty session
  // directory behind that every later listing warns about.
  if (!(await exists(path))) {
    throw new StorageError(path, null, "no such review session");
  }
  return withLock(sessionDir(dataDir, name), async (lock) => {
    const review = await readReview(dataDir, name);
    const comments = await readComments(dataDir, name);
    const result = await update(comments);
    // `update` is the caller's code and may take longer than the lock lease.
    await lock.assertHeld();
    await writeComments(dataDir, name, comments);
    await writeReview(dataDir, name, { ...review, updatedAt: timestamp() });
    return result;
  });
}

// ---------------------------------------------------------------------------
// listing sessions
// ---------------------------------------------------------------------------

/**
 * The session names under `reviews/`, sorted. A directory without a
 * `review.json` is not a session: it is left out and reported, because
 * silently skipping it looks like the session was lost.
 */
export async function listSessionNames(dataDir: string): Promise<SessionListing> {
  const dir = reviewsDir(dataDir);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { names: [], warnings: [] };
    throw error;
  }

  const names: string[] = [];
  const warnings: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    if (!(await exists(reviewPath(dataDir, entry.name)))) {
      warnings.push(
        `${sessionDir(dataDir, entry.name)}: no review.json, not a review session; ignored`,
      );
      continue;
    }
    names.push(entry.name);
  }
  return { names, warnings };
}

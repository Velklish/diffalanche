/**
 * Review sessions: creating one, switching to it, listing the history, and
 * changing its base. `docs/SPEC.md` sections 4, 5, and 8; the on-disk side is
 * `src/core/storage`.
 */
import type { Base, Review } from "../storage/index.ts";
import {
  listSessionNames,
  readComments,
  readCurrent,
  readDiffCache,
  readReview,
  reviewPath,
  StorageError,
  sessionExists,
  timestamp,
  updateSession,
  writeCurrent,
} from "../storage/index.ts";
import { DomainError } from "./errors.ts";
import type { SessionList, SessionSummary } from "./types.ts";

/**
 * A session name is a directory name, so it stays inside what every filesystem
 * of the three delivery targets spells the same way: lowercase letters, digits,
 * dot, dash, underscore.
 */
const NAME = /^[a-z0-9._-]+$/;

/** Names that are a path rather than a name, whatever the character set allows. */
const RESERVED = new Set([".", ".."]);

/** Checks a session name and says what is wrong with it when it is not one. */
export function assertSessionName(name: string): void {
  if (name === "") {
    throw new DomainError("invalid-name", "a review session name cannot be empty");
  }
  if (RESERVED.has(name)) {
    throw new DomainError("invalid-name", `"${name}" is a path, not a review session name`);
  }
  if (!NAME.test(name)) {
    throw new DomainError(
      "invalid-name",
      `"${name}" is not a review session name: use lowercase letters, digits, dot, dash, ` +
        "and underscore",
    );
  }
}

/**
 * The base argument of `review new` and `review base`, shared by the CLI and
 * the API: `head`, `branch`, `branch:<name>`, and anything else is a ref
 * (`docs/SPEC.md` section 8).
 */
export function parseBaseArgument(value: string): Base {
  if (value === "") {
    throw new DomainError(
      "invalid-base",
      "a base cannot be empty: head, branch, branch:<name>, or a ref",
    );
  }
  if (value === "head") return { mode: "head" };
  if (value === "branch") return { mode: "branch" };
  if (value.startsWith("branch:")) {
    const branch = value.slice("branch:".length);
    if (branch === "") {
      throw new DomainError(
        "invalid-base",
        "branch: names no branch; write branch:<name> or branch",
      );
    }
    return { mode: "branch", branch };
  }
  return { mode: "ref", ref: value };
}

/** The base written back as the argument that produces it; the inverse of the parser. */
export function formatBase(base: Base): string {
  if (base.mode === "head") return "head";
  if (base.mode === "ref") return base.ref;
  return base.branch === undefined ? "branch" : `branch:${base.branch}`;
}

/**
 * Creates a session and makes it current. The session directory carries both
 * files from the start: an empty `comments.json` is the session's comments, and
 * a reader that has to tell "no file yet" from "no comments" tells them apart
 * for no reason.
 */
export async function createSession(
  dataDir: string,
  name: string,
  base: Base,
  title?: string,
): Promise<Review> {
  assertSessionName(name);
  // `sessionExists` answers from the file being there, not from it parsing: a
  // session whose `review.json` was broken by hand still exists, and
  // overwriting it would take its comments with it. This check is for the
  // message; the one that decides is inside the lock, in `updateSession`.
  if (await sessionExists(dataDir, name)) {
    throw new DomainError("session-exists", `review session "${name}" already exists`);
  }

  const now = timestamp();
  let review: Review;
  try {
    review = await updateSession(dataDir, name, (draft) => draft.review, {
      create: {
        version: 1,
        name,
        title: title ?? null,
        base,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    // With `create` given, the only refusal `updateSession` raises about
    // `review.json` is the one the check above could not see: another writer
    // created the session between that check and the lock. The caller gets one
    // code for both, because it is one answer.
    if (error instanceof StorageError && error.file === reviewPath(dataDir, name)) {
      throw new DomainError("session-exists", `review session "${name}" already exists`);
    }
    throw error;
  }

  await writeCurrent(dataDir, name);
  return review;
}

/** Makes an existing session current. */
export async function useSession(dataDir: string, name: string): Promise<Review> {
  assertSessionName(name);
  const review = await readSession(dataDir, name);
  await writeCurrent(dataDir, name);
  return review;
}

/** Changes the base of a session and bumps its `updatedAt`. */
export async function setBase(dataDir: string, name: string, base: Base): Promise<Review> {
  assertSessionName(name);
  await readSession(dataDir, name);
  return updateSession(dataDir, name, (draft) => {
    draft.review = { ...draft.review, base };
    return draft.review;
  });
}

/**
 * The history: every session with its counters, most recently updated first.
 * A session whose comments cannot be counted is not hidden — the counters come
 * from files that may be edited by hand, and a broken one is reported by the
 * read that hits it.
 */
export async function listSessions(dataDir: string): Promise<SessionList> {
  const { names, warnings } = await listSessionNames(dataDir);
  const current = await readCurrent(dataDir);

  const sessions: SessionSummary[] = [];
  for (const name of names) {
    const review = await readReview(dataDir, name);
    const comments = await readComments(dataDir, name);
    const diff = await readDiffCache(dataDir, name);
    sessions.push({
      name,
      title: review.title,
      base: review.base,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      current: name === current,
      open: comments.filter((comment) => comment.status === "open").length,
      resolved: comments.filter((comment) => comment.status === "resolved").length,
      repositories: diff === null ? null : diff.repositories.length,
    });
  }

  sessions.sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt < b.updatedAt ? 1 : -1));
  return { sessions, warnings };
}

/**
 * Reads a session, turning "no such file" into the domain's own refusal. A file
 * that is there but unreadable is a different thing: the `StorageError` naming
 * the file and the field comes through untouched, because "no review session
 * ls-240372" would send the reader looking for a session that is right there.
 */
export async function readSession(dataDir: string, name: string): Promise<Review> {
  if (!(await sessionExists(dataDir, name))) {
    throw new DomainError("no-such-session", `no review session "${name}"`);
  }
  return readReview(dataDir, name);
}

/**
 * The session a command works on: the one it was given, else the current one.
 * Every command of `docs/SPEC.md` section 8 takes `--review` and falls back to
 * `current`, so the fallback lives here rather than in each of them.
 */
export async function resolveSessionName(dataDir: string, name?: string): Promise<string> {
  if (name !== undefined) {
    await readSession(dataDir, name);
    return name;
  }
  const current = await readCurrent(dataDir);
  if (current === null) {
    throw new DomainError(
      "no-current-session",
      "no current review session: create one with `review new` or name one with --review",
    );
  }
  await readSession(dataDir, current);
  return current;
}

/** Review sessions: creating, switching, deleting, listing, and changing the base
 * ([04-domain.md](../../../docs/reference/04-domain.md), "Review sessions"). */
import type { Base, Review, Role, Scope } from "../storage/index.ts";
import {
  clearCurrent,
  listSessionNames,
  NoSuchSessionError,
  readComments,
  readCurrent,
  readDiffCache,
  readReview,
  removeSession,
  reviewPath,
  SCHEMA_VERSION,
  StorageError,
  sessionExists,
  timestamp,
  updateSession,
  writeCurrent,
} from "../storage/index.ts";
import { DomainError } from "./errors.ts";
import { assertHuman } from "./roles.ts";
import type { SessionList, SessionSummary } from "./types.ts";

/** A directory name every filesystem of the three delivery targets spells the same way
 * ([04-domain.md](../../../docs/reference/04-domain.md), "Session names"). */
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

/** The base argument of `review new` and `review base`, one reading for the CLI and the API
 * ([04-domain.md](../../../docs/reference/04-domain.md), "The base argument"). */
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

type CreateSessionOptions = {
  /** What the task is about; `null`, the default, is the whole root. */
  scope?: Scope;
  /** `false` leaves `current` where it is: an agent prints the new task's link and the human opens
   * it when ready ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). */
  use?: boolean;
};

/** Writes both files from the start; the scope is checked by the caller, against the scan this
 * module does not read ([04-domain.md](../../../docs/reference/04-domain.md), "Review sessions"). */
export async function createSession(
  dataDir: string,
  name: string,
  base: Base,
  title?: string,
  options: CreateSessionOptions = {},
): Promise<Review> {
  assertSessionName(name);
  // For the message; the check that decides is inside the lock. A broken `review.json` still
  // exists, and overwriting it would take its comments (03-storage.md, "Reading and writing").
  if (await sessionExists(dataDir, name)) {
    throw new DomainError("session-exists", `review session "${name}" already exists`);
  }

  const now = timestamp();
  let review: Review;
  try {
    review = await updateSession(dataDir, name, (draft) => draft.review, {
      create: {
        version: SCHEMA_VERSION,
        name,
        title: title ?? null,
        base,
        scope: options.scope ?? null,
        status: "open",
        closedAt: null,
        closedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    // The only `review.json` refusal of a create: another writer made the session between the
    // check above and the lock. One answer, one code.
    if (error instanceof StorageError && error.file === reviewPath(dataDir, name)) {
      throw new DomainError("session-exists", `review session "${name}" already exists`);
    }
    throw error;
  }

  if (options.use !== false) await writeCurrent(dataDir, name);
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

/** What a deletion left: the session `current` names now, and whether it was moved to it. */
type Deleted = { current: string | null; moved: boolean };

/** Deletes a session and everything in its directory (DA-40): only a human does, as only a human
 * closes a task, and a deleted `current` moves to the session updated last (04-domain.md). */
export async function deleteSession(
  dataDir: string,
  name: string,
  by: { role: Role },
): Promise<Deleted> {
  await assertDeletable(dataDir, name, by);
  try {
    await removeSession(dataDir, name);
  } catch (error) {
    // Deleted by someone else between the check above and the lock: the same answer.
    if (error instanceof NoSuchSessionError) {
      throw new DomainError("no-such-session", `no review session "${name}"`);
    }
    throw error;
  }
  const current = await readCurrent(dataDir);
  if (current !== name) return { current, moved: false };
  // `current` is written unlocked: a second delete may take the session chosen here meanwhile,
  // so the choice is made again until the pointer names one that is there (03-storage.md).
  for (;;) {
    const next = await mostRecent(dataDir);
    if (next === null) {
      await clearCurrent(dataDir);
      return { current: null, moved: true };
    }
    await writeCurrent(dataDir, next);
    if (await sessionExists(dataDir, next)) return { current: next, moved: true };
  }
}

/** What `deleteSession` checks before it writes, for a caller that asks a person first: a question
 * whose answer would be refused is not asked. */
export async function assertDeletable(
  dataDir: string,
  name: string,
  by: { role: Role },
): Promise<void> {
  assertSessionName(name);
  // Asked before the role, as `closeSession` asks: a mistyped name answers "no review session".
  // A `review.json` broken by hand is still a session, and deleting it is how it goes.
  if (!(await sessionExists(dataDir, name))) {
    throw new DomainError("no-such-session", `no review session "${name}"`);
  }
  assertHuman(by, "delete a review task");
}

/** The session updated last, from `review.json` alone; one that cannot be read is passed over. */
async function mostRecent(dataDir: string): Promise<string | null> {
  let best: { name: string; updatedAt: string } | null = null;
  for (const name of (await listSessionNames(dataDir)).names) {
    const review = await readReview(dataDir, name).catch(() => null);
    if (review === null) continue;
    if (best === null || review.updatedAt > best.updatedAt) {
      best = { name, updatedAt: review.updatedAt };
    }
  }
  return best?.name ?? null;
}

/** Every session with its counters, most recently updated first; a file broken by hand is not
 * passed over but reported by the read that hits it (04-domain.md, "Review sessions"). */
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
      scope: review.scope,
      status: review.status,
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

/** "No such file" becomes `no-such-session`; an unreadable file keeps its `StorageError`, as "no
 * review session" would send the reader after one that is right there (04-domain.md). */
export async function readSession(dataDir: string, name: string): Promise<Review> {
  if (!(await sessionExists(dataDir, name))) {
    throw new DomainError("no-such-session", `no review session "${name}"`);
  }
  return readReview(dataDir, name);
}

/** The session it was given, else the current one: the fallback of every command, kept here
 * rather than in each ([04-domain.md](../../../docs/reference/04-domain.md), "Review sessions"). */
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

/** The embedding index over every session's comments: brought up to date by the reader that
 * needs it, and searched by brute force (09-ml.md, "The index"). */
import { stat } from "node:fs/promises";
import type { Comment } from "../../storage/index.ts";
import {
  commentsPath,
  listSessionNames,
  readComments,
  StorageError,
  timestamp,
} from "../../storage/index.ts";
import type { Embedder } from "../embed/embedder.ts";
import type { EmbeddingIdentity } from "../embed/model.ts";
import type { EmbeddingIndex, Fingerprint, IndexEntry } from "./store.ts";
import { indexPath, readIndex, writeIndex } from "./store.ts";

export type { EmbeddingIndex, IndexEntry } from "./store.ts";
export { indexPath, readIndex } from "./store.ts";

export function sameIdentity(a: EmbeddingIdentity, b: EmbeddingIdentity): boolean {
  return (
    a.model === b.model &&
    a.revision === b.revision &&
    a.runtime === b.runtime &&
    a.platform === b.platform
  );
}

function samePrint(a: Fingerprint | undefined, b: Fingerprint): boolean {
  if (a === undefined) return false;
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Taken before the file is read, so a write landing between the two is seen next time. */
async function fingerprint(dataDir: string, session: string): Promise<Fingerprint> {
  try {
    const info = await stat(commentsPath(dataDir, session));
    return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function entryOf(session: string, comment: Comment): IndexEntry {
  return {
    session,
    id: comment.id,
    severity: comment.severity,
    severitySource: comment.severitySource,
    repo: comment.repo,
    path: comment.path,
    line: comment.line,
    body: comment.body,
  };
}

export type IndexUpdate = {
  /** Comments embedded by this update: new ones, and ones whose text changed. */
  embedded: number;
  /** Comments whose vector was carried over. */
  kept: number;
  /** Entries whose comment or session is no longer on disk. */
  dropped: number;
  sessions: number;
  /** Why nothing was carried over, when nothing was: `null` for an incremental update. */
  rebuilt: string | null;
  warnings: string[];
};

type UpdateOptions = {
  /** Embed every comment again, whatever the index holds: `index rebuild`. */
  rebuild?: boolean;
  /** The index as the caller last read or wrote it, when the file has not changed since: it is
   * not read again. The server keeps one between two suggestions. */
  current?: EmbeddingIndex | undefined;
};

type Row = { entry: IndexEntry; vector: Float32Array | null };

/** Brings the index to what the sessions hold, embedding only new and edited texts; a session
 * whose `comments.json` kept its fingerprint is not read (09-ml.md, "Bringing it up to date"). */
export async function updateIndex(
  dataDir: string,
  embedder: Pick<Embedder, "identity" | "model" | "embed">,
  options: UpdateOptions = {},
): Promise<{ index: EmbeddingIndex; update: IndexUpdate }> {
  const read =
    options.rebuild === true
      ? null
      : options.current !== undefined
        ? { index: options.current, problem: null }
        : await readIndex(dataDir);
  let previous = read?.index ?? null;
  let rebuilt: string | null = null;
  if (options.rebuild === true) rebuilt = "asked for";
  else if (read?.problem) rebuilt = `unreadable: ${read.problem}`;
  else if (previous === null) rebuilt = "no index yet";
  else if (!sameIdentity(previous.identity, embedder.identity)) {
    rebuilt = `built by ${describeIdentity(previous.identity)}`;
    previous = null;
  }

  const listing = await listSessionNames(dataDir);
  const warnings = [...listing.warnings];
  // No session and no index: nothing to write, and no `index/` to make where nothing was.
  if (listing.names.length === 0 && read?.index == null && !(await exists(indexPath(dataDir)))) {
    const empty = { identity: embedder.identity, dimensions: embedder.model.dimensions };
    const index = { ...empty, updatedAt: timestamp(), sessions: {}, entries: [] };
    const update = { embedded: 0, kept: 0, dropped: 0, sessions: 0, rebuilt, warnings };
    return { index: { ...index, vectors: new Float32Array(0) }, update };
  }
  const prints = new Map<string, Fingerprint>();
  for (const session of listing.names) prints.set(session, await fingerprint(dataDir, session));
  // Nothing written since: the index as it is, not a copy of it.
  if (
    previous !== null &&
    listing.names.length === Object.keys(previous.sessions).length &&
    listing.names.every((session) =>
      samePrint((previous as EmbeddingIndex).sessions[session], prints.get(session) ?? null),
    )
  ) {
    const kept = previous.entries.length;
    const update = { embedded: 0, kept, dropped: 0, sessions: listing.names.length, rebuilt };
    return { index: previous, update: { ...update, warnings } };
  }
  const dimensions = embedder.model.dimensions;
  const vectorAt = (row: number): Float32Array =>
    (previous as EmbeddingIndex).vectors.subarray(row * dimensions, (row + 1) * dimensions);
  const old = new Map<string, number>();
  const bySession = new Map<string, Row[]>();
  previous?.entries.forEach((entry, row) => {
    old.set(`${entry.session}\u0000${entry.id}`, row);
    const list = bySession.get(entry.session) ?? [];
    list.push({ entry, vector: vectorAt(row) });
    bySession.set(entry.session, list);
  });

  const sessions: Record<string, Fingerprint> = {};
  const rows: Row[] = [];
  let changed = previous === null;
  for (const session of listing.names) {
    const print = prints.get(session) ?? null;
    const carried = bySession.get(session) ?? [];
    if (previous !== null && samePrint(previous.sessions[session], print)) {
      sessions[session] = print;
      rows.push(...carried);
      continue;
    }
    let comments: Comment[];
    try {
      comments = await readComments(dataDir, session);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      // A file broken by hand keeps what was indexed of it and its old fingerprint, so it is
      // read again next time and the index is not rewritten for it in the meantime.
      warnings.push(`${error.message}; its comments were not indexed again`);
      const before = previous?.sessions[session];
      if (before !== undefined) sessions[session] = before;
      rows.push(...carried);
      continue;
    }
    changed = true;
    sessions[session] = print;
    for (const comment of comments) {
      const row = old.get(`${session}\u0000${comment.id}`);
      const same = row !== undefined && previous?.entries[row]?.body === comment.body;
      rows.push({ entry: entryOf(session, comment), vector: same ? vectorAt(row) : null });
    }
  }

  let embedded = 0;
  for (const row of rows) {
    if (row.vector !== null) continue;
    // One text per call: a run holds the thread, and the loop yields between two of them.
    const [vector] = await embedder.embed([row.entry.body]);
    if (vector === undefined) throw new Error("the embedder returned no vector");
    row.vector = vector;
    embedded += 1;
  }
  const kept = rows.length - embedded;
  const dropped = (previous?.entries.length ?? 0) - kept;
  if (embedded > 0 || dropped > 0) changed = true;

  const vectors = new Float32Array(rows.length * dimensions);
  rows.forEach((row, index) => {
    vectors.set(row.vector as Float32Array, index * dimensions);
  });
  const index: EmbeddingIndex = {
    identity: embedder.identity,
    dimensions,
    updatedAt: changed || previous === null ? timestamp() : previous.updatedAt,
    sessions,
    entries: rows.map((row) => row.entry),
    vectors,
  };
  if (changed) await writeIndex(dataDir, index);
  return {
    index,
    update: {
      embedded,
      kept,
      dropped,
      sessions: listing.names.length,
      rebuilt,
      warnings,
    },
  };
}

export function describeIdentity(identity: EmbeddingIdentity): string {
  return `${identity.model} @ ${identity.revision.slice(0, 12)}, ${identity.runtime}, ${identity.platform}`;
}

export type Neighbour = IndexEntry & { similarity: number };

type SearchOptions = {
  k: number;
  /** Only comments of these sessions; every session without it. */
  sessions?: readonly string[];
};

/** The `k` rows nearest to `query` by cosine, highest first; the vectors are unit length, so
 * cosine is the dot product. Brute force: 09-ml.md has the sizes it stays fast for. */
export function nearest(
  index: EmbeddingIndex,
  query: Float32Array,
  options: SearchOptions,
): Neighbour[] {
  const { dimensions, entries, vectors } = index;
  const only = options.sessions === undefined ? null : new Set(options.sessions);
  const best: { row: number; score: number }[] = [];
  for (let row = 0; row < entries.length; row += 1) {
    if (only !== null && !only.has((entries[row] as IndexEntry).session)) continue;
    const score = dot(vectors, row * dimensions, query);
    if (best.length === options.k && score <= (best[best.length - 1] as { score: number }).score) {
      continue;
    }
    let at = best.length;
    while (at > 0 && (best[at - 1] as { score: number }).score < score) at -= 1;
    best.splice(at, 0, { row, score });
    if (best.length > options.k) best.pop();
  }
  return best.map(({ row, score }) => ({ ...(entries[row] as IndexEntry), similarity: score }));
}

/** Four sums at a time: half the time of the plain loop on Bun, measured in 09-ml.md. */
function dot(vectors: Float32Array, offset: number, query: Float32Array): number {
  const length = query.length;
  const whole = length - (length % 4);
  let a = 0;
  let b = 0;
  let c = 0;
  let e = 0;
  let d = 0;
  for (; d < whole; d += 4) {
    const at = offset + d;
    a += (vectors[at] as number) * (query[d] as number);
    b += (vectors[at + 1] as number) * (query[d + 1] as number);
    c += (vectors[at + 2] as number) * (query[d + 2] as number);
    e += (vectors[at + 3] as number) * (query[d + 3] as number);
  }
  for (; d < length; d += 1) a += (vectors[offset + d] as number) * (query[d] as number);
  return a + b + c + e;
}

export type IndexStatus = {
  location: string;
  present: boolean;
  /** Why the file on disk cannot be used; the next update embeds everything again. */
  problem: string | null;
  /** What the index was built by, and what this build embeds with. */
  builtBy: EmbeddingIdentity | null;
  build: EmbeddingIdentity;
  comments: number;
  sessions: number;
  updatedAt: string | null;
  /** Comments on disk the index does not hold, or holds with another text. */
  missing: number;
  /** Entries whose comment is no longer on disk. */
  gone: number;
  warnings: string[];
};

/** What the index holds against what the sessions hold, read without the model. */
export async function indexStatus(dataDir: string, build: EmbeddingIdentity): Promise<IndexStatus> {
  const { index, problem } = await readIndex(dataDir);
  const listing = await listSessionNames(dataDir);
  const warnings = [...listing.warnings];
  const held = new Map<string, string>();
  for (const entry of index?.entries ?? [])
    held.set(`${entry.session}\u0000${entry.id}`, entry.body);
  const usable = index !== null && sameIdentity(index.identity, build);
  let missing = 0;
  let found = 0;
  for (const session of listing.names) {
    let comments: Comment[];
    try {
      comments = await readComments(dataDir, session);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      warnings.push(error.message);
      // What was indexed of a file that cannot be read is kept by the update, so it is not gone.
      found += index?.entries.filter((entry) => entry.session === session).length ?? 0;
      continue;
    }
    for (const comment of comments) {
      const body = usable ? held.get(`${session}\u0000${comment.id}`) : undefined;
      if (body === comment.body) found += 1;
      else missing += 1;
    }
  }
  return {
    location: indexPath(dataDir),
    present: index !== null,
    problem,
    builtBy: index?.identity ?? null,
    build,
    comments: index?.entries.length ?? 0,
    sessions: new Set(index?.entries.map((entry) => entry.session)).size,
    updatedAt: index?.updatedAt ?? null,
    missing,
    gone: usable ? (index?.entries.length ?? 0) - found : 0,
    warnings,
  };
}

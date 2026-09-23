/** `index/index.bin`: one line of JSON naming every entry, then their vectors as raw floats, in
 * one file written whole and read whole. Why this shape is 09-ml.md, "The index". */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../storage/atomic.ts";
import type { Severity } from "../../storage/index.ts";
import { makeDir, SCHEMA_VERSION, SEVERITIES } from "../../storage/index.ts";
import type { EmbeddingIdentity } from "../embed/model.ts";

/** One comment of one session, with what a suggestion shows of it. */
export type IndexEntry = {
  session: string;
  id: string;
  severity: Severity;
  repo: string | null;
  path: string | null;
  line: number | null;
  body: string;
};

/** What a session's `comments.json` looked like when it was last read; `null` when it was absent.
 * The inode is in because every atomic write makes a new file, whatever its time and size. */
export type Fingerprint = { mtimeMs: number; size: number; ino: number } | null;

export type EmbeddingIndex = {
  identity: EmbeddingIdentity;
  dimensions: number;
  updatedAt: string;
  sessions: Record<string, Fingerprint>;
  entries: IndexEntry[];
  /** Row `i`, `dimensions` long, is the unit vector of `entries[i]`. */
  vectors: Float32Array;
};

function indexDir(dataDir: string): string {
  return join(dataDir, "index");
}

export function indexPath(dataDir: string): string {
  return join(indexDir(dataDir), "index.bin");
}

/** The vectors start at the first multiple of four after the header line, so they can be read
 * in place as a `Float32Array`. */
function vectorsAt(newline: number): number {
  return Math.ceil((newline + 1) / Float32Array.BYTES_PER_ELEMENT) * Float32Array.BYTES_PER_ELEMENT;
}

/** An index file that is not there reads as `null` with no problem; one that cannot be used
 * reads as `null` with the reason, and the next update embeds everything again. */
type IndexRead = { index: EmbeddingIndex | null; problem: string | null };

export async function readIndex(dataDir: string): Promise<IndexRead> {
  const path = indexPath(dataDir);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { index: null, problem: null };
    return { index: null, problem: `${path}: ${error instanceof Error ? error.message : error}` };
  }
  try {
    return { index: parseIndex(bytes), problem: null };
  } catch (error) {
    return { index: null, problem: `${path}: ${error instanceof Error ? error.message : error}` };
  }
}

export async function writeIndex(dataDir: string, index: EmbeddingIndex): Promise<void> {
  await makeDir(indexDir(dataDir));
  // `JSON.stringify` escapes every newline inside a string, so the header is exactly one line.
  const header = Buffer.from(
    `${JSON.stringify({
      version: SCHEMA_VERSION,
      ...index.identity,
      dimensions: index.dimensions,
      updatedAt: index.updatedAt,
      sessions: index.sessions,
      entries: index.entries,
    })}\n`,
  );
  const start = vectorsAt(header.length - 1);
  const file = new Uint8Array(start + index.vectors.byteLength);
  file.set(header);
  file.set(
    new Uint8Array(index.vectors.buffer, index.vectors.byteOffset, index.vectors.byteLength),
    start,
  );
  // Not durable: a cache the next update or `index rebuild` writes again, like diff.json.
  await writeFileAtomic(indexPath(dataDir), file, { durable: false });
}

function fail(field: string, what: string): never {
  throw new Error(`${field}: ${what}`);
}

function string(value: unknown, field: string): string {
  return typeof value === "string" ? value : fail(field, "expected a string");
}

function nullable<T>(value: unknown, field: string, read: (v: unknown, f: string) => T): T | null {
  return value === null ? null : read(value, field);
}

function number(value: unknown, field: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(field, "expected a number");
}

function record(value: unknown, field: string): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(field, "expected an object");
}

/** Checked down to the length of the vectors: a torn or hand-edited file is rebuilt, not half-read. */
function parseIndex(bytes: Buffer): EmbeddingIndex {
  const newline = bytes.indexOf(0x0a);
  if (newline === -1) fail("the header", "no end of line");
  const file = record(JSON.parse(bytes.toString("utf8", 0, newline)), "the header");
  if (file.version !== SCHEMA_VERSION) fail("version", `expected ${SCHEMA_VERSION}`);
  const dimensions = number(file.dimensions, "dimensions");
  const identity: EmbeddingIdentity = {
    model: string(file.model, "model"),
    revision: string(file.revision, "revision"),
    runtime: string(file.runtime, "runtime"),
    platform: string(file.platform, "platform"),
  };
  const sessions: Record<string, Fingerprint> = {};
  for (const [name, value] of Object.entries(record(file.sessions, "sessions"))) {
    sessions[name] = nullable(value, `sessions.${name}`, (one, field) => {
      const print = record(one, field);
      const size = number(print.size, field);
      return { mtimeMs: number(print.mtimeMs, field), size, ino: number(print.ino, field) };
    });
  }
  if (!Array.isArray(file.entries)) fail("entries", "expected a list");
  const entries = file.entries.map((value: unknown, row: number): IndexEntry => {
    const field = `entries[${row}]`;
    const entry = record(value, field);
    const severity = string(entry.severity, `${field}.severity`);
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      fail(`${field}.severity`, "not a severity");
    }
    return {
      session: string(entry.session, `${field}.session`),
      id: string(entry.id, `${field}.id`),
      severity: severity as Severity,
      repo: nullable(entry.repo, `${field}.repo`, string),
      path: nullable(entry.path, `${field}.path`, string),
      line: nullable(entry.line, `${field}.line`, number),
      body: string(entry.body, `${field}.body`),
    };
  });
  const start = vectorsAt(newline);
  const count = entries.length * dimensions;
  if (bytes.length - start !== count * Float32Array.BYTES_PER_ELEMENT) {
    fail("the vectors", `expected ${entries.length} of ${dimensions} floats`);
  }
  // In place when the buffer allows it; a copy when its offset is not a multiple of four.
  const vectors =
    (bytes.byteOffset + start) % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(bytes.buffer, bytes.byteOffset + start, count)
      : new Float32Array(new Uint8Array(bytes.subarray(start)).buffer);
  return {
    identity,
    dimensions,
    updatedAt: string(file.updatedAt, "updatedAt"),
    sessions,
    entries,
    vectors,
  };
}

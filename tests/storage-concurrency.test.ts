/**
 * The gate of [ADR-003](../docs/adr/adr-003-on-disk-format.md): concurrent
 * writers lose nothing. Twenty processes append one reply each to the same
 * comment; every reply has to be in the file.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Comment, dataDirOf, ensureDataDir, readComments } from "../src/core/storage/index.ts";
import { comment, makeSession } from "./helpers/session.ts";

const run = promisify(execFile);
const WRITERS = 20;
const SESSION = "concurrent";
const COMMENT = "c_aaaaaa";
const worker = fileURLToPath(new URL("./helpers/append-reply.ts", import.meta.url));

let root: string;
let dataDir: string;
let replies: Comment["replies"];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-concurrency-"));
  dataDir = dataDirOf(root);
  await ensureDataDir(dataDir);
  await makeSession(dataDir, SESSION, [comment(COMMENT)]);

  await Promise.all(
    Array.from({ length: WRITERS }, (_, index) =>
      run(process.execPath, [worker, dataDir, SESSION, COMMENT, `agent-${index}`]),
    ),
  );

  const comments = await readComments(dataDir, SESSION);
  replies = comments[0]?.replies ?? [];
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("concurrent writers", () => {
  it("keeps every reply", () => {
    expect(replies).toHaveLength(WRITERS);
    expect(new Set(replies.map((reply) => reply.author)).size).toBe(WRITERS);
  });

  it("numbers them in the order they arrived", () => {
    expect(replies.map((reply) => reply.id)).toEqual(
      Array.from({ length: WRITERS }, (_, index) => `r_${index + 1}`),
    );
    // Each stamp is taken inside the lock, so arrival order and file order agree.
    const stamps = replies.map((reply) => reply.createdAt);
    expect([...stamps].sort()).toEqual(stamps);
  });
});

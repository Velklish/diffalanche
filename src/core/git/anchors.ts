import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Anchor } from "../storage/index.ts";
import type { FileChange } from "../types.ts";
import { parseDiff, unquote } from "./patch.ts";
import { gitLines, gitOrNull, mergeBase, repositoryDrivers, revParse } from "./run.ts";

type Revision = NonNullable<Anchor["revision"]>;
type Mapping = { path: string; lines: number[] };
type AnchorPatch = { files: FileChange[] };

/** A surviving row carries both its coordinates and its file identity at the pinned target. */
export async function reverseAnchor(
  cwd: string,
  source: Revision,
  target: string,
): Promise<Mapping | null> {
  if (source.sha === target)
    return {
      path: source.path,
      lines: Array.from({ length: source.endLine - source.line + 1 }, (_, i) => source.line + i),
    };
  if ((await mergeBase(cwd, source.sha, target)) !== source.sha) return null;
  const raw = await gitOrNull(cwd, [
    "blame",
    "--reverse",
    "--line-porcelain",
    "-L",
    `${source.line},${source.endLine}`,
    `${source.sha}..${target}`,
    "--",
    source.path,
  ]);
  if (raw === null) return null;
  const mapped = new Map<number, { path: string; line: number }>();
  let record: { source: number; line: number; sha: string } | null = null;
  let path: string | null = null;
  for (const row of raw.split("\n")) {
    const match = /^([a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(row);
    if (match !== null) {
      record = { sha: match[1] ?? "", source: Number(match[3]), line: Number(match[2]) };
      path = null;
    } else if (row.startsWith("filename ")) path = unquote(row.slice(9));
    else if (row.startsWith("\t") && record?.sha === target && path !== null)
      mapped.set(record.source, { path, line: record.line });
  }
  const rows = Array.from({ length: source.endLine - source.line + 1 }, (_, i) =>
    mapped.get(source.line + i),
  );
  const first = rows[0];
  if (first === undefined || !rows.every((row) => row !== undefined && row.path === first.path))
    return null;
  return { path: first.path, lines: rows.flatMap((row) => (row === undefined ? [] : [row.line])) };
}

/** Git compares only captured bytes here; a later worktree change cannot supply this mapping. */
export async function capturedAnchorPatch(
  cwd: string,
  dataDir: string,
  path: string,
  headText: string,
  targetText: string,
  overrides: string[],
): Promise<AnchorPatch> {
  if (headText === targetText) return { files: [] };
  const directory = join(dataDir, "index");
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(join(directory, ".anchor-map-"));
  try {
    const before = join(temporary, "before");
    const after = join(temporary, "after");
    await Promise.all([writeFile(before, headText), writeFile(after, targetText)]);
    const rows: string[] = [];
    await gitLines(
      cwd,
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "-U0",
        "--",
        before,
        after,
      ],
      (row) => {
        rows.push(row);
        return true;
      },
      overrides,
    );
    return {
      files: parseDiff(`${rows.join("\n")}\n`, {
        hunks: true,
        maxFileBytes: Number.POSITIVE_INFINITY,
      }).files.map((file) => ({ ...file, path, oldPath: null })),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function mapWorktreeAnchor(
  patch: AnchorPatch,
  path: string,
  lines: number[],
  reverse = false,
): number[] | null {
  const file = patch.files.find((one) => one.path === path || one.oldPath === path);
  if (file === undefined) return lines;
  if (file.status === "deleted" || file.omitted !== null) return null;
  const result: number[] = [];
  for (const line of lines) {
    let shift = 0;
    for (const hunk of file.hunks) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunk.header);
      if (match === null) return null;
      const start = Number(match[reverse ? 3 : 1]);
      const removed = Number(match[reverse ? 4 : 2] ?? 1);
      const added = Number(match[reverse ? 2 : 4] ?? 1);
      if (removed > 0 && line >= start && line < start + removed) return null;
      if (removed === 0 ? line > start : line >= start + removed) shift += added - removed;
    }
    result.push(line + shift);
  }
  return result;
}

/** Inserted/replaced captured rows have no committed identity, including copies of old text. */
export async function captureRevision(
  cwd: string,
  dataDir: string,
  input: {
    path: string;
    text: string;
    line: number;
    endLine: number;
    base?: { sha: string; path: string | null };
  },
  read: (path: string, sha: string) => Promise<string | null>,
): Promise<Revision | null> {
  const sha = await revParse(cwd, "HEAD");
  if (sha === null) return null;
  const path = input.base?.sha === sha ? input.base.path : input.path;
  if (path === null) return null;
  const headText = await read(path, sha);
  if (headText === null) return null;
  const drivers = await repositoryDrivers(cwd);
  if (drivers === null) throw new Error("repository configuration could not be read");
  const patch = await capturedAnchorPatch(cwd, dataDir, path, headText, input.text, drivers);
  const rows = mapWorktreeAnchor(
    patch,
    path,
    Array.from({ length: input.endLine - input.line + 1 }, (_, i) => input.line + i),
    true,
  );
  if (rows === null || rows.some((row, i) => row !== (rows[0] ?? 0) + i)) return null;
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return null;
  return { sha, path, line: first, endLine: last };
}

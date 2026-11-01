import type { Anchor } from "../storage/index.ts";
import { parseDiff } from "./patch.ts";
import { git, gitOrNull, mergeBase, repositoryDrivers, revParse } from "./run.ts";

type Revision = NonNullable<Anchor["revision"]>;

/** Porcelain names the last surviving commit: only rows at the pinned target still exist. */
export async function reverseAnchor(
  cwd: string,
  source: Revision,
  target: string,
): Promise<number[] | null> {
  if (source.sha === target)
    return Array.from({ length: source.endLine - source.line + 1 }, (_, i) => source.line + i);
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
  const mapped = new Map<number, number>();
  for (const row of raw.split("\n")) {
    const match = /^([a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(row);
    if (match === null || match[1] !== target) continue;
    mapped.set(Number(match[3]), Number(match[2]));
  }
  const lines = Array.from({ length: source.endLine - source.line + 1 }, (_, i) =>
    mapped.get(source.line + i),
  );
  return lines.every((line): line is number => line !== undefined) ? lines : null;
}

/** Maps surviving committed rows through staged and unstaged edits without refreshing the index. */
export async function worktreeAnchorPatch(
  cwd: string,
  head: string,
  overrides: string[],
): Promise<ReturnType<typeof parseDiff>> {
  return parseDiff(
    await git(
      cwd,
      ["diff-index", "-p", "-M", head, "--no-color", "--no-ext-diff", "--no-textconv", "-U0"],
      overrides,
    ),
    { hunks: true },
  );
}

export function mapWorktreeAnchor(
  patch: Awaited<ReturnType<typeof worktreeAnchorPatch>>,
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

/** Worktree-only rows cannot claim a committed identity, even when their text is a copy. */
export async function captureRevision(
  cwd: string,
  path: string,
  line: number,
  endLine: number,
): Promise<Revision | null> {
  const sha = await revParse(cwd, "HEAD");
  if (sha === null) return null;
  const drivers = await repositoryDrivers(cwd);
  if (drivers === null) throw new Error("repository configuration could not be read");
  const patch = await worktreeAnchorPatch(cwd, sha, drivers);
  const rows = mapWorktreeAnchor(
    patch,
    path,
    Array.from({ length: endLine - line + 1 }, (_, i) => line + i),
    true,
  );
  if (rows === null || rows.some((row, i) => row !== (rows[0] ?? 0) + i)) return null;
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return null;
  return {
    sha,
    path: patch.files.find((file) => file.path === path)?.oldPath ?? path,
    line: first,
    endLine: last,
  };
}

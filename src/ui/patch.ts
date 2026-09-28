/** A live update merged into the change set file by file and hunk by hunk, so an unchanged card
 * keeps its object, its DOM and the reader's place (08-ui.md, "Patching, not repainting"). */
import type { FileData } from "react-diff-view";
import { parseDiff } from "react-diff-view";
import type { FileChange, FileStatus, RepositoryChange } from "../core/types.ts";
import { oneColumn } from "./measure.ts";

/** Every patch of one entry as one file to render ([02-git.md](../../docs/reference/02-git.md)). */
export function mergedPatch(patch: string, status: FileStatus): FileData | null {
  const files = parseDiff(patch, { nearbySequences: "zip" });
  const first = files[0];
  if (first === undefined) return null;
  const alone = first.type === "add" || first.type === "delete";
  if (files.length === 1 && (!alone || oneColumn(status))) return first;
  // `modify`, like the entry itself — with one half omitted too, since the card
  // is sized from the entry's status and not from the half that survived.
  return { ...first, type: "modify", hunks: files.flatMap((one) => one.hunks) };
}

/** One hunk of a patch: the `@@` line it is headed by, and everything under it. */
type PatchHunk = { header: string; body: string };

/** The hunks of a file that changed, by their `@@` header, and when they did. */
export type ChangedHunks = { hunks: Set<string>; at: number };

/** The repository as it now stands, keeping every object that says the same; `before` itself when
 * nothing changed, so a watcher waking on a file the change set lacks re-renders nothing. */
export function mergeRepository(
  before: RepositoryChange,
  next: RepositoryChange,
): RepositoryChange {
  const known = new Map(before.files.map((file) => [file.path, file]));
  let moved = before.files.length !== next.files.length;
  const files = next.files.map((file, index) => {
    const old = known.get(file.path);
    if (old === undefined || !sameFile(old, file)) {
      moved = true;
      return file;
    }
    if (before.files[index] !== old) moved = true;
    return old;
  });
  if (!moved && sameHead(before, next)) return before;
  return { ...next, files };
}

/** Everything about a file a card is drawn from; a diff that says the same is the same. */
function sameFile(before: FileChange, next: FileChange): boolean {
  return (
    before.patch === next.patch &&
    before.status === next.status &&
    before.oldPath === next.oldPath &&
    before.additions === next.additions &&
    before.deletions === next.deletions &&
    before.omitted === next.omitted
  );
}

/** The repository header's branch, resolved base and warnings; warnings compare by what they say,
 * since a base that stopped resolving for another reason is another sentence on the screen. */
function sameHead(before: RepositoryChange, next: RepositoryChange): boolean {
  return (
    before.branch === next.branch &&
    before.base?.ref === next.base?.ref &&
    before.base?.sha === next.base?.sha &&
    before.warnings.length === next.warnings.length &&
    before.warnings.every((warning, at) => warning === next.warnings[at])
  );
}

/** The new patch's hunks the old one lacked, by header. Header and body must both match: an edit
 * above renumbers every header after it, and those numbers are part of what the reader sees. */
export function changedHunks(before: string, next: string): Set<string> {
  const had = new Set(splitHunks(before).map(whole));
  const changed = new Set<string>();
  for (const hunk of splitHunks(next)) {
    if (!had.has(whole(hunk))) changed.add(hunk.header);
  }
  return changed;
}

function whole(hunk: PatchHunk): string {
  return `${hunk.header}\n${hunk.body}`;
}

/** The hunks of a patch, headers included; everything before the first `@@` is the file header. */
export function splitHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let header: string | null = null;
  let body: string[] = [];
  for (const line of patch.split("\n")) {
    // The header of the other half of a type change, not the body of the hunk
    // above it ([02-git.md](../../docs/reference/02-git.md)).
    if (line.startsWith("diff --git ")) {
      if (header !== null) hunks.push({ header, body: body.join("\n") });
      header = null;
      body = [];
      continue;
    }
    if (line.startsWith("@@")) {
      if (header !== null) hunks.push({ header, body: body.join("\n") });
      header = line;
      body = [];
      continue;
    }
    if (header !== null) body.push(line);
  }
  if (header !== null) hunks.push({ header, body: body.join("\n") });
  return hunks;
}

/** Whether the new side still carries a line, added or context, which an open composer is keyed to
 * and re-validated against (08-ui.md, "The reading position and the open form"). */
export function hasNewLine(patch: string, line: number): boolean {
  let at = 0;
  let started = false;
  for (const row of patch.split("\n")) {
    // `+++ b/…` of the other half of a type change is a header, not a new line.
    if (row.startsWith("diff --git ")) {
      started = false;
      continue;
    }
    if (row.startsWith("@@")) {
      at = Number(/\+(\d+)/.exec(row)?.[1] ?? 1);
      started = true;
      continue;
    }
    if (!started) continue;
    const kind = row[0];
    // A deletion has no line on the new side, and `\ No newline at end of file`
    // is neither: only the two kinds the new column draws are counted.
    if (kind !== "+" && kind !== " ") continue;
    if (at === line) return true;
    at += 1;
  }
  return false;
}

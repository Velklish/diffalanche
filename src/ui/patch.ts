/**
 * What a live update does to the change set the page already holds
 * (`docs/design/HANDOFF.md`, "Performance & live update"): a repository's new
 * diff replaces the old one file by file and hunk by hunk, so a card whose file
 * did not change keeps the object it was rendered from — and with it its DOM,
 * its tokens, and the reader's place in it.
 */
import type { FileChange, RepositoryChange } from "../core/types.ts";

/** One hunk of a patch: the `@@` line it is headed by, and everything under it. */
export type PatchHunk = { header: string; body: string };

/** The hunks of a file that changed, by their `@@` header, and when they did. */
export type ChangedHunks = { hunks: Set<string>; at: number };

/**
 * The repository as it now stands, keeping every object that says the same
 * thing as before. `before` itself comes back when nothing in it changed at
 * all: a watcher that woke on a file the change set does not carry — a build
 * output, a file the base already had — must not re-render the review.
 */
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

/**
 * What the repository header shows: the branch it is on, the base it resolved
 * to, and what the resolution had to say. The warnings are compared by what
 * they say and not by how many there are — a base that stopped resolving for a
 * different reason is a different sentence on the screen.
 */
function sameHead(before: RepositoryChange, next: RepositoryChange): boolean {
  return (
    before.branch === next.branch &&
    before.base?.ref === next.base?.ref &&
    before.base?.sha === next.base?.sha &&
    before.warnings.length === next.warnings.length &&
    before.warnings.every((warning, at) => warning === next.warnings[at])
  );
}

/**
 * The hunks of the new patch that the old one did not have, by header. A hunk
 * is the same hunk when its header and its body are both unchanged: an edit
 * further down the file renumbers the headers of everything after it, and those
 * hunks did change — their line numbers are part of what the reader sees.
 */
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

/**
 * Whether the new side of a patch still carries a line — an added line or a
 * context line. It is what an open composer is re-validated against: the form
 * is keyed to a line of the diff, and a line the edit took away has no row left
 * for it to sit under.
 */
export function hasNewLine(patch: string, line: number): boolean {
  let at = 0;
  let started = false;
  for (const row of patch.split("\n")) {
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

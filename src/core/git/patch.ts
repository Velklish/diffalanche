import gitdiff, { type Change, type FileType, type Hunk as ParsedHunk } from "gitdiff-parser";
import type { DiffLine, FileChange, FileStatus, Hunk } from "../types.ts";

/**
 * A file whose patch is bigger than this is listed without content. Half a
 * megabyte is far above a reviewable file and far below what would make the one
 * review response heavy.
 */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** What a caller of the parser can ask for. */
export type PatchOptions = {
  /** A file whose patch is bigger than this is listed without content. */
  maxFileBytes?: number | undefined;
  /**
   * Fill `hunks`. The renderer reads `patch`, so the review response leaves them
   * out: 30 000 changed lines are far more objects as a structure than as a
   * string, and the scrolling budget of `docs/SPEC.md` section 6 pays for it.
   * `diff --json` and `diff.json` ask for them.
   */
  hunks?: boolean | undefined;
};

/**
 * Splits `git diff` output into one file each and parses every patch.
 *
 * The structured shape comes from `gitdiff-parser`, the parser `react-diff-view`
 * re-exports as `parseDiff` — the same code, imported from its own package so
 * that nothing pulls React into the CLI. `docs/SPEC.md` section 11 rules out a
 * diff parser of the project's own. The raw patch of each file is kept beside
 * the hunks, because that is what the renderer reads
 * ([ADR-008](../../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
export function parseDiff(raw: string, options: PatchOptions = {}): FileChange[] {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const structured = options.hunks ?? true;
  return split(raw).map((patch) => parseFile(patch, maxFileBytes, structured));
}

/** One patch per file. Only a real header starts a line with `diff --git `. */
function split(raw: string): string[] {
  const patches: string[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    // `git diff` ends with a newline, which leaves an empty last line behind.
    const lines = current.at(-1) === "" ? current.slice(0, -1) : current;
    patches.push(`${lines.join("\n")}\n`);
  };
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = [line];
      continue;
    }
    current?.push(line);
  }
  flush();
  return patches;
}

function parseFile(patch: string, maxFileBytes: number, structured: boolean): FileChange {
  const parsed = gitdiff.parse(patch)[0];
  // A `diff --git` line the parser makes nothing of. The file is real — git
  // printed the header — but why it has no content is unknown, and `binary` is
  // the honest half of it: there is nothing to show. It is not known to happen.
  if (!parsed) return withoutContent(headerPath(patch), null, "modified", "binary");

  const status = STATUS[parsed.type];
  const path = status === "deleted" ? parsed.oldPath : parsed.newPath;
  const oldPath = status === "renamed" ? parsed.oldPath : null;

  // A binary file has no hunks to tell it apart from a mode change, so the patch
  // itself is what says so: git writes one of two forms for it.
  if (parsed.hunks.length === 0 && isBinary(patch)) {
    return withoutContent(path, oldPath, status, "binary");
  }

  const hunks = structured ? parsed.hunks.map(toHunk) : [];
  const additions = count(parsed.hunks, "insert");
  const deletions = count(parsed.hunks, "delete");
  if (Buffer.byteLength(patch, "utf8") > maxFileBytes) {
    const large = withoutContent(path, oldPath, status, "too-large");
    return { ...large, additions, deletions };
  }
  return { path, oldPath, status, additions, deletions, patch, hunks, omitted: null };
}

/** Copy detection is off — `git diff` runs without `-C` — so a copy would be a surprise. */
const STATUS: Record<FileType, FileStatus> = {
  add: "added",
  delete: "deleted",
  modify: "modified",
  rename: "renamed",
  copy: "renamed",
};

function toHunk(hunk: ParsedHunk): Hunk {
  return { header: hunk.content, lines: hunk.changes.map(toLine) };
}

function toLine(change: Change): DiffLine {
  if (change.type === "normal") {
    return {
      type: "context",
      content: change.content,
      oldLine: change.oldLineNumber,
      newLine: change.newLineNumber,
    };
  }
  const inserted = change.type === "insert";
  return {
    type: change.type,
    content: change.content,
    oldLine: inserted ? null : change.lineNumber,
    newLine: inserted ? change.lineNumber : null,
  };
}

/** Counted from the parser's own changes, so the counts survive `hunks: false`. */
function count(hunks: ParsedHunk[], type: Change["type"]): number {
  return hunks.reduce(
    (sum, hunk) => sum + hunk.changes.filter((one) => one.type === type).length,
    0,
  );
}

function isBinary(patch: string): boolean {
  return /^GIT binary patch$/m.test(patch) || /^Binary files .* differ$/m.test(patch);
}

function withoutContent(
  path: string,
  oldPath: string | null,
  status: FileStatus,
  omitted: "binary" | "too-large",
): FileChange {
  return { path, oldPath, status, additions: 0, deletions: 0, patch: "", hunks: [], omitted };
}

/** `diff --git a/old b/new` is the last resort when git printed nothing else about the file. */
function headerPath(patch: string): string {
  const header = patch.split("\n", 1)[0] ?? "";
  const rest = header.slice("diff --git ".length);
  const at = rest.lastIndexOf(" b/");
  return at === -1 ? "" : rest.slice(at + 3);
}

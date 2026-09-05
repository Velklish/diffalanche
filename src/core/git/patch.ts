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
  // The paths are read from the header rather than taken from the parser, which
  // reads them literally and git does not always write them literally.
  const names = headerPaths(patch);
  const parsed = gitdiff.parse(patch)[0];
  // A `diff --git` line the parser makes nothing of. The file is real — git
  // printed the header — but why it has no content is unknown, and `binary` is
  // the honest half of it: there is nothing to show. It is not known to happen.
  if (!parsed) return withoutContent(names.new ?? names.old ?? "", null, "modified", "binary");

  const status = STATUS[parsed.type];
  const oldName = names.old ?? parsed.oldPath;
  const newName = names.new ?? parsed.newPath;
  const path = status === "deleted" ? oldName : newName;
  const oldPath = status === "renamed" ? oldName : null;

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

/** The two sides of a patch, `null` where git wrote `/dev/null`. */
type PatchPaths = { old: string | null; new: string | null };

/**
 * The paths of a patch, as they are on disk.
 *
 * Git does not write a path literally. A name needing an escape — anything
 * outside ASCII, a quote, a control character — is written C-quoted with octal
 * escapes, and an unquoted name containing a space is padded with a tab on the
 * `---` and `+++` lines. Read literally, both come out as a different path, and
 * the path is the id a comment anchors to and the file an agent opens.
 *
 * `---` and `+++` are the best source: one path per line, unambiguous. A pure
 * rename has neither and carries `rename from` and `rename to` instead. A mode
 * change and a binary file have neither of those either, and only then does the
 * `diff --git` line have to be taken apart — where both sides are the same
 * path, which is what makes the ambiguous form readable at all.
 */
function headerPaths(patch: string): PatchPaths {
  // Everything read here is above the first hunk, and a patch is mostly hunks:
  // splitting the whole of it would be a second full pass over every file.
  const hunk = patch.indexOf("\n@@");
  const head = (hunk === -1 ? patch : patch.slice(0, hunk)).split("\n");
  let old: string | null | undefined;
  let renamed: string | null | undefined;
  let from: string | undefined;
  let to: string | undefined;
  for (const line of head) {
    if (line.startsWith("--- ")) old = sidePath(line.slice(4));
    else if (line.startsWith("+++ ")) renamed = sidePath(line.slice(4));
    else if (line.startsWith("rename from ")) from = unquote(line.slice("rename from ".length));
    else if (line.startsWith("rename to ")) to = unquote(line.slice("rename to ".length));
  }
  if (old !== undefined || renamed !== undefined) {
    return { old: old ?? null, new: renamed ?? null };
  }
  if (from !== undefined && to !== undefined) return { old: from, new: to };
  return gitLinePaths(head[0] ?? "");
}

/** `--- a/src/x.ts`, `+++ "b/\303\244.ts"`, `--- /dev/null`, with a tab and a timestamp allowed after. */
function sidePath(value: string): string | null {
  if (value.startsWith('"')) {
    const end = closingQuote(value);
    return withoutPrefix(unquote(value.slice(0, end + 1)));
  }
  // Only an unquoted name reaches here, and an unquoted name holds no tab, so
  // the first one is git's padding and whatever it put after it.
  const tab = value.indexOf("\t");
  return withoutPrefix(tab === -1 ? value : value.slice(0, tab));
}

/**
 * `diff --git a/P b/P`, the last resort. Both sides are the same path here — a
 * rename never reaches this function — so the line is split down the middle
 * rather than at a ` b/` that the path itself could contain.
 */
function gitLinePaths(line: string): PatchPaths {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    const path = withoutPrefix(unquote(rest.slice(0, end + 1)));
    return { old: path, new: path };
  }
  const length = (rest.length - "a/ b/".length) / 2;
  if (Number.isInteger(length) && length > 0) {
    const left = rest.slice(2, 2 + length);
    if (rest.slice(2 + length, 5 + length) === " b/" && rest.slice(5 + length) === left) {
      return { old: left, new: left };
    }
  }
  const at = rest.lastIndexOf(" b/");
  if (at === -1) return { old: null, new: null };
  return { old: withoutPrefix(rest.slice(0, at)), new: rest.slice(at + 3) };
}

/** The index of the `"` that closes a C-quoted token, which a `\"` inside does not. */
function closingQuote(value: string): number {
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === "\\") {
      i += 1;
      continue;
    }
    if (value[i] === '"') return i;
  }
  return value.length - 1;
}

const ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  "\\": 0x5c,
};

/**
 * Undoes `quote_c_style`, which is what git writes a path with. The octal
 * escapes are the bytes of the name, not its characters, so they are collected
 * as bytes and decoded as UTF-8 at the end. A token that is not quoted is
 * already the path.
 */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[i + 1] ?? "";
    i += 1;
    const known = ESCAPES[next];
    if (known !== undefined) {
      bytes.push(known);
      continue;
    }
    if (next >= "0" && next <= "7") {
      bytes.push(Number.parseInt(body.slice(i, i + 3), 8));
      i += 2;
      continue;
    }
    // Not an escape git writes; keep the character rather than lose it.
    bytes.push(...Buffer.from(next, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The inverse of `ESCAPES`, for the one patch the tool writes itself. */
const QUOTED: Record<number, string> = {
  7: "\\a",
  8: "\\b",
  9: "\\t",
  10: "\\n",
  11: "\\v",
  12: "\\f",
  13: "\\r",
  34: '\\"',
  92: "\\\\",
};

/**
 * Writes a path the way git would, so that the patch built for an untracked
 * file can be read back by the same rules as a real one. Git quotes a name
 * holding a control character, a quote, a backslash, `DEL`, or any byte of a
 * non-ASCII character, and leaves every other name alone.
 */
export function quotePath(path: string): string {
  const bytes = Buffer.from(path, "utf8");
  if (!bytes.some(needsQuoting)) return path;
  let out = '"';
  for (const byte of bytes) {
    const quoted = QUOTED[byte];
    if (quoted !== undefined) out += quoted;
    else if (needsQuoting(byte)) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `${out}"`;
}

function needsQuoting(byte: number): boolean {
  return byte < 0x20 || byte === 0x22 || byte === 0x5c || byte >= 0x7f;
}

/** `a/src/x.ts` and `b/src/x.ts` carry a one-letter prefix; `/dev/null` carries none. */
function withoutPrefix(value: string): string | null {
  if (value === "/dev/null") return null;
  return value.length > 2 && value[1] === "/" ? value.slice(2) : value;
}

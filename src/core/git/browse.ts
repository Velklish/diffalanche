/** Reading a repository outside its diff: every file, and one file whole at the base or on disk.
 * Plumbing only, like the rest of the module ([02-git.md](../../../docs/reference/02-git.md)). */
import { constants, type Stats } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { FileSource } from "../domain/comments.ts";
import { byCodePoint } from "../order.ts";
import type { FileOmission, TreeEntry } from "../types.ts";
import { captureRevision } from "./anchors.ts";
import { DEFAULT_MAX_FILE_BYTES } from "./patch.ts";
import { git, gitOrNull, untrackedFiles } from "./run.ts";

/** A gitlink — a submodule — is a commit, not a file, and browsing has nothing to open in it. */
const GITLINK = "160000";

/** The files of the base revision, from its tree object: blobs only, submodules left out. */
async function baseFiles(cwd: string, sha: string): Promise<string[]> {
  const raw = await git(cwd, ["ls-tree", "-r", "-z", "--full-tree", sha]);
  const paths: string[] = [];
  for (const row of raw.split("\0")) {
    // `<mode> SP <type> SP <object> TAB <path>`, and the path is the rest of the row.
    const tab = row.indexOf("\t");
    if (tab < 0) continue;
    if (row.slice(0, tab).split(" ")[1] === "blob") paths.push(row.slice(tab + 1));
  }
  return paths;
}

/** The files on disk: what the index tracks, less what is deleted, plus what is untracked. */
async function worktreeFiles(cwd: string): Promise<string[]> {
  const [staged, deleted, untracked] = await Promise.all([
    git(cwd, ["ls-files", "-z", "-s"]),
    git(cwd, ["ls-files", "-z", "--deleted"]),
    untrackedFiles(cwd),
  ]);
  const gone = new Set(deleted.split("\0").filter(Boolean));
  const paths = new Set<string>();
  for (const row of staged.split("\0")) {
    // `<mode> SP <object> SP <stage> TAB <path>`; a conflict lists one path per stage.
    const tab = row.indexOf("\t");
    if (tab < 0 || row.startsWith(GITLINK)) continue;
    const path = row.slice(tab + 1);
    if (!gone.has(path)) paths.add(path);
  }
  for (const path of untracked) paths.add(path);
  return [...paths];
}

/** Every file of the repository, the base revision's and the working tree's merged by path. */
export async function listTree(cwd: string, sha: string | null): Promise<TreeEntry[]> {
  const [atBase, onDisk] = await Promise.all([
    sha === null ? Promise.resolve([]) : baseFiles(cwd, sha),
    worktreeFiles(cwd),
  ]);
  const entries = new Map<string, TreeEntry>();
  for (const path of atBase) entries.set(path, { path, base: true, worktree: false });
  for (const path of onDisk) {
    const known = entries.get(path);
    if (known === undefined) entries.set(path, { path, base: false, worktree: true });
    else known.worktree = true;
  }
  return [...entries.values()].sort((a, b) => byCodePoint(a.path, b.path));
}

/** A file read whole: its text, or why it is listed without it. */
type FileRead = { text: string; omitted: null } | { text: null; omitted: FileOmission };

/** What the domain anchors a line outside the change set from: a file's text on disk or at a
 * revision, `null` when there is none — the UI's server and the CLI read it the same way. */
export function fileSourceAt(root: string, dataDir?: string): FileSource {
  const source: FileSource = async (repo, path, rev) =>
    (await readFileAt(join(root, repo), path, rev))?.text ?? null;
  if (dataDir !== undefined)
    source.revision = async (input) => {
      if (!isRepositoryPath(input.repo) || !isRepositoryPath(input.path)) return null;
      const cwd = join(root, input.repo);
      return captureRevision(
        cwd,
        dataDir,
        input,
        async (path, sha) => (await readFileAt(cwd, path, { sha }))?.text ?? null,
      );
    };
  return source;
}

/** A path as the tree lists one: relative, forward slashes, no step up or aside. */
export function isRepositoryPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** One file on disk or at a revision; `null` when it is not there or is not a file the tree lists
 * ([02-git.md](../../../docs/reference/02-git.md)). */
export async function readFileAt(
  cwd: string,
  path: string,
  rev: "worktree" | { sha: string },
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<FileRead | null> {
  if (!isRepositoryPath(path)) return null;
  if (rev === "worktree") return readWorktree(cwd, path, maxBytes);
  return readObject(cwd, rev.sha, path, maxBytes);
}

async function readObject(
  cwd: string,
  sha: string,
  path: string,
  maxBytes: number,
): Promise<FileRead | null> {
  // `cat-file`, not `show`: the blob as stored, with no textconv and no filter.
  const size = await gitOrNull(cwd, ["cat-file", "-s", `${sha}:${path}`]);
  if (size === null) return null;
  if (Number(size.trim()) > maxBytes) return { text: null, omitted: "too-large" };
  const text = await gitOrNull(cwd, ["cat-file", "blob", `${sha}:${path}`]);
  if (text === null) return null;
  return text.includes("\0") ? { text: null, omitted: "binary" } : { text, omitted: null };
}

async function readWorktree(cwd: string, path: string, maxBytes: number): Promise<FileRead | null> {
  // Only a path git lists — tracked, or untracked and not ignored — so `.env` and `.git/config`
  // cannot be named and read.
  const listed = await git(cwd, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    `:(literal)${path}`,
  ]);
  if (!listed.split("\0").includes(path)) return null;
  return readListed(cwd, path, maxBytes);
}

/** A file git has already named — listed, or found by `grep` — read from disk without asking again. */
export async function readListed(
  cwd: string,
  path: string,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<FileRead | null> {
  if (!isRepositoryPath(path)) return null;
  try {
    // The named repository may itself be a link; only ancestors below that root are refused.
    const root = await realpath(cwd);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory()) return null;
    const ancestors: { path: string; info: Stats }[] = [{ path: root, info: rootInfo }];
    let parent = root;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      const info = await lstat(parent);
      if (!info.isDirectory()) return null;
      ancestors.push({ path: parent, info });
    }
    const full = join(root, path);
    const info = await lstat(full);
    const unchanged = async () => {
      for (const ancestor of ancestors) {
        const now = await lstat(ancestor.path);
        if (!now.isDirectory() || !sameFile(ancestor.info, now)) return false;
      }
      return sameFile(info, await lstat(full));
    };
    if (info.isSymbolicLink()) {
      const text = await readlink(full);
      return (await unchanged()) ? { text, omitted: null } : null;
    }
    if (!info.isFile()) return null;
    const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await file.stat();
      if (!opened.isFile() || !sameFile(info, opened) || !(await unchanged())) return null;
      if (opened.size > maxBytes) return { text: null, omitted: "too-large" };
      const content = await file.readFile();
      if (!(await unchanged())) return null;
      if (content.length > maxBytes) return { text: null, omitted: "too-large" };
      if (content.includes(0)) return { text: null, omitted: "binary" };
      return { text: content.toString("utf8"), omitted: null };
    } finally {
      await file.close();
    }
  } catch (error) {
    // A tracked file deleted from disk is still in the index; it is simply not here.
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "ELOOP", "EINVAL"].includes(String(error.code))
    )
      return null;
    throw error;
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.ctimeMs === right.ctimeMs
  );
}

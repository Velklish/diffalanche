import { join } from "node:path";
import {
  type CapturedRemoval,
  SCAN_CONCURRENCY,
  capturedRemovals,
  fileIncluded,
  filterChange,
  mapWithLimit,
  sameBase,
  sameScope,
} from "../change-set.ts";
import type { Config } from "../config/index.ts";
import { capturedAnchorPatch, mapWorktreeAnchor, reverseAnchor } from "../git/anchors.ts";
import { fileSourceAt, isRepositoryPath } from "../git/browse.ts";
import { readRepositoryChange } from "../git/index.ts";
import { repositoryDrivers, revParse } from "../git/run.ts";
import { byCodePoint } from "../order.ts";
import { globToRegExp } from "../scanner/index.ts";
import type { Anchor, Comment, DiffCache, Review, Scope } from "../storage/index.ts";
import { readComments, updateSession } from "../storage/index.ts";
import type { FileChange, RepositoryChange, ScanWarning } from "../types.ts";
import { fileLines, locateAnchor, normalizeLine } from "./anchors.ts";
import type { FileSource } from "./comments.ts";
import { commentInScope } from "./scope.ts";

type Revision = NonNullable<Anchor["revision"]>;
type Proposal = {
  id: string;
  fingerprint: string;
  next: Pick<Comment, "path" | "line" | "endLine" | "anchor" | "status" | "originalAnchor">;
};
const STALE = Symbol("stale anchor proposals");

function fingerprint(comment: Comment): string {
  const { repo, path, side, line, endLine, anchor, status, originalAnchor } = comment;
  return JSON.stringify({ repo, path, side, line, endLine, anchor, status, originalAnchor });
}

function original(comment: Comment): NonNullable<Comment["originalAnchor"]> {
  const { path, side, line, endLine, anchor } = comment;
  return comment.originalAnchor ?? { path, side, line, endLine, anchor };
}

/** Session warnings are derived from saved comments, never stored as filesystem/root warnings. */
export function commentWarnings(
  warnings: ScanWarning[],
  comments: Comment[],
  scope: Scope,
): ScanWarning[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.status !== "orphaned" || comment.repo === null || !commentInScope(scope, comment))
      continue;
    counts.set(comment.repo, (counts.get(comment.repo) ?? 0) + 1);
  }
  return [
    ...warnings.filter((warning) => !/^\d+ comments lost their anchor in /.test(warning.message)),
    ...[...counts].map(([path, count]) => ({
      path,
      message: `${count} comments lost their anchor in ${path}`,
    })),
  ].sort((a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message));
}

function sameRows(text: string, revision: Revision, body: string[]): boolean {
  const rows = fileLines(text).slice(revision.line - 1, revision.endLine);
  return (
    rows.length === body.length && rows.every((row, i) => row === normalizeLine(body[i] ?? ""))
  );
}

function agreesWithScan(file: FileChange | undefined, base: string | null, text: string): boolean {
  if (file !== undefined && (file.status === "deleted" || file.omitted !== null)) return false;
  if (file === undefined)
    return base !== null && fileLines(base).join("\n") === fileLines(text).join("\n");
  if (base === null && file.status !== "added") return false;
  const old = base === null ? [] : fileLines(base);
  const expected: string[] = [];
  let cursor = 0;
  for (const hunk of file.hunks) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+/.exec(hunk.header);
    if (match === null) return false;
    const count = Number(match[2] ?? 1);
    const start = Number(match[1]) - (count === 0 ? 0 : 1);
    expected.push(
      ...old.slice(cursor, start),
      ...hunk.lines
        .filter((line) => line.newLine !== null)
        .map((line) => line.content.replace(/\r$/, "")),
    );
    cursor = start + count;
  }
  expected.push(...old.slice(cursor));
  return expected.join("\n") === fileLines(text).join("\n");
}

/** Computes outside the writer lock; proposals recheck only the fields they are allowed to change. */
export async function reconcileAnchors(
  config: Config,
  session: string,
  review: Review,
  changes: RepositoryChange[],
  before: DiffCache | null,
  options: { source?: FileSource; repo?: string; removed?: readonly CapturedRemoval[] } = {},
): Promise<{ comments: Comment[]; changed: boolean }> {
  const source = options.source ?? fileSourceAt(config.root, config.dataDir);
  const comments = await readComments(config.dataDir, session);
  const eligible = comments.filter(
    (comment) =>
      comment.status !== "orphaned" &&
      comment.repo !== null &&
      comment.path !== null &&
      comment.line !== null &&
      comment.anchor !== null &&
      comment.side !== null &&
      commentInScope(review.scope, comment) &&
      (options.repo === undefined || comment.repo === options.repo),
  );
  const proposals: Proposal[] = [];
  const excluded = config.exclude.map(globToRegExp);
  for (const repo of new Set(eligible.map((comment) => comment.repo))) {
    if (repo === null || !isRepositoryPath(repo)) continue;
    const cwd = join(config.root, repo);
    let change = changes.find((one) => one.path === repo);
    let removed = options.removed ?? [];
    if (change === undefined) {
      const raw = await readRepositoryChange(config.root, repo, review.base, { hunks: true });
      change = filterChange(review.scope, raw, config.exclude);
      removed = [...removed, ...capturedRemovals(raw)];
    }
    const departed = new Set(removed.filter((one) => one.repo === repo).map((one) => one.path));
    const head = await revParse(cwd, "HEAD");
    if (review.base.mode === "head" && change.base !== null && head !== change.base.sha) continue;
    const previous = before?.repositories.find((one) => one.path === repo);
    const reads = new Map<string, Promise<string | null>>();
    const read = (path: string, rev: "worktree" | { sha: string }): Promise<string | null> => {
      const key = `${typeof rev === "string" ? rev : rev.sha}\0${path}`;
      let pending = reads.get(key);
      if (pending === undefined) {
        pending = source(repo, path, rev);
        reads.set(key, pending);
      }
      return pending;
    };
    const patches = new Map<string, Promise<Awaited<ReturnType<typeof capturedAnchorPatch>>>>();
    let drivers: Promise<string[] | null> | null = null;
    const mappings = new Map<string, Promise<Awaited<ReturnType<typeof reverseAnchor>>>>();
    const results = await mapWithLimit(
      eligible.filter((one) => one.repo === repo),
      SCAN_CONCURRENCY,
      async (comment): Promise<{ proposal: Proposal | null } | { error: unknown }> => {
        try {
          const { path, anchor, side, line, endLine } = comment;
          if (
            path === null ||
            anchor === null ||
            side === null ||
            line === null ||
            !isRepositoryPath(path)
          )
            return { proposal: null };
          let saved = anchor;
          let revision = anchor.revision;
          const body =
            (anchor.rangeContent ?? (endLine === null ? [anchor.lineContent] : null))?.map(
              normalizeLine,
            ) ?? null;
          if (
            revision === undefined &&
            side === "old" &&
            previous?.base !== null &&
            previous?.base !== undefined
          ) {
            const sha = previous.base.sha;
            const sourcePath = previous.files.find((one) => one.path === path)?.oldPath ?? path;
            const committed = await read(sourcePath, { sha });
            if (
              committed !== null &&
              fileLines(committed)[line - 1] === normalizeLine(anchor.lineContent)
            ) {
              const content = fileLines(committed).slice(line - 1, endLine ?? line);
              if (
                content.length === (endLine ?? line) - line + 1 &&
                (body === null || content.every((row, i) => row === body[i]))
              ) {
                saved = endLine === null ? anchor : { ...anchor, rangeContent: content };
                revision = { sha, path: sourcePath, line, endLine: endLine ?? line };
              }
            }
          }
          const targetSha = side === "old" ? (change.base?.sha ?? null) : head;
          let mapping: Awaited<ReturnType<typeof reverseAnchor>> = null;
          let sourceContent: string[] | null = null;
          if (revision !== undefined && targetSha !== null) {
            const committed = await read(revision.path, { sha: revision.sha });
            const content = (revision.content ?? saved.rangeContent ?? [saved.lineContent]).map(
              normalizeLine,
            );
            if (committed !== null && sameRows(committed, revision, content)) {
              sourceContent = content;
              const key = JSON.stringify([revision, targetSha]);
              let pending = mappings.get(key);
              if (pending === undefined) {
                pending = reverseAnchor(cwd, revision, targetSha);
                mappings.set(key, pending);
              }
              mapping = await pending;
            }
          }
          const identityPath = mapping?.path ?? path;
          if (!isRepositoryPath(identityPath)) return { proposal: null };
          const renamed =
            mapping === null ? undefined : change.files.find((one) => one.oldPath === identityPath);
          const file =
            renamed ??
            change.files.find((one) => one.path === identityPath || one.oldPath === identityPath);
          const newPath = file?.path ?? identityPath;
          const targetPath = side === "old" ? (file?.oldPath ?? identityPath) : newPath;
          const departedIdentity =
            mapping !== null && departed.has(identityPath) && renamed === undefined;
          const allowed = !departedIdentity && fileIncluded(review.scope, repo, newPath, excluded);
          const target =
            side === "new" ? "worktree" : targetSha === null ? null : { sha: targetSha };
          const text = !allowed || target === null ? null : await read(targetPath, target);
          if (side === "new" && allowed) {
            if (
              text === null &&
              file?.status !== "deleted" &&
              (file === undefined || file.omitted === null)
            ) {
              if (file !== undefined) return { proposal: null };
              const base =
                change.base === null ? null : await read(identityPath, { sha: change.base.sha });
              if (base !== null && !departed.has(targetPath)) return { proposal: null };
            }
            if (text !== null) {
              const base =
                change.base === null || file?.status === "added"
                  ? null
                  : await read(file?.oldPath ?? identityPath, { sha: change.base.sha });
              if (!agreesWithScan(file, base, text)) return { proposal: null };
            }
          }
          let mappedRows: number[] | undefined;
          if (allowed && mapping !== null && text !== null) {
            if (side === "old") mappedRows = mapping.lines;
            else if (head !== null) {
              const committed = await read(mapping.path, { sha: head });
              if (committed !== null) {
                const key = `${mapping.path}\0${newPath}`;
                let pending = patches.get(key);
                if (pending === undefined) {
                  drivers ??= repositoryDrivers(cwd);
                  pending = drivers.then((overrides) => {
                    if (overrides === null)
                      throw new Error(`repository configuration could not be read: ${repo}`);
                    return capturedAnchorPatch(
                      cwd,
                      config.dataDir,
                      mapping.path,
                      committed,
                      text,
                      overrides,
                    );
                  });
                  patches.set(key, pending);
                }
                mappedRows =
                  mapWorktreeAnchor(await pending, mapping.path, mapping.lines) ?? undefined;
              }
            }
          }
          const found =
            text === null
              ? ({ kind: "orphaned" } as const)
              : locateAnchor(
                  { anchor: saved, endLine },
                  text,
                  mappedRows === undefined || sourceContent === null
                    ? undefined
                    : { lines: mappedRows, content: sourceContent },
                );
          const next: Proposal["next"] =
            found.kind === "orphaned"
              ? {
                  path,
                  line,
                  endLine,
                  anchor,
                  status: "orphaned" as const,
                  originalAnchor: original(comment),
                }
              : {
                  path: newPath,
                  line: found.line,
                  endLine: found.endLine,
                  anchor: found.anchor,
                  status: comment.status,
                  ...(comment.originalAnchor === undefined
                    ? {}
                    : { originalAnchor: comment.originalAnchor }),
                };
          if (found.kind === "matched" && revision !== undefined) {
            next.anchor = { ...found.anchor, revision };
            if (
              sourceContent !== null &&
              found.endLine !== null &&
              JSON.stringify(found.anchor.rangeContent) !== JSON.stringify(sourceContent)
            ) {
              next.anchor.revision = { ...revision, content: sourceContent };
            }
          }

          if (
            found.kind === "matched" &&
            (newPath !== path ||
              found.line !== line ||
              found.endLine !== endLine ||
              JSON.stringify(found.anchor) !== JSON.stringify(anchor))
          )
            next.originalAnchor = original(comment);
          if (
            JSON.stringify({
              path,
              line,
              endLine,
              anchor,
              status: comment.status,
              originalAnchor: comment.originalAnchor,
            }) !== JSON.stringify(next)
          )
            return { proposal: { id: comment.id, fingerprint: fingerprint(comment), next } };
          return { proposal: null };
        } catch (error) {
          // A rejection must not leave other comments reading after this pass has returned.
          return { error };
        }
      },
    );
    for (const result of results) {
      if ("error" in result) throw result.error;
      if (result.proposal !== null) proposals.push(result.proposal);
    }
  }
  if (proposals.length === 0) return { comments, changed: false };
  try {
    return await updateSession(config.dataDir, session, (draft) => {
      if (
        !sameBase(review.base, draft.review.base) ||
        !sameScope(review.scope, draft.review.scope) ||
        review.createdAt !== draft.review.createdAt
      )
        throw STALE;
      let applied = false;
      for (const comment of draft.comments) {
        const proposal = proposals.find(
          (one) => one.id === comment.id && one.fingerprint === fingerprint(comment),
        );
        if (proposal === undefined) continue;
        if (
          proposal.next.path !== comment.path &&
          (comment.repo === null ||
            proposal.next.path === null ||
            !fileIncluded(draft.review.scope, comment.repo, proposal.next.path, excluded))
        )
          continue;
        Object.assign(comment, proposal.next);
        applied = true;
      }
      if (!applied) throw STALE;
      return { comments: draft.comments, changed: true };
    });
  } catch (error) {
    if (error !== STALE) throw error;
    return { comments: await readComments(config.dataDir, session), changed: false };
  }
}

/**
 * The scope of a review task as the screen holds it: the draft the editor and
 * select mode both pick into, the label the `SCOPE` pill prints, and the
 * sentence the confirmation asks before comments are deleted.
 *
 * The draft is a shape of its own rather than a `Scope`, because a picker has a
 * state the format has not: a repository with some of its files ticked. It
 * becomes a `Scope` once, when it is applied
 * ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
 */
import { byCodePoint } from "../core/order.ts";
import type { Scope } from "./types.ts";

/**
 * What is picked, by repository: `"all"` is the whole repository — the entry
 * the format writes without `paths` — and a list is the files picked in it. A
 * repository that is not a key is not picked at all.
 */
export type ScopeDraft = Record<string, "all" | string[]>;

/** How a repository's tick is drawn: everything, some of it, or nothing. */
export type Mark = "on" | "partial" | "off";

/** The draft a task's own scope opens the editor on. */
export function draftFromScope(scope: Scope): ScopeDraft {
  const draft: ScopeDraft = {};
  if (scope === null) return draft;
  for (const entry of scope) draft[entry.repo] = entry.paths === null ? "all" : [...entry.paths];
  return draft;
}

/**
 * The tick of a repository row. A repository whose files are all ticked one by
 * one reads as ticked whole, because that is what the reader sees; what is
 * written stays the list they built.
 */
export function repoMark(draft: ScopeDraft, repo: string, files: string[]): Mark {
  const picked = draft[repo];
  if (picked === undefined) return "off";
  if (picked === "all") return "on";
  if (files.length > 0 && files.every((file) => picked.includes(file))) return "on";
  return "partial";
}

export function pathPicked(draft: ScopeDraft, repo: string, path: string): boolean {
  const picked = draft[repo];
  if (picked === undefined) return false;
  return picked === "all" || picked.includes(path);
}

/**
 * The repository tick: everything of it, or nothing. Half of it is what the
 * file ticks make, and pressing the repository is how a reader says "all of
 * this" or "none of this" in one gesture.
 */
export function toggleRepo(draft: ScopeDraft, repo: string, files: string[]): ScopeDraft {
  const next = { ...draft };
  if (repoMark(draft, repo, files) === "on") delete next[repo];
  else next[repo] = "all";
  return next;
}

/**
 * One file. A repository that was picked whole becomes the list of its files
 * without this one: "everything but that" is not an entry the format has, so
 * the entry says what it keeps ([04-domain.md](../../docs/reference/04-domain.md)).
 */
export function togglePath(
  draft: ScopeDraft,
  repo: string,
  path: string,
  files: string[],
): ScopeDraft {
  const next = { ...draft };
  const picked = draft[repo];
  if (picked === undefined) {
    next[repo] = [path];
    return next;
  }
  const kept =
    picked === "all"
      ? files.filter((file) => file !== path)
      : picked.includes(path)
        ? picked.filter((file) => file !== path)
        : [...picked, path];
  // A repository with nothing left in it is a repository that is not picked:
  // an entry with an empty list of paths is refused by the format.
  if (kept.length === 0) delete next[repo];
  else next[repo] = kept;
  return next;
}

/**
 * The draft as the scope that is written. The entries and their paths are
 * sorted by code point, so the same picks produce the same `review.json`
 * whatever order they were made in.
 */
export function draftToScope(draft: ScopeDraft): Scope {
  const entries = Object.keys(draft)
    .sort(byCodePoint)
    .map((repo) => {
      const picked = draft[repo];
      return {
        repo,
        paths: picked === undefined || picked === "all" ? null : [...picked].sort(byCodePoint),
      };
    });
  return entries.length === 0 ? null : entries;
}

/** Whether anything is picked at all; an empty scope is not a state a task has. */
export function isEmptyDraft(draft: ScopeDraft): boolean {
  return Object.keys(draft).length === 0;
}

/**
 * What a scope is about, counted as it is written: an entry is a repository,
 * and the paths an entry names are its files. A repository the task holds whole
 * names no files and counts none — the task is about the repository, not about
 * a list inside it — which is also why the number never disagrees with the
 * editor when a file of the scope has stopped changing (ADR-010, decision 5).
 */
export function countScope(scope: Scope): { repos: number; files: number } {
  if (scope === null) return { repos: 0, files: 0 };
  return {
    repos: scope.length,
    files: scope.reduce((sum, entry) => sum + (entry.paths?.length ?? 0), 0),
  };
}

/** The same, over a draft that has not been applied. */
export function countDraft(draft: ScopeDraft): { repos: number; files: number } {
  return countScope(draftToScope(draft));
}

/** What the `SCOPE` pill and the editor's footer print: `2 repos · 5 files`. */
export function scopeLabel(counted: { repos: number; files: number }): string {
  const repos = `${counted.repos} ${counted.repos === 1 ? "repo" : "repos"}`;
  if (counted.files === 0) return repos;
  return `${repos} · ${counted.files} ${counted.files === 1 ? "file" : "files"}`;
}

/**
 * What a scope edit takes out of the task, by name: a repository the new scope
 * has not, and a path its entry no longer names. A repository that was held
 * whole and now names paths is named as the repository — the entry it had could
 * not say which files it covered, and the files it drops are everything it did
 * not name.
 */
export function removedFrom(before: Scope, after: Scope): string[] {
  if (before === null) return [];
  const gone: string[] = [];
  for (const entry of before) {
    const next = after === null ? undefined : after.find((one) => one.repo === entry.repo);
    if (next === undefined) {
      gone.push(entry.repo);
      continue;
    }
    if (entry.paths === null) {
      if (next.paths !== null) gone.push(entry.repo);
      continue;
    }
    if (next.paths === null) continue;
    for (const path of entry.paths) {
      if (!next.paths.includes(path)) gone.push(`${entry.repo}/${path}`);
    }
  }
  return gone;
}

/** How many of the names a confirmation spells out before it counts the rest. */
const NAMED = 2;

/**
 * The one question this product asks before it destroys review data: what is
 * being taken out of the task, how many comments hang under it, and how many of
 * those are still open. Nothing is written until it is answered
 * ([ADR-010](../../docs/adr/adr-010-review-task-scope.md), decision 6).
 */
export function confirmQuestion(removed: string[], count: number, open: number): string {
  const named = removed.slice(0, NAMED).join(", ");
  const rest = removed.length - Math.min(removed.length, NAMED);
  const what =
    removed.length === 0 ? "запись состава" : rest === 0 ? named : `${named} и ещё ${rest}`;
  const comments = `${count} ${plural(count, "комментарий", "комментария", "комментариев")}`;
  return `Убрать ${what} и удалить ${comments} (${open} ${plural(open, "открыт", "открыто", "открыто")})?`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const hundred = n % 100;
  if (hundred >= 11 && hundred <= 14) return many;
  const ten = n % 10;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

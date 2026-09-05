/**
 * The base of a review session in the two forms the screen needs: the argument
 * the domain's own parser takes — `head`, `branch`, `branch:<name>`, or a ref
 * (`docs/SPEC.md` section 8) — and the short label the header and the menu
 * print. The grammar is the CLI's, so one base is written one way everywhere.
 */
import type { Base, BaseMode } from "./types.ts";

/** The base written back as the argument that produces it; `null` when it is not one. */
export function baseArgument(mode: BaseMode, branch: string, ref: string): string | null {
  if (mode === "head") return "head";
  if (mode === "branch") return branch.trim() === "" ? "branch" : `branch:${branch.trim()}`;
  return ref.trim() === "" ? null : ref.trim();
}

/** The same, from a base the server sent. */
export function formatBase(base: Base): string {
  if (base.mode === "head") return "head";
  if (base.mode === "ref") return base.ref;
  return base.branch === undefined ? "branch" : `branch:${base.branch}`;
}

/** What the header's `BASE` pill shows: the name, not the grammar. */
export function baseLabel(base: Base | undefined): string {
  if (!base) return "—";
  if (base.mode === "head") return "HEAD";
  if (base.mode === "ref") return base.ref;
  return base.branch ?? "default branch";
}

/** The line the status bar carries: what this review is being read against. */
export function baseSummary(base: Base | undefined): string {
  if (!base) return "no base";
  if (base.mode === "head") return "working tree ↔ HEAD";
  if (base.mode === "ref") return `working tree ↔ ${base.ref}`;
  return `merge-base ↔ ${base.branch ?? "default branch"}`;
}

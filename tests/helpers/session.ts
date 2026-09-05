/** Builds a review session on disk for the storage tests. */
import type { Comment, Review } from "../../src/core/storage/index.ts";
import { writeComments, writeReview } from "../../src/core/storage/index.ts";

export function review(name: string, overrides: Partial<Review> = {}): Review {
  return {
    version: 1,
    name,
    title: null,
    base: { mode: "head" },
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

export function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    repo: "repos/core/cargos-api",
    path: "src/a.ts",
    side: "new",
    line: 42,
    endLine: null,
    anchor: { lineContent: "const a = 1;", hunk: "@@ -1,3 +1,3 @@", before: [], after: [] },
    severity: "warning",
    status: "open",
    author: "kim.p",
    role: "human",
    body: "a finding",
    createdAt: "2026-09-01T09:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...overrides,
  };
}

export async function makeSession(
  dataDir: string,
  name: string,
  comments: Comment[] = [],
): Promise<void> {
  await writeReview(dataDir, name, review(name));
  await writeComments(dataDir, name, comments);
}

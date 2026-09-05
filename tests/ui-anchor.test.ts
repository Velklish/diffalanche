import { describe, expect, it } from "vitest";
import { anchorLabel } from "../src/core/domain/export.ts";
import type { Comment } from "../src/core/storage/types.ts";
import { composerLabel, exportAnchor, firstAddedLine } from "../src/ui/anchor.ts";

/**
 * Where the composer opens and what it says it is anchored to. Both are read
 * off the patch and the nulls of `docs/SPEC.md` section 7, so they are checked
 * without a browser.
 */

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -30,6 +38,8 @@ function f()",
  " context one",
  " context two",
  "-gone",
  " context three",
  "+added here",
  "+and here",
  " context four",
].join("\n");

describe("firstAddedLine", () => {
  it("counts to the first line the patch adds, past the context before it", () => {
    // 38 context, 39 context, the deletion is not on the new side, 40 context,
    // so the first `+` is line 41.
    expect(firstAddedLine(PATCH)).toBe(41);
  });

  it("is the first line of the hunk when the patch adds nothing", () => {
    const removal = ["@@ -30,3 +38,2 @@", "-gone", " kept"].join("\n");
    expect(firstAddedLine(removal)).toBe(38);
  });

  it("takes the added line of the second hunk when the first only removes", () => {
    const patch = [
      "@@ -1,2 +1,1 @@",
      "-gone",
      " kept",
      "@@ -20,2 +19,3 @@",
      " kept too",
      "+new",
    ].join("\n");
    expect(firstAddedLine(patch)).toBe(20);
  });

  it("is the first line when there is no hunk at all", () => {
    expect(firstAddedLine("")).toBe(1);
  });
});

describe("composerLabel", () => {
  it("names the side, the file, the range, and how many lines it holds", () => {
    const target = { repo: "repos/a", path: "src/a.ts", side: "new" as const, line: 41 };
    expect(composerLabel(target, 43)).toBe("→ new side · src/a.ts L41–43 · 3 lines");
  });

  it("says one line for a single line, and drops the range", () => {
    const target = { repo: "repos/a", path: "src/a.ts", side: "new" as const, line: 41 };
    expect(composerLabel(target, null)).toBe("→ new side · src/a.ts L41 · 1 line");
  });

  it("reads the anchor level off the nulls", () => {
    expect(composerLabel({ repo: "repos/a", path: "src/a.ts", side: null, line: null }, null)).toBe(
      "→ src/a.ts · file",
    );
    expect(composerLabel({ repo: "repos/a", path: null, side: null, line: null }, null)).toBe(
      "→ repos/a · repository",
    );
    expect(composerLabel({ repo: null, path: null, side: null, line: null }, null)).toBe(
      "→ review",
    );
  });
});

describe("the anchor the export writes", () => {
  /** Every level of `docs/SPEC.md` section 7, from the whole review to a range. */
  const levels: Partial<Comment>[] = [
    { repo: null, path: null, line: null, endLine: null },
    { repo: "repos/a", path: null, line: null, endLine: null },
    { repo: "repos/a", path: "src/a.ts", line: null, endLine: null },
    { repo: "repos/a", path: "src/a.ts", line: 41, endLine: null },
    { repo: "repos/a", path: "src/a.ts", line: 41, endLine: 43 },
  ];

  it("is the domain's own label, which the UI cannot import", () => {
    // `src/core/domain/export.ts` reaches the storage barrel and the barrel
    // reaches the Node API; the UI compiles with `"types": []`. This is what
    // keeps the copy in `src/ui/anchor.ts` the same text.
    for (const level of levels) {
      const comment = { ...level } as Comment;
      expect(exportAnchor(comment)).toBe(anchorLabel(comment));
    }
  });
});

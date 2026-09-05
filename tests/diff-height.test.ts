import { describe, expect, it } from "vitest";
import { HUNK_HEAD_HEIGHT, hiddenLines, measurePatch, ROW_HEIGHT } from "../src/ui/measure.ts";

/**
 * The height a file card claims before its diff is mounted. It is arithmetic
 * over the patch, and the scrollbar drifts if it is wrong
 * ([ADR-008](../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "-const c = 3;",
  "+const b = 22;",
  " const d = 4;",
  "@@ -20,2 +21,3 @@",
  " const e = 5;",
  "+const f = 6;",
  "",
].join("\n");

describe("the height of a file card", () => {
  it("pairs a deletion with the insertion beside it in split view", () => {
    // Two hunk headers; hunk one: context, max(2 deletions, 1 insertion), context;
    // hunk two: context, one insertion.
    const { height } = measurePatch(patch, "split");

    expect(height).toBe(2 * HUNK_HEAD_HEIGHT + 6 * ROW_HEIGHT);
  });

  it("counts a deletion and an insertion as two rows in unified view", () => {
    const { height } = measurePatch(patch, "unified");

    expect(height).toBe(2 * HUNK_HEAD_HEIGHT + 7 * ROW_HEIGHT);
  });

  it("measures the widest line without its diff marker", () => {
    const { width } = measurePatch(patch, "split");

    expect(width).toBe("const b = 22;".length);
  });

  it("ignores the header git prints before the first hunk", () => {
    const headerOnly = patch.slice(0, patch.indexOf("@@"));

    expect(measurePatch(headerOnly, "split")).toEqual({ height: 0, width: 0 });
  });

  it("gives a file listed without content no height at all", () => {
    expect(measurePatch("", "split")).toEqual({ height: 0, width: 0 });
  });
});

/**
 * Which new-side lines a collapsed hunk takes away. The renderer trims the
 * context that leads and trails a hunk's changes, and a thread anchored to one
 * of those lines has no row to sit under while the hunk is collapsed (DA-23).
 */
describe("the lines a collapsed hunk hides", () => {
  it("hides the context before and after the changes, and nothing else", () => {
    // The first hunk starts at new line 1: context 1, two deletions, insertion
    // 2, context 3. The insertion is the only change, so 1 leads it and 3
    // trails it; the insertion itself stays.
    const hidden = hiddenLines(patch, { 0: true });

    expect([...hidden].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("leaves a hunk nobody collapsed alone", () => {
    expect(hiddenLines(patch, { 1: true }).has(1)).toBe(false);
    expect(hiddenLines(patch, {}).size).toBe(0);
  });

  it("hides all of a hunk that has no change to keep, as the renderer trims it", () => {
    const context = ["@@ -1,2 +1,2 @@", " one", " two"].join("\n");

    expect([...hiddenLines(context, { 0: true })]).toEqual([1, 2]);
  });
});

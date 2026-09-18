import { describe, expect, it } from "vitest";
import {
  centreWidth,
  codeColumnChars,
  HUNK_HEAD_HEIGHT,
  hiddenLines,
  MIN_CENTRE,
  measurePatch,
  RAIL_WIDTH,
  ROW_HEIGHT,
  SIDEBAR_WIDTH,
} from "../src/ui/measure.ts";

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

/** With wrapping on, a line longer than its code column is several rows tall,
 * and the estimate says so before the card is ever mounted (DA-107). */
const long = [
  "@@ -1,2 +1,3 @@",
  ` ${"c".repeat(40)}`,
  `-${"d".repeat(10)}`,
  `+${"i".repeat(100)}`,
  "",
].join("\n");

describe("the height of a file card with the lines wrapped", () => {
  it("counts a wrapped line as the rows it really takes", () => {
    // Context 40 / 20 → 2 rows; the block pairs a 10-character deletion (1 row)
    // with a 100-character insertion (5 rows) and the taller one is the row.
    const { height } = measurePatch(long, "split", 20);

    expect(height).toBe(HUNK_HEAD_HEIGHT + 7 * ROW_HEIGHT);
  });

  it("gives each side its own rows in unified view", () => {
    const { height } = measurePatch(long, "unified", 20);

    expect(height).toBe(HUNK_HEAD_HEIGHT + (2 + 1 + 5) * ROW_HEIGHT);
  });

  it("is the unwrapped count when no column width is given", () => {
    expect(measurePatch(long, "split")).toEqual(measurePatch(long, "split", null));
    expect(measurePatch(long, "split").height).toBe(HUNK_HEAD_HEIGHT + 2 * ROW_HEIGHT);
  });

  it("keeps a line that fits its column one row", () => {
    expect(measurePatch(long, "split", 100).height).toBe(HUNK_HEAD_HEIGHT + 2 * ROW_HEIGHT);
  });
});

/** The width the count is made against: the page less the panels on the screen,
 * less the gutters and the padding `styles.css` fixes. */
describe("the width a wrapped line is counted against", () => {
  it("is the page less the panels that are on the screen", () => {
    expect(centreWidth(1560, true, true)).toBe(MIN_CENTRE);
    expect(centreWidth(1560, false, true)).toBe(1560 - RAIL_WIDTH);
    expect(centreWidth(1560, true, false)).toBe(1560 - SIDEBAR_WIDTH);
    expect(centreWidth(1560, false, false)).toBe(1560);
  });

  it("never goes below the reading column the floor of `.app` is built on", () => {
    expect(centreWidth(900, true, true)).toBe(MIN_CENTRE);
    expect(centreWidth(400, false, false)).toBe(MIN_CENTRE);
  });

  it("gives a split column about half of what a unified one has", () => {
    const centre = centreWidth(1560, true, true);
    const split = codeColumnChars("split", "modified", centre);
    const unified = codeColumnChars("unified", "modified", centre);

    // A unified row pays for one code cell instead of two, so it keeps the
    // 20 px of padding the second one would have taken and nothing else.
    expect(split).toBeGreaterThan(0);
    expect(unified).toBeGreaterThan(split * 2);
    expect(unified).toBeLessThanOrEqual(split * 2 + 4);
  });

  it("gives an added or deleted file one column and one gutter in split view", () => {
    const centre = centreWidth(1560, true, true);
    const modified = codeColumnChars("split", "modified", centre);
    const added = codeColumnChars("split", "added", centre);

    // The library has one side to show, so it draws one of each; a whole gutter
    // wider than the unified row of the same card.
    expect(added).toBeGreaterThan(modified * 2);
    expect(added).toBe(codeColumnChars("unified", "modified", centre) + Math.floor(42 / 7.2) + 1);
    expect(codeColumnChars("split", "deleted", centre)).toBe(added);
  });

  it("grows when a panel is taken off the screen", () => {
    const both = codeColumnChars("split", "modified", centreWidth(1900, true, true));
    const alone = codeColumnChars("split", "modified", centreWidth(1900, false, false));

    expect(alone - both).toBe(Math.floor((SIDEBAR_WIDTH + RAIL_WIDTH) / 2 / 7.2));
  });

  it("holds at least one character however narrow the column is", () => {
    expect(codeColumnChars("split", "modified", 0)).toBe(1);
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

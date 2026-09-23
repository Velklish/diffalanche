/** `↑ N lines` (DA-37): the gaps above each hunk, the lines put in, and the height they take. */
import type { HunkData } from "react-diff-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_STEP,
  gapsAbove,
  linesAbove,
  newSideLines,
  splitLines,
  withLinesAbove,
} from "../src/ui/context.ts";
import { measureLines, ROW_HEIGHT } from "../src/ui/measure.ts";
import { mergedPatch } from "../src/ui/patch.ts";
import { useStore } from "../src/ui/store.ts";

/** Line `n` of the working tree says `line n`. */
const FILE = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`);

/** Two hunks: one whose context starts at line 30, and one at 50, one line put in above 52. */
const PATCH = [
  "diff --git a/f.ts b/f.ts",
  "--- a/f.ts",
  "+++ b/f.ts",
  "@@ -30,7 +30,7 @@",
  " line 30",
  " line 31",
  " line 32",
  "-old 33",
  "+line 33",
  " line 34",
  " line 35",
  " line 36",
  "@@ -50,6 +50,7 @@",
  " line 50",
  " line 51",
  "+line 52",
  " line 53",
  " line 54",
  " line 55",
  " line 56",
].join("\n");

function hunks(): HunkData[] {
  return mergedPatch(PATCH, "modified")?.hunks ?? [];
}

describe("the context above a hunk", () => {
  it("counts the lines no hunk shows between each hunk and the one above", () => {
    // 29 lines before the first hunk; 37..49 between the two.
    expect(gapsAbove(hunks())).toEqual([29, 13]);
  });

  it("puts the working tree's lines above a hunk, numbered on both sides, header kept", () => {
    const [first] = hunks();
    if (first === undefined) throw new Error("no hunk");
    const grown = withLinesAbove(first, FILE, CONTEXT_STEP);
    expect(grown.content).toBe(first.content);
    expect(grown.newStart).toBe(10);
    expect(grown.oldStart).toBe(10);
    expect(grown.newLines).toBe(first.newLines + 20);
    const top = grown.changes.slice(0, 20);
    expect(top.map((change) => change.content)).toEqual(FILE.slice(9, 29));
    expect(top[0]).toMatchObject({ type: "normal", oldLineNumber: 10, newLineNumber: 10 });
    expect(grown.changes.slice(20)).toEqual(first.changes);
  });

  it("numbers the old side of the second hunk past what the first put in", () => {
    const second = hunks()[1];
    if (second === undefined) throw new Error("no hunk");
    const grown = withLinesAbove(second, FILE, 3);
    expect(grown.changes.slice(0, 3).map((change) => change.content)).toEqual([
      "line 47",
      "line 48",
      "line 49",
    ]);
    expect(grown.changes[0]).toMatchObject({ oldLineNumber: 47, newLineNumber: 47 });
  });

  it("leaves a hunk alone when nothing is asked for", () => {
    const [first] = hunks();
    if (first === undefined) throw new Error("no hunk");
    expect(withLinesAbove(first, FILE, 0)).toBe(first);
  });

  it("names the new-side lines a patch shows and where its hunks start", () => {
    const { lines, starts } = newSideLines(PATCH);
    expect(starts).toEqual([30, 50]);
    expect(lines.has(33)).toBe(true);
    expect(lines.has(37)).toBe(false);
    expect([...lines]).toHaveLength(14);
    expect(linesAbove(starts, { 1: 3 })).toEqual(new Map([[1, [47, 48, 49]]]));
  });

  it("measures the rows the lines take, wrapped or not", () => {
    expect(measureLines(["a", "bbbbbbbbbb"], null)).toEqual({ height: 2 * ROW_HEIGHT, width: 10 });
    expect(measureLines(["a", "bbbbbbbbbb"], 4)).toEqual({ height: 4 * ROW_HEIGHT, width: 10 });
  });

  it("splits a file into the lines the diff numbers", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("pressing `↑ N lines`", () => {
  const file = {
    path: "f.ts",
    oldPath: null,
    status: "modified" as const,
    additions: 1,
    deletions: 1,
    patch: PATCH,
    hunks: [],
    omitted: null,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    useStore.setState({ context: {} });
  });

  it("reads the file once for two presses while it is on its way, and never past the gap", async () => {
    const text = `${FILE.join("\n")}\n`;
    const answer = { repo: "r", path: "f.ts", rev: "worktree", sha: null, text, omitted: null };
    const fetching = vi.fn(async () => new Response(JSON.stringify(answer)));
    vi.stubGlobal("fetch", fetching);
    const expand = useStore.getState().expandAbove;

    // The second press lands before the first one's file has arrived.
    await Promise.all([
      expand("r/f.ts", "r", file, 1, 20, 13),
      expand("r/f.ts", "r", file, 1, 20, 13),
    ]);
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(useStore.getState().context["r/f.ts"]?.above).toEqual({ 1: 13 });

    // With the lines held, a further press adds nothing past the 13 lines between the hunks.
    await expand("r/f.ts", "r", file, 1, 20, 13);
    expect(useStore.getState().context["r/f.ts"]?.above).toEqual({ 1: 13 });
    expect(fetching).toHaveBeenCalledTimes(1);
  });
});

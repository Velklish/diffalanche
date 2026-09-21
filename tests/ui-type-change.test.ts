/**
 * What the UI's patch readers do with the two patches of a type change
 * ([02-git.md](../docs/reference/02-git.md)).
 */
import { parseDiff } from "react-diff-view";
import { describe, expect, it } from "vitest";
import { firstAddedLine } from "../src/ui/anchor.ts";
import { hiddenLines, measurePatch } from "../src/ui/measure.ts";
import { hasNewLine, mergedPatch, splitHunks } from "../src/ui/patch.ts";
import { preview } from "../src/ui/search.ts";

/** The deletion half: `thing.txt` as it was, four lines of it. */
const DELETED = [
  "diff --git a/thing.txt b/thing.txt",
  "deleted file mode 100644",
  "index 1062290..0000000",
  "--- a/thing.txt",
  "+++ /dev/null",
  "@@ -1,4 +0,0 @@",
  "-one",
  "-two",
  "-three",
  "-four",
  "",
].join("\n");

/** The addition half: the link that took its place. */
const ADDED = [
  "diff --git a/thing.txt b/thing.txt",
  "new file mode 120000",
  "index 0000000..555dec9",
  "--- /dev/null",
  "+++ b/thing.txt",
  "@@ -0,0 +1 @@",
  "+/etc/hosts",
  "",
].join("\n");

/** What `parseDiff` now puts in one entry: the two, in the order git wrote them. */
const BOTH = DELETED + ADDED;

/** Two patches for one path with context, which a type change never has. */
const WITH_CONTEXT = [
  "diff --git a/x.ts b/x.ts",
  "index 1111111..2222222 100644",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,5 +1,5 @@",
  " one",
  " two",
  "-three",
  "+THREE",
  " four",
  " five",
  "diff --git a/x.ts b/x.ts",
  "index 2222222..3333333 100644",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -20,5 +20,5 @@",
  " aa",
  " bb",
  "-cc",
  "+CC",
  " dd",
  " ee",
  "",
].join("\n");

describe("a patch carrying both halves of a type change", () => {
  it("is measured as the two halves together and not as more", () => {
    const whole = measurePatch(BOTH, "unified");
    const halves = measurePatch(DELETED, "unified");
    const rest = measurePatch(ADDED, "unified");
    // The arithmetic a card claims its height with ([ADR-008](../docs/adr/adr-008-diff-rendering-verdict.md)).
    expect(whole.height).toBe(halves.height + rest.height);
  });

  it("gives the card every hunk of the entry, under one `modify`", () => {
    // What the card mounts: the first parsed file alone would drop the link.
    expect(parseDiff(BOTH, { nearbySequences: "zip" })).toHaveLength(2);
    const merged = mergedPatch(BOTH);
    expect(merged?.hunks).toHaveLength(2);
    expect(merged?.type).toBe("modify");
  });

  it("leaves an ordinary one-patch entry exactly as the parser gave it", () => {
    expect(mergedPatch(ADDED)).toEqual(parseDiff(ADDED, { nearbySequences: "zip" })[0]);
    // An empty patch parses to one file, not none: a one-patch entry like any
    // other, and the merge must leave it exactly as it was.
    expect(mergedPatch("")).toEqual(parseDiff("", { nearbySequences: "zip" })[0] ?? null);
  });

  it("splits into the hunks git wrote, with no file header inside one", () => {
    const hunks = splitHunks(BOTH);
    expect(hunks.map((one) => one.header)).toEqual(["@@ -1,4 +0,0 @@", "@@ -0,0 +1 @@"]);
    for (const hunk of hunks) expect(hunk.body).not.toContain("diff --git");
  });

  it("finds the first added line in the addition, not in a `+++` header", () => {
    expect(firstAddedLine(BOTH)).toBe(1);
  });

  it("does not count the next patch's `+++` header as a line of the file", () => {
    // Hunk 0 covers new-side lines 1..5; read as content, `+++ b/x.ts` is a sixth.
    expect(hasNewLine(WITH_CONTEXT, 5)).toBe(true);
    expect(hasNewLine(WITH_CONTEXT, 6)).toBe(false);
    expect(hasNewLine(WITH_CONTEXT, 20)).toBe(true);
    expect(hasNewLine(BOTH, 1)).toBe(true);
  });

  it("previews the deletions and the link, and no header line", () => {
    const rows = preview(BOTH, 1);
    expect(rows.map((one) => one.text)).toEqual(["one", "two", "three", "four", "/etc/hosts"]);
    expect(rows.filter((one) => one.kind === "add").map((one) => one.line)).toEqual([1]);
  });

  it("hides the context of a collapsed hunk without the next patch's header eating it", () => {
    // `trimContext` keeps first change to last, so 1, 2 and 4, 5 go; reading
    // `--- a/x.ts` below as a deletion is what used to wipe the trailing pair.
    expect(hiddenLines(WITH_CONTEXT, { 0: true })).toEqual(new Set([1, 2, 4, 5]));
    // The index keeps counting across the patches, as `collapsed` is keyed.
    expect(hiddenLines(WITH_CONTEXT, { 1: true })).toEqual(new Set([20, 21, 23, 24]));
  });

  it("hides nothing in a type change, which has no context to hide", () => {
    // The precondition: an answer from a patch nothing parsed looks the same.
    expect(splitHunks(BOTH)).toHaveLength(2);
    // One side of each patch is `/dev/null`, so there is no context to trim:
    // the value is empty for a reason, not by accident.
    expect(hiddenLines(BOTH, { 0: true, 1: true })).toEqual(new Set());
  });
});

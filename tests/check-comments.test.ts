import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blocks, overLimit } from "../scripts/check-comments.ts";

const lines = (text: string, kind: "slash" | "hash" = "slash") =>
  blocks(text, kind).map((block) => block.lines);

describe("the comment gate of ADR-011", () => {
  it("counts a run of line comments, a block comment and a JSX comment by their lines", () => {
    expect(lines("// a\n// b\n// c\nconst x = 1;\n// d\n")).toEqual([3, 1]);
    expect(lines("/**\n * a\n */\nfunction f() {}\n/** one */\n")).toEqual([3, 1]);
    expect(lines("<div>\n  {/* a\n      b */}\n</div>\n")).toEqual([2]);
  });

  it("counts `#` runs in YAML and shell, and not a shebang", () => {
    expect(lines("#!/bin/sh\n# a\n# b\necho\n# c\n# d\n# e\n", "hash")).toEqual([2, 3]);
  });

  it("ends a run at the first line that is not a comment, a blank one included", () => {
    expect(lines("// a\n// b\n\n// c\n// d\n")).toEqual([2, 2]);
  });

  it("names every block over two lines under the paths it is given, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-comments-"));
    writeFileSync(join(root, "ok.ts"), "// one\n// two\nexport const a = 1;\n");
    writeFileSync(join(root, "long.ts"), "export const a = 1;\n/**\n * why\n */\n");
    writeFileSync(join(root, "notes.md"), "# a\n# b\n# c\n");
    expect(overLimit(["."], root)).toEqual([{ file: "long.ts", line: 2, lines: 3 }]);
  });
});

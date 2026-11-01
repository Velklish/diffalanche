import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blocks, overLimit, ROOTS } from "../scripts/check-comments.ts";

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

  it("ignores source-looking template data but counts real comments inside interpolation", () => {
    expect(
      blocks("const text = `\n// data a\n// data b\n// data c\n/* data */\n`;", "slash"),
    ).toEqual([]);
    expect(blocks(`const text = \`data \${ /* why\nmore\nend */ 1 } tail\`;`, "slash")).toEqual([
      { line: 1, lines: 3 },
    ]);
  });

  it("counts inline multiline comments and adjacent trailing line comments", () => {
    expect(blocks("const answer = 42; /* why\nmore\nend */\n", "slash")).toEqual([
      { line: 1, lines: 3 },
    ]);
    expect(
      blocks("a(); // first\n// second\n// third\nb(); // fourth\nc(); // fifth", "slash"),
    ).toEqual([
      { line: 1, lines: 3 },
      { line: 4, lines: 1 },
      { line: 5, lines: 1 },
    ]);
  });

  it("distinguishes TS strings, regular expressions, division and template interpolation", () => {
    const source = [
      'const escaped = "\\" /* data */";',
      "const regexp = /[/*]+https?:\\/\\//;",
      "if (ok) /[/*]/.test(value);",
      'const text = "start\\',
      "// data\\",
      "// data\\",
      '// data";',
      `const nested = \`outer \${ \`inner \${ 1 /* real */ }\` }\`;`,
      "const ratio = 4 / 2; /* actual",
      "second",
      "third */",
    ].join("\n");
    expect(blocks(source, "ts")).toEqual([
      { line: 8, lines: 1 },
      { line: 9, lines: 3 },
    ]);
  });

  it("treats JSX children and attribute values as data while visiting expression comments", () => {
    const source = `<div title="/* data\n// data\n// data */">\n// text\n/* text */\n{/* real\nsecond\nthird */}\n{\`// data \${1 /* inline */}\`}\n</div>`;
    expect(blocks(source, "tsx")).toEqual([
      { line: 6, lines: 3 },
      { line: 9, lines: 1 },
    ]);
    expect(blocks("const id = <T>(value: T) => value; /* real\nsecond\nthird */", "ts")).toEqual([
      { line: 1, lines: 3 },
    ]);
  });

  it("uses CSS comments without interpreting strings or URL data as slash comments", () => {
    const source =
      'a { content: "/* text */"; background: url(https://example.test/image); }\n// this is not a CSS comment\na { color: red; /* real\nsecond\nthird */ }';
    expect(blocks(source, "css")).toEqual([{ line: 3, lines: 3 }]);
  });

  it("preserves CSS escaped newline strings", () => {
    expect(blocks('a { content: "start\\\n/* data\\\nmore\\\nend */"; }', "css")).toEqual([]);
  });

  it("counts CSS comments after quoted URL arguments while preserving URL data", () => {
    expect(blocks('a { background: url("image.png" /* first\nsecond\nthird */); }', "css")).toEqual(
      [{ line: 1, lines: 3 }],
    );
    expect(
      blocks("a { background: url(  'image.png' /* first\nsecond\nthird */); }", "css"),
    ).toEqual([{ line: 1, lines: 3 }]);
    expect(blocks("a { background: url(image/*data\nmore\nend*/.png); }", "css")).toEqual([]);
    expect(blocks('a { background: url("image/*data*/.png"); }', "css")).toEqual([]);
  });

  it("keeps embedded YAML block scalar indicators inside plain scalar data", () => {
    expect(blocks("value: something - |\n  # first\n  # second\n  # third\n", "yaml")).toEqual([
      { line: 2, lines: 3 },
    ]);
  });

  it("recognizes indented standalone YAML block scalar headers", () => {
    expect(blocks("value:\n  |\n    # data a\n    # data b\n    # data c\n", "yaml")).toEqual([]);
    expect(blocks("value:\n  >2-\n    # data a\n    # data b\n    # data c\n", "yaml")).toEqual([]);
  });

  it("preserves YAML plain scalar continuation inside flow collections", () => {
    expect(
      blocks('list: [plain\n  "still plain # first\n  # second\n  # third\n]\n', "yaml"),
    ).toEqual([{ line: 2, lines: 3 }]);
    expect(blocks('list: [plain,\n  "data\n  # data\n  # data\n  # data"]\n', "yaml")).toEqual([]);
    expect(blocks('list: [\n  "data\n  # data\n  # data\n  # data"]\n', "yaml")).toEqual([]);
  });

  it("keeps YAML quoted scalars, block scalars and unseparated hashes out of comments", () => {
    const source = [
      'double: "start',
      "# data",
      "# data",
      '# data"',
      "single: 'it''s",
      "# data",
      "# data",
      "# data'",
      "literal: |+",
      "  # data",
      "",
      "  # data",
      "  # data",
      "folded: >-",
      "  # data",
      "  # data",
      "  # data",
      "explicit: |2-",
      "  # data",
      "  # data",
      "  # data",
      "url: https://example.test/#fragment",
      "plain: it's data#value",
      "value: ok # real",
      "# second",
      "# third",
    ].join("\n");
    expect(blocks(source, "yaml")).toEqual([{ line: 24, lines: 3 }]);
  });

  it("recognizes comments after YAML flow values and quoted scalar endings", () => {
    expect(
      blocks("list: [\"# data\", '# data'] # first\n# second\n# third\nnext: true", "yaml"),
    ).toEqual([{ line: 1, lines: 3 }]);
    expect(blocks("scalar: | # first\n  # data\n  # data\n  # data\n# second", "yaml")).toEqual([
      { line: 1, lines: 1 },
      { line: 5, lines: 1 },
    ]);
    expect(blocks('plain: say "hello # first\n# second\n# third', "yaml")).toEqual([
      { line: 1, lines: 3 },
    ]);
    expect(blocks('quoted: &name "start\n# data\n# data\n# data"\n# real', "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks("- |2\n  # data\n  # data\n  # data\n# real", "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks("- key: |2\n    # data\n    # data\n    # data\n# real", "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks('--- "data\n# data\n# data\n# data"\n# real', "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks('{"key":"data\n# data\n# data\n# data"}\n# real', "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks("- |\n  # data\n  # data\n  # data\n# real", "yaml")).toEqual([
      { line: 5, lines: 1 },
    ]);
    expect(blocks('plain: start\n  "still plain # first\n# second\n# third', "yaml")).toEqual([
      { line: 2, lines: 3 },
    ]);
    expect(blocks('plain: start\n\n  "still plain # first\n# second\n# third', "yaml")).toEqual([
      { line: 3, lines: 3 },
    ]);
    expect(blocks('plain: data[ "still plain # first\n# second\n# third', "yaml")).toEqual([
      { line: 1, lines: 3 },
    ]);
  });

  it("recognizes shell comments outside quotes, expansions and heredoc bodies", () => {
    const source = [
      "#!/bin/sh",
      "echo '# data",
      "# data",
      "# data'",
      'echo "# data',
      "# data",
      '# data"',
      "cat <<'EOF'",
      "# data",
      "# data",
      "# data",
      "EOF",
      'cat <<-"END"',
      "\t# data",
      "\t# data",
      "\t# data",
      "\tEND",
      `echo data#value \\#word \${value#prefix} \${#value}`,
      "echo ok # first",
      "# second",
      "# third",
      'echo "$(echo ok # substitution',
      "# next",
      "# last",
      ')"',
    ].join("\n");
    expect(blocks(source, "sh")).toEqual([
      { line: 19, lines: 3 },
      { line: 22, lines: 3 },
    ]);
  });

  it("counts separate comments on one line and CRLF physical rows with Unicode data", () => {
    expect(
      blocks('const text = "雪"; /* first */ /* second\r\nmore\r\nend */\r\n// final', "ts"),
    ).toEqual([
      { line: 1, lines: 1 },
      { line: 1, lines: 3 },
      { line: 4, lines: 1 },
    ]);
  });

  it("documents lexical data exclusions and includes trailing comments in the rule", () => {
    const reference = readFileSync(
      new URL("../docs/reference/11-perf.md", import.meta.url),
      "utf8",
    );
    const section = reference.split("## The comment gate\n")[1]?.split("\n## ")[0];
    expect(section).toContain("Comments after code follow the same two-line limit.");
    expect(section).toContain("Strings and scalar data do not count as comments.");
    expect(section).toContain("a quoted URL argument still count.");
    expect(section).toContain(
      "a value start, including an indented line; plain flow scalars continue across",
    );
    expect(section).not.toContain("A trailing comment after code on the same line is not a block");
  });

  it("names every block over two lines under the paths it is given, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-comments-"));
    writeFileSync(join(root, "ok.ts"), "// one\n// two\nexport const a = 1;\n");
    writeFileSync(join(root, "long.ts"), "export const a = 1;\n/**\n * why\n */\n");
    writeFileSync(join(root, "notes.md"), "# a\n# b\n# c\n");
    expect(overLimit(["."], root)).toEqual([{ file: "long.ts", line: 2, lines: 3 }]);
  });

  it("reads YAML and shell through their `#`, skips node_modules, and takes CRLF lines", () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-comments-"));
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, ".github", "workflows", "ci.yml"), "# a\n# b\n# c\non: push\n");
    writeFileSync(join(root, "run.sh"), "#!/bin/sh\n# a\n# b\necho\n");
    writeFileSync(join(root, "node_modules", "n.ts"), "// a\n// b\n// c\n");
    writeFileSync(join(root, "crlf.ts"), "// a\r\n// b\r\n// c\r\nconst x = 1; // d\r\n");
    expect(overLimit(["."], root)).toEqual([
      { file: ".github/workflows/ci.yml", line: 1, lines: 3 },
      { file: "crlf.ts", line: 1, lines: 3 },
    ]);
  });

  it("walks every root ADR-011 names when it is given none", () => {
    expect(ROOTS).toEqual(["src", "tests", "e2e", "perf", "scripts", ".github"]);
  });

  it("selects the grammar by file extension and excludes data in every supported file kind", () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-comments-"));
    try {
      const samples = {
        "typed.ts":
          "const id = <T>(x: T) => x; const data = `\n// a\n// b\n// c\n`; /* real\nmore\nend */",
        "view.tsx": "<div>\n// a\n// b\n// c\n{/* real\nmore\nend */}</div>",
        "style.css": 'a { content: "/* data */"; }\n// a\n// b\n// c\n/* real\nmore\nend */',
        "short.yml": "data: |\n  # a\n  # b\n  # c\n# real\n# more\n# end",
        "long.yaml": 'data: "\n# a\n# b\n# c"\n# real\n# more\n# end',
        "run.sh": "#!/bin/sh\ncat <<'END'\n# a\n# b\n# c\nEND\n# real\n# more\n# end",
      };
      for (const [name, source] of Object.entries(samples)) writeFileSync(join(root, name), source);
      expect(overLimit(["."], root)).toEqual([
        { file: "long.yaml", line: 5, lines: 3 },
        { file: "run.sh", line: 7, lines: 3 },
        { file: "short.yml", line: 5, lines: 3 },
        { file: "style.css", line: 5, lines: 3 },
        { file: "typed.ts", line: 5, lines: 3 },
        { file: "view.tsx", line: 5, lines: 3 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

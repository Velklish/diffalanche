import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const prose = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");

describe("current documentation contracts", () => {
  it("names the installed renderer, task files and top-only Escape behavior", () => {
    const handoff = prose("docs/design/HANDOFF.md");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.devDependencies["react-diff-view"]).toBeDefined();
    expect(handoff).toContain("`react-diff-view`");
    expect(handoff).not.toContain("`@git-diff-view/react`");
    expect(handoff).toContain("reviews/ls-240372/comments.json");
    expect(handoff).toContain("`.diffalanche/reviews/<name>/comments.json`");
    expect(handoff).toContain("`review.json` (метаданные) и `diff.json` (кэш дифа)");
    expect(handoff).toContain("`esc` закрывает только верхний применимый слой; черновик композера под оверлеем сохраняется");
    expect(handoff).not.toContain("`esc` закрывает всё");
  });

  it("counts both destructive actions without changing their design policy", () => {
    const ui = prose("docs/reference/08-ui.md");
    expect(prose("DESIGN.md")).toContain("There are exactly two");
    expect(ui).toContain("one of the two red primaries in the product");
    expect(ui).toContain("one of the two places in the product that destroy review data");
    expect(ui).not.toContain("the only red primary in the product");
    expect(ui).not.toContain("the only place in the product that destroys review data");
  });

  it("distinguishes Phase 2 implementation from acceptance and Phase 4", () => {
    for (const file of ["docs/ROADMAP.md", "docs/reference/README.md"]) {
      const summary = prose(file);
      expect(summary).toContain("embedding model, index, suggestions");
      expect(summary).toContain("Phase 2 acceptance remains open");
      expect(summary).toContain("quiet-machine embedding performance evidence");
      expect(summary).not.toContain("only the embedding model exists yet");
      expect(summary).not.toMatch(/Phase 2.*?Offline\. Not started/);
    }
    expect(prose("docs/reference/README.md")).toContain("generative model and insights belong to Phase 4");
  });

});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const prose = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");

describe("current documentation contracts", () => {
  it("describes suggestion provenance and the visible sidebar footer", () => {
    const ui = prose("docs/reference/08-ui.md");
    expect(ui).toContain("A row taken from the panel keeps `auto` when its source was `auto`");
    expect(ui).not.toContain("so is a row taken from the panel");
    expect(ui).toContain("The sidebar measures its available height beneath its current top");
    expect(ui).toContain(
      "Comment and reply bodies are user-authored and are not language-detected",
    );
    expect(ui).toContain(
      "Confirmation dialogs derive their accessible names from the same marked-up questions",
    );
    expect(prose("docs/reference/09-ml.md")).toContain(
      "The table labels an unconfirmed model severity `(auto)`",
    );
    expect(prose("docs/reference/06-cli.md")).toContain(
      "an unconfirmed model severity is labelled `(auto)`",
    );
  });

  it("names the installed renderer, task files and top-only Escape behavior", () => {
    const handoff = prose("docs/design/HANDOFF.md");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.devDependencies["react-diff-view"]).toBeDefined();
    expect(handoff).toContain("`react-diff-view`");
    expect(handoff).not.toContain("`@git-diff-view/react`");
    expect(handoff).toContain("reviews/ls-240372/comments.json");
    expect(handoff).toContain("`.diffalanche/reviews/<name>/comments.json`");
    expect(handoff).toContain("`review.json` (метаданные) и `diff.json` (кэш дифа)");
    expect(handoff).toContain(
      "`esc` закрывает только верхний применимый слой; черновик композера под оверлеем сохраняется",
    );
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
    expect(prose("docs/reference/README.md")).toContain(
      "generative model and insights belong to Phase 4",
    );
  });

  it("keeps the dated serve measurements below the 768 MiB ceiling", () => {
    const adr = prose("docs/adr/adr-016-model-in-a-process-of-its-own.md");
    expect(adr).toContain("803 MiB on 2026-09-23");
    expect(adr).toContain("stayed below it at 742 and 764 MiB on 2026-09-24");
    expect(adr).toContain("4 MiB of headroom in the higher run");
    expect(adr).not.toContain("found both crossing the ceiling");
  });

  it("separates bare windows, named windows and the CLI default", () => {
    for (const file of ["README.md", "docs/SPEC.md", "skills/diffalanche-apply/SKILL.md"]) {
      const selection = prose(file);
      expect(selection).toContain("bare");
      expect(selection).toContain("`current`");
      expect(selection).toContain("named `?review=<name>` window stays on its task");
      expect(selection).toContain("--review");
      expect(selection).not.toContain("switches both the UI and the CLI");
      expect(selection).not.toContain("change what the human's UI is looking at");
    }
    const readme = prose("README.md");
    expect(readme).toContain("CLI commands without `--review` use `current` as their default");
    expect(readme).toContain("`review new --no-use` creates a task without moving `current`");
    const apply = prose("skills/diffalanche-apply/SKILL.md");
    expect(apply).toContain("It does not create or switch review sessions");
    expect(apply).toContain("Do not change selection without an explicit request");
  });

  it("describes both npm bundles in the delivery constraints", () => {
    const adr = prose("docs/adr/adr-014-embedding-model-and-npm-delivery.md");
    const constraints = adr.slice(
      adr.indexOf("Three constraints"),
      adr.indexOf("### How the numbers were taken"),
    );
    expect(constraints).not.toContain("package is one bundle");
    expect(constraints).toContain(
      "The npm package ships two bundles, `dist/cli.js` and `dist/embed-child.js`",
    );
    expect(constraints).toContain("with no runtime dependencies at all");
  });

  it("places the npm runtime JavaScript in the embedding child bundle", () => {
    const adr = prose("docs/adr/adr-014-embedding-model-and-npm-delivery.md");
    const runtime = adr.slice(
      adr.indexOf("**The runtime to the npm channel"),
      adr.indexOf("**Batching"),
    );
    expect(runtime).not.toContain("runtime's JavaScript into `dist/cli.js`");
    expect(runtime).toContain("5B bundles the runtime's JavaScript into `dist/embed-child.js`");
    expect(runtime).toContain("runs it in the embedding child process");
    expect(runtime).toContain("points its binding at the cache directory");
  });

  it("places embedding in a child for both callers without deferring delivery", () => {
    expect(prose("docs/SPEC.md")).toContain(
      "Server and CLI callers run embedding in a child process; the parent keeps the index, its update and its search",
    );
    const adr = prose("docs/adr/adr-014-embedding-model-and-npm-delivery.md");
    expect(adr).toContain(
      "Server and command callers embed in a child process that holds only the model",
    );
    expect(adr).toContain("The model's delivery implements 4A and 5B");
    expect(adr).toContain("loads the runtime binding from the user cache");
    expect(adr).not.toContain("runs in the server process");
    expect(adr).not.toContain("embed in the server process");
    expect(adr).not.toContain("Until then `dist/cli.js` contains no runtime");
    expect(adr).toContain("**Date:** 2026-09-23");
    expect(adr).toContain("1.86 s on Node and 1.94 s on Bun");
  });

  it("defines the current pointer separately from named-window selection", () => {
    const current = readFileSync("docs/GLOSSARY.md", "utf8")
      .split("\n")
      .find((row) => row.startsWith("| current session |"));
    expect(current).toContain("CLI commands without `--review`");
    expect(current).toContain("a bare window without `?review=`");
    expect(current).toContain("A named `?review=<name>` window selects its task from the URL");
  });
});

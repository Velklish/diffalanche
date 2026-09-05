import { describe, expect, it } from "vitest";
import { parseBaseArgument } from "../src/core/domain/sessions.ts";
import type { Base } from "../src/core/storage/types.ts";
import { baseArgument, baseLabel, baseSummary, formatBase } from "../src/ui/base.ts";

/**
 * The base of a review session in the forms the screen needs. The argument is
 * the one the domain parses, so it is checked by parsing it back: the picker
 * and the CLI have one grammar for a base (`docs/SPEC.md` section 8), and a
 * picker that wrote its own would be a second one.
 */

describe("the argument the picker applies", () => {
  it("round-trips through the domain's own parser", () => {
    const cases: [Parameters<typeof baseArgument>, Base][] = [
      [["head", "", ""], { mode: "head" }],
      [["branch", "", ""], { mode: "branch" }],
      [["branch", "origin/develop", ""], { mode: "branch", branch: "origin/develop" }],
      [["ref", "", "v0.3.1"], { mode: "ref", ref: "v0.3.1" }],
    ];
    for (const [given, expected] of cases) {
      const argument = baseArgument(...given);
      expect(argument).not.toBeNull();
      expect(parseBaseArgument(argument as string)).toEqual(expected);
    }
  });

  it("takes a branch name that was typed with spaces around it", () => {
    expect(baseArgument("branch", "  origin/main  ", "")).toBe("branch:origin/main");
  });

  it("is nothing at all while the ref field is empty: there is no ref to apply", () => {
    expect(baseArgument("ref", "", "   ")).toBeNull();
  });
});

describe("the base as the screen prints it", () => {
  it("writes a base back as the argument that produces it", () => {
    for (const base of [
      { mode: "head" } as const,
      { mode: "branch" } as const,
      { mode: "branch", branch: "origin/develop" } as const,
      { mode: "ref", ref: "v0.3.1" } as const,
    ]) {
      expect(parseBaseArgument(formatBase(base))).toEqual(base);
    }
  });

  it("labels the pill with the name, not the grammar", () => {
    expect(baseLabel({ mode: "head" })).toBe("HEAD");
    expect(baseLabel({ mode: "branch" })).toBe("default branch");
    expect(baseLabel({ mode: "branch", branch: "origin/develop" })).toBe("origin/develop");
    expect(baseLabel({ mode: "ref", ref: "v0.3.1" })).toBe("v0.3.1");
    expect(baseLabel(undefined)).toBe("—");
  });

  it("says in the status bar what the review is read against", () => {
    expect(baseSummary({ mode: "head" })).toBe("working tree ↔ HEAD");
    expect(baseSummary({ mode: "branch", branch: "origin/develop" })).toBe(
      "merge-base ↔ origin/develop",
    );
    expect(baseSummary({ mode: "ref", ref: "v0.3.1" })).toBe("working tree ↔ v0.3.1");
  });
});

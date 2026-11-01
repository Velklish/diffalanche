import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reference = readFileSync(new URL("../docs/reference/08-ui.md", import.meta.url), "utf8");

describe("UI interaction reference", () => {
  it("records the overlay, retry, command, search and selection contracts", () => {
    for (const statement of [
      "The send shortcut leaves a draft untouched while an overlay is open",
      "A failed first page ends loading and offers a retry",
      "The POSIX shell example quotes both arguments",
      "Review and repository comments have no file preview",
      "Mode and branch buttons expose their selected state with `aria-pressed`",
    ]) {
      expect(reference).toContain(statement);
    }
  });
});

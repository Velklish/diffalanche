import { expect, it, vi } from "vitest";
import { suggest } from "../src/cli/commands/suggest.ts";
import { createContext } from "../src/cli/context.ts";

vi.mock("../src/core/ml/embed/open.ts", () => ({
  openEmbedder: async () => ({ close: () => {} }),
}));
vi.mock("../src/cli/commands/embedding-index.ts", () => ({
  assertHistory: async () => {},
}));
vi.mock("../src/core/ml/suggest/index.ts", () => ({
  suggest: async () => ({
    severity: null,
    update: { warnings: [] },
    suggestions: [
      {
        similarity: 0.9,
        severity: "warning",
        severitySource: "auto",
        session: "a",
        repo: null,
        path: null,
        line: null,
        body: "automatic",
      },
      {
        similarity: 0.8,
        severity: "nit",
        severitySource: "manual",
        session: "b",
        repo: null,
        path: null,
        line: null,
        body: "manual",
      },
    ],
  }),
}));

it("labels only the unconfirmed model severity in the suggest table", async () => {
  let out = "";
  const args = { values: { body: "cache key" }, positionals: [] };
  const context = createContext(
    args,
    {
      out: (text: string) => {
        out += text;
      },
      err: () => {},
    },
    { read: async () => null },
  );
  const code = await suggest.run(context, args);
  expect(code).toBe(0);
  expect(out).toContain("warning (auto)");
  expect(out).toMatch(/nit\s+b\s+the review\s+manual/);
});

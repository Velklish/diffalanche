import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const doc = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

it("documents the actual permission skips separately from root-proof refusals", () => {
  expect(doc("docs/reference/01-scanner.md")).toContain(
    "This is a listing failure, not a permission failure.",
  );
  expect(doc("docs/reference/09-ml.md")).toContain("It cannot prove the `EACCES` wording.");
  expect(doc("docs/reference/09-ml.md")).toContain("The delivery chmod case skips on root");
  expect(doc("README.md")).toContain("their documented skips and separate");
});

it("documents the repetition deadline and its direct-child-only limitation", () => {
  expect(doc("docs/reference/11-perf.md")).toContain("outer ten-minute `execFileSync` deadline");
  expect(doc("docs/reference/11-perf.md")).toContain(
    "A deadline kills the direct repetition process with `SIGKILL`.",
  );
  expect(doc("docs/reference/11-perf.md")).toContain(
    "This does not promise\nthat Chromium descendants stop on timeout.",
  );
  expect(doc("README.md")).toContain("keeps earlier raw samples on stderr without a final");
});

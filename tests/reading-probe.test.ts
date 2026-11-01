import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("keeps the reading probe, card scroll margin and browser checks at the same height", () => {
  const declarations = [
    {
      path: "src/ui/reveal.ts",
      pattern: /export const PROBE_Y\s*=\s*(\d+(?:\.\d+)?)\s*;/g,
    },
    {
      path: "src/ui/styles.css",
      pattern: /\.file-card\s*\{[^}]*scroll-margin-top:\s*(\d+(?:\.\d+)?)px\s*;/g,
    },
    {
      path: "e2e/sidebar.spec.ts",
      pattern:
        /function underTheHeader\(\)[^{]*\{[^}]*\.elementFromPoint\(window\.innerWidth\s*\/\s*2,\s*(\d+(?:\.\d+)?)\s*\)/g,
    },
    {
      path: "e2e/live.spec.ts",
      pattern: /const probe\s*=\s*(\d+(?:\.\d+)?)\s*;/g,
    },
  ];
  const coordinates = declarations.map(({ path, pattern }) => {
    const matches = [...readFileSync(join(ROOT, path), "utf8").matchAll(pattern)];
    expect(matches, `${path}: expected one readable reading-coordinate declaration`).toHaveLength(
      1,
    );
    return { path, y: Number(matches[0]?.[1]) };
  });
  const reading = coordinates[0];
  for (const coordinate of coordinates) {
    expect(
      coordinate.y,
      `reading coordinates disagree: ${coordinates.map(({ path, y }) => `${path}=${y}`).join(", ")}`,
    ).toBe(reading?.y);
  }
});

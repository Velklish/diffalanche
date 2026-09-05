import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * `DESIGN.md` is the token authority the Impeccable design skill reads, and
 * `src/ui/tokens.css` is what the browser reads. The rule in `AGENTS.md` is that
 * the two change together; this test is what enforces it. Dark tokens are keyed
 * in the frontmatter by their CSS variable name, light ones by that name plus
 * `-light`.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

/** The two tokens that are box-shadow values, not colours: they live in the sidecar. */
const NOT_COLOURS = new Set(["shadow", "shadowSm", "sans", "mono"]);

function cssTokens(selector: string): Map<string, string> {
  const css = readFileSync(`${root}/src/ui/tokens.css`, "utf-8");
  const block = new RegExp(`${escapeRegExp(selector)}\\s*\\{(.*?)\\n\\}`, "s").exec(css);
  if (!block?.[1]) throw new Error(`no ${selector} block in tokens.css`);
  const tokens = new Map<string, string>();
  for (const [, name, value] of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (name && value && !NOT_COLOURS.has(name)) tokens.set(name, value.trim());
  }
  return tokens;
}

function designColours(): Map<string, string> {
  const design = readFileSync(`${root}/DESIGN.md`, "utf-8");
  const frontmatter = /^---\n(.*?)\n---\n/s.exec(design)?.[1];
  if (!frontmatter) throw new Error("DESIGN.md has no frontmatter");
  const block = /^colors:\n((?: {2}\S.*\n)+)/m.exec(frontmatter)?.[1];
  if (!block) throw new Error("DESIGN.md frontmatter has no colors block");
  const colours = new Map<string, string>();
  for (const [, key, value] of block.matchAll(/^ {2}([\w-]+): "(.*)"$/gm)) {
    if (key && value !== undefined) colours.set(key, value);
  }
  return colours;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("DESIGN.md and tokens.css carry the same values", () => {
  const dark = cssTokens(":root");
  const light = cssTokens(':root[data-theme="light"]');
  const colours = designColours();

  it("finds both themes in tokens.css", () => {
    expect(dark.size).toBe(28);
    expect(light.size).toBe(28);
  });

  it.each([...dark])("dark %s equals DESIGN.md", (name, value) => {
    expect(colours.get(name)).toBe(value);
  });

  it.each([...light])("light %s equals DESIGN.md", (name, value) => {
    expect(colours.get(`${name}-light`)).toBe(value);
  });

  it("has no colour DESIGN.md invented", () => {
    const expected = new Set([...dark.keys(), ...[...light.keys()].map((n) => `${n}-light`)]);
    expect([...colours.keys()].filter((key) => !expected.has(key))).toEqual([]);
  });

  it("keeps the sidecar's canonical values in step too", () => {
    const sidecar = JSON.parse(readFileSync(`${root}/.impeccable/design.json`, "utf-8")) as {
      extensions: { colorMeta: Record<string, { canonical: string }> };
    };
    const meta = sidecar.extensions.colorMeta;
    expect(Object.keys(meta).length).toBe(colours.size);
    for (const [key, entry] of Object.entries(meta)) {
      expect(entry.canonical, `colorMeta.${key}`).toBe(colours.get(key));
    }
  });
});

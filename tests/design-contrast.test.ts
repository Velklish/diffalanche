import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WCAG AA over the token pairs the interface actually uses for text (DA-22.1).
 * Text below 18.66 px needs 4.5:1, and every size in the ramp of `DESIGN.md` is
 * below it: the largest type in the product is 19 px and is `--tx` on `--bg`.
 *
 * The pairs are listed rather than scraped from the stylesheet, because what a
 * colour sits *on* is a fact about the layout and not about the declaration —
 * `--tx3` on a hunk header is `--panel2`, on a file card's chip `--panel3`.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

/** What small text has to clear. Every size in the ramp is under 18.66 px. */
const AA = 4.5;

/**
 * Each text colour with the grounds it is actually drawn on. `--tx3` is
 * everywhere; a changed row takes `--addTx` / `--delTx` and the wash under
 * them, so neither `--code` nor `--ln` is ever on those. `--code` does sit on
 * the selection wash — `.diff-code-selected` sets a background and no colour —
 * and clears it at 8.02:1 dark and 8.93:1 light, so `accBg` is one of its
 * grounds. `--ln` is not on that wash at all: the gutter of a selected row
 * takes `--accTx` (`styles.css`, `.diff-gutter-selected`), because `--ln` there
 * is 4.23:1.
 */
const PAIRS: { text: string; grounds: string[] }[] = [
  { text: "tx", grounds: ["bg", "panel", "panel2", "panel3"] },
  { text: "tx2", grounds: ["bg", "panel", "panel2", "panel3"] },
  { text: "tx3", grounds: ["bg", "panel", "panel2", "panel3"] },
  { text: "code", grounds: ["panel", "accBg"] },
  { text: "ln", grounds: ["panel"] },
  { text: "accTx", grounds: ["accBg", "panel", "panel3"] },
];

/**
 * The two washes are translucent, so what is under them is part of the answer:
 * they are laid over a file card before the ratio is taken.
 */
const WASHED: { text: string; wash: string }[] = [
  { text: "addTx", wash: "add" },
  { text: "delTx", wash: "del" },
];

/** Filled plates: the text is `onAcc` and the ground is the severity itself. */
const FILLED = ["acc", "crit", "warn", "nit", "q", "ok"];

function tokens(selector: string): Map<string, string> {
  const css = readFileSync(`${root}/src/ui/tokens.css`, "utf-8");
  const block = new RegExp(`${selector}\\s*\\{(.*?)\\n\\}`, "s").exec(css);
  if (!block?.[1]) throw new Error(`no ${selector} block in tokens.css`);
  const found = new Map<string, string>();
  for (const [, name, value] of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

/** A translucent wash laid over an opaque ground, as the browser paints it. */
function flatten(wash: string, ground: string): string {
  const parts = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(wash);
  if (!parts) return wash;
  const alpha = Number(parts[4]);
  const under = [1, 3, 5].map((at) => Number.parseInt(ground.slice(at, at + 2), 16));
  const mixed = [1, 2, 3].map((channelAt, index) =>
    Math.round(alpha * Number(parts[channelAt]) + (1 - alpha) * (under[index] as number)),
  );
  return `#${mixed.map((one) => one.toString(16).padStart(2, "0")).join("")}`;
}

function channel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) =>
    channel(Number.parseInt(hex.slice(at, at + 2), 16) / 255),
  );
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** The WCAG relative-luminance ratio, lighter over darker. */
function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((light as number) + 0.05) / ((dark as number) + 0.05);
}

function ratios(theme: Map<string, string>): { pair: string; ratio: number }[] {
  const found: { pair: string; ratio: number }[] = [];
  const of = (name: string): string => {
    const value = theme.get(name);
    if (value === undefined) throw new Error(`no --${name} in tokens.css`);
    return value;
  };
  for (const { text, grounds } of PAIRS) {
    for (const ground of grounds) {
      found.push({ pair: `${text} on ${ground}`, ratio: contrast(of(text), of(ground)) });
    }
  }
  for (const { text, wash } of WASHED) {
    const over = flatten(of(wash), of("panel"));
    found.push({ pair: `${text} on ${wash} over panel`, ratio: contrast(of(text), over) });
  }
  for (const filled of FILLED) {
    found.push({ pair: `onAcc on ${filled}`, ratio: contrast(of("onAcc"), of(filled)) });
  }
  return found;
}

describe("the contrast of the tokens the interface sets text in", () => {
  it("clears WCAG AA for small text in the dark theme", () => {
    const under = ratios(tokens(":root")).filter((one) => one.ratio < AA);
    expect(under.map((one) => `${one.pair} ${one.ratio.toFixed(2)}`)).toEqual([]);
  });

  it("clears WCAG AA for small text in the light theme", () => {
    const under = ratios(tokens(':root\\[data-theme="light"\\]')).filter((one) => one.ratio < AA);
    expect(under.map((one) => `${one.pair} ${one.ratio.toFixed(2)}`)).toEqual([]);
  });

  it("computes the ratio the way WCAG does", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

/**
 * The README's CLI reference against the CLI's own `--help`. Both are written by
 * hand in different files, and the one that goes stale is the README — a reader
 * who trusts it types a flag that does not exist. `run` is called in process,
 * the way `tests/cli.test.ts` does it, so the help text under test is the text
 * the two delivery channels print.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import type { UiAssets } from "../src/server/assets.ts";

const noUi: UiAssets = { read: async () => null };

async function help(...argv: string[]): Promise<string> {
  let out = "";
  const code = await run([...argv, "--help"], noUi, {
    out: (text) => {
      out += text;
    },
    err: () => {},
  });
  expect(code, `\`${argv.join(" ")} --help\` exited ${code}`).toBe(0);
  return out;
}

/** The rows of one indented block of the help text, up to the blank line. */
function blockRows(text: string, title: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(title);
  if (start === -1) return [];
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    rows.push(line.trim());
  }
  return rows;
}

/** The words that select a command, without the `<id>` and `<name>` after them. */
function commandName(row: string): string {
  const words: string[] = [];
  const [head = ""] = row.split(/\s{2,}/);
  for (const word of head.split(" ")) {
    if (word.startsWith("<") || word.startsWith("[")) break;
    words.push(word);
  }
  return words.join(" ");
}

function flagsOf(text: string): Set<string> {
  return new Set(text.match(/--[a-z][a-z-]*/g) ?? []);
}

const README = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");

/** The section of the README the CLI reference lives in. */
function section(title: string): string {
  const from = README.indexOf(`\n## ${title}\n`);
  expect(from, `the README has no "## ${title}" section`).toBeGreaterThan(-1);
  const rest = README.slice(from + 1);
  const to = rest.indexOf("\n## ", 1);
  return to === -1 ? rest : rest.slice(0, to);
}

/**
 * The first column of every row of the table whose header cell is `header`.
 * Splitting on a `|` that is not escaped is what keeps `[--json|--patch]` inside
 * its own cell, and stopping at the blank line is what keeps the command table
 * and the global-flag table under one heading apart.
 */
function tableColumn(markdown: string, header: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header} |`));
  expect(start, `no table headed "${header}"`).toBeGreaterThan(-1);
  const cells: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("| ")) break;
    const cell = line.split(/(?<!\\)\|/)[1]?.trim();
    if (cell !== undefined && cell !== "") {
      cells.push(cell.replaceAll("\\|", "|").replaceAll("`", ""));
    }
  }
  return cells;
}

const cliSection = section("The CLI");
const documented = new Map(
  tableColumn(cliSection, "Command").map((cell) => [commandName(cell), cell] as const),
);

describe("the README's CLI reference", () => {
  it("documents every command the CLI advertises, and no others", async () => {
    const advertised = blockRows(await help(), "Commands:").map(commandName);
    expect([...documented.keys()].sort()).toEqual([...advertised].sort());
  });

  it("documents the flags of every command, and no others", async () => {
    const advertised = blockRows(await help(), "Commands:").map(commandName);
    for (const name of advertised) {
      const cell = documented.get(name);
      expect(cell, `the README does not document \`${name}\``).toBeDefined();
      const options = blockRows(await help(...name.split(" ")), "Options:");
      const printed = flagsOf(options.join("\n"));
      expect(flagsOf(cell as string), `flags of \`${name}\``).toEqual(printed);
    }
  });

  it("documents the global flags the CLI prints under every command", async () => {
    const printed = flagsOf(blockRows(await help(), "Global options:").join("\n"));
    const globals = flagsOf(tableColumn(cliSection, "Global flag").join(" "));
    expect(globals).toEqual(printed);
  });
});

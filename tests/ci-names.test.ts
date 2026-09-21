import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

// The names branch protection matches are written once, in the header comment, indented by
// five spaces. A trailing `<- the job id is x` note is prose about the name, not part of it.
function documentedNames(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => /^#\s{5}\S/.test(line))
    .map((line) =>
      line
        .replace(/^#\s+/, "")
        .replace(/\s+<-.*$/, "")
        .trim(),
    )
    .filter(Boolean);
}

type Cell = Record<string, string>;

// Enough of the workflow to answer one question: what does each job report as? A job block
// starts at two-space indent under `jobs:`; inside it we need `name:` and the matrix cells.
function jobBlocks(text: string): { id: string; body: string }[] {
  const lines = text.split("\n");
  const start = lines.indexOf("jobs:");
  const blocks: { id: string; body: string }[] = [];
  let current: { id: string; body: string[] } | null = null;
  for (const line of lines.slice(start + 1)) {
    const header = line.match(/^ {2}([A-Za-z][\w-]*):\s*$/);
    if (header) {
      if (current) blocks.push({ id: current.id, body: current.body.join("\n") });
      current = { id: header[1] ?? "", body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) blocks.push({ id: current.id, body: current.body.join("\n") });
  return blocks;
}

// Two matrix forms are in use: `include:` with one mapping per cell, and plain axes whose
// product is the cell set. A job with neither reports a single check.
function cells(body: string): Cell[] {
  const includes = [...body.matchAll(/^\s+- \{([^}]*)\}\s*$/gm)].map((match) => {
    const cell: Cell = {};
    for (const pair of (match[1] ?? "").split(",")) {
      const [key, value] = pair.split(":").map((part) => part?.trim());
      if (key && value) cell[key] = value;
    }
    return cell;
  });
  if (includes.length) return includes;
  const axes: { key: string; values: string[] }[] = [
    ...body.matchAll(/^\s{8}([a-z][\w-]*):\s*\[([^\]]+)\]\s*$/gm),
  ].map((match) => ({
    key: match[1] ?? "",
    values: (match[2] ?? "").split(",").map((value) => value.trim()),
  }));
  if (!axes.length) return [{}];
  return axes.reduce<Cell[]>(
    (acc, axis) =>
      acc.flatMap((cell) => axis.values.map((value) => ({ ...cell, [axis.key]: value }))),
    [{}],
  );
}

function reportedNames(text: string): string[] {
  const names: string[] = [];
  for (const { id, body } of jobBlocks(text)) {
    const declared = body.match(/^ {4}name:\s*(.+?)\s*$/m)?.[1];
    for (const cell of cells(body)) {
      if (!declared) {
        // No `name:`: GitHub reports the id, and a matrix job adds its cell values.
        const suffix = Object.values(cell);
        names.push(suffix.length ? `${id} (${suffix.join(", ")})` : id);
        continue;
      }
      names.push(
        declared.replace(
          /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g,
          (_, key: string) => cell[key] ?? `\${{ matrix.${key} }}`,
        ),
      );
    }
  }
  return names;
}

describe("the check-run names branch protection lists", () => {
  const documented = documentedNames(ci);
  const reported = reportedNames(ci);

  it("reads a list out of the header comment at all", () => {
    // Guards the guard: a reworded comment that stops matching would make every
    // assertion below vacuously true.
    expect(documented.length).toBeGreaterThanOrEqual(10);
    expect(documented).toContain("check");
  });

  it("names only checks the workflow actually reports", () => {
    expect(documented.filter((name) => !reported.includes(name))).toEqual([]);
  });

  it("leaves out exactly the windows cells the comment declares not required", () => {
    const undocumented = reported.filter((name) => !documented.includes(name));
    expect(undocumented.every((name) => name.includes("windows-latest"))).toBe(true);
    // The comment wraps, so the assertion holds the half that carries the decision.
    expect(ci).toContain("is deliberately not in the list until DA-45");
  });
});

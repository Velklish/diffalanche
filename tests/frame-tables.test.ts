/** The reference's frame tables against `WatcherEvent`: a frame with no row, a row with other
 * fields, or a row for a frame the union lost fails here (DA-109, docs/reference/README.md). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import { parseTypeScript, stringValue } from "./helpers/typescript-syntax.ts";

const ROOT = join(import.meta.dirname, "..");
const REFERENCE = "docs/reference";

/** Frames the server sends of its own, not the watcher's: the feed and the replay's refusal. */
const SERVER_FRAMES = ["activity", "reload"];

/** The three tables that must be anchored, and how, whatever others opt in: an anchor turned to
 * `names` would switch the field comparison off and still pass. */
const REQUIRED: Record<string, { mode: Mode; server: boolean }> = {
  "05-watcher.md": { mode: "fields without type", server: false },
  "07-server.md": { mode: "fields with type", server: true },
  "08-ui.md": { mode: "names", server: true },
};

const ANCHOR =
  /^<!-- frames of (\w+)( and the server)?, (fields without type|fields with type|names) — checked by tests\/frame-tables\.test\.ts -->$/;

type Frame = { name: string; fields: string[] };
type Mode = "fields without type" | "fields with type" | "names";
type Row = { line: number; names: string[]; fields: string[] | null };
type Table = { at: string; union: string; server: boolean; mode: Mode; rows: Row[] };

function members(node: Node): Node[] {
  if (node.type === "union_type") return node.namedChildren.flatMap(members);
  return node.type === "comment" ? [] : [node];
}

/** The members of the union `name` in `text`, each by its `type` and with its field names. */
async function unionFrames(path: string, text: string, name: string): Promise<Frame[]> {
  const root = await parseTypeScript(path, text);
  const alias = root
    .descendantsOfType("type_alias_declaration")
    .find((node) => node.childForFieldName("name")?.text === name);
  const value = alias?.childForFieldName("value");
  if (value === null || value === undefined) throw new Error(`${path} declares no type ${name}`);
  return members(value).map((member) => {
    const where = `${path}:${member.startPosition.row + 1}`;
    if (member.type !== "object_type") {
      throw new Error(`${where}: a member of ${name} that is not an object literal type`);
    }
    const fields = member.namedChildren
      .filter((child) => child.type === "property_signature")
      .map((property) => property.childForFieldName("name"))
      .flatMap((key) =>
        key === null ? [] : [key.type === "string" ? stringValue(key) : key.text],
      );
    const tag = member.namedChildren
      .filter((child) => child.type === "property_signature")
      .find((property) => property.childForFieldName("name")?.text === "type")
      ?.descendantsOfType("string")[0];
    if (tag === undefined) {
      throw new Error(`${where}: a member of ${name} with no literal \`type\``);
    }
    return { name: stringValue(tag), fields };
  });
}

/** A row's cells, split on the pipes that are not escaped. */
function cells(line: string): string[] {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** Every anchored table of `text`: the rows under the header after the anchor, to the first gap. */
function tablesIn(file: string, text: string): Table[] {
  const lines = text.split("\n");
  const tables: Table[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    // An anchor quoted in a code block is an example of one, not a table.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const anchor = fenced ? null : line.match(ANCHOR);
    if (anchor === null) return;
    // The table sits right under its anchor, a blank line between them at most.
    const header = [at + 1, at + 2].find((index) => lines[index]?.startsWith("|")) ?? -1;
    const rows: Row[] = [];
    for (let index = header + 2; header !== -1 && lines[index]?.startsWith("|"); index++) {
      const [names = "", data = ""] = cells(lines[index] ?? "");
      const list = data.match(/^`\{([^}]*)\}`/)?.[1];
      rows.push({
        line: index + 1,
        names: [...names.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""),
        fields: list === undefined ? null : list.split(",").map((field) => field.trim()),
      });
    }
    const [, union = "", server, mode] = anchor;
    tables.push({
      at: `${file}:${at + 1}`,
      union,
      server: server !== undefined,
      mode: mode as Mode,
      rows,
    });
  });
  return tables;
}

const listed = (fields: readonly string[]) => `{ ${fields.join(", ")} }`;

/** What each table says that its union does not, one sentence a disagreement. */
function mismatches(frames: readonly Frame[], table: Table): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    for (const name of row.names) {
      const where = `${table.at.split(":")[0]}:${row.line}`;
      if (seen.has(name)) found.push(`${where}: \`${name}\` has a second row`);
      seen.add(name);
      const frame = frames.find((one) => one.name === name);
      if (frame === undefined) {
        if (!(table.server && SERVER_FRAMES.includes(name))) {
          found.push(`${where}: \`${name}\` is not a frame of ${table.union}`);
        }
        continue;
      }
      if (table.mode === "names") continue;
      const expected = frame.fields.filter(
        (field) => table.mode === "fields with type" || field !== "type",
      );
      if (row.fields === null) {
        found.push(
          `${where}: \`${name}\` prints no field list; ${table.union} has ${listed(expected)}`,
        );
      } else if ([...row.fields].sort().join() !== [...expected].sort().join()) {
        found.push(
          `${where}: \`${name}\` lists ${listed(row.fields)}; ${table.union} has ${listed(expected)}`,
        );
      }
    }
  }
  const owed = [...frames.map((frame) => frame.name), ...(table.server ? SERVER_FRAMES : [])];
  for (const name of owed) {
    if (!seen.has(name)) {
      const whose = frames.some((frame) => frame.name === name) ? table.union : "the server";
      found.push(`${table.at}: the table has no row for \`${name}\`, a frame of ${whose}`);
    }
  }
  return found;
}

const UNION = `export type Event =
  /** One. */
  | { type: "one"; repo: string; files: string[] }
  | { type: "two"; "quoted-key": number }
  | { type: "three"; name: string };`;

const anchor = (rest: string) =>
  `<!-- frames of Event${rest} — checked by tests/frame-tables.test.ts -->`;

describe("the frame check", () => {
  it("reads each member of a union by its type, with its fields", async () => {
    expect(await unionFrames("bus.ts", UNION, "Event")).toEqual([
      { name: "one", fields: ["type", "repo", "files"] },
      { name: "two", fields: ["type", "quoted-key"] },
      { name: "three", fields: ["type", "name"] },
    ]);
  });

  it("refuses a member it cannot read rather than skipping it", async () => {
    const named = "type Other = { type: 'x' };\nexport type Event = { type: 'one' } | Other;";
    await expect(unionFrames("bus.ts", named, "Event")).rejects.toThrow(
      "bus.ts:2: a member of Event that is not an object literal type",
    );
  });

  it("finds a missing row, other fields, a frame the union lacks, and a second row", async () => {
    const frames = await unionFrames("bus.ts", UNION, "Event");
    const text = [
      anchor(" and the server, fields without type"),
      "",
      "| Event | Data |",
      "|---|---|",
      "| `one` | `{ repo }` — prose after the list |",
      "| `gone`, `reload` | `{ name }` |",
      "| `one` | `{ repo, files }` |",
      "",
    ].join("\n");
    const [table] = tablesIn("x.md", text);
    expect(table && mismatches(frames, table)).toEqual([
      "x.md:5: `one` lists { repo }; Event has { repo, files }",
      "x.md:6: `gone` is not a frame of Event",
      "x.md:7: `one` has a second row",
      "x.md:1: the table has no row for `two`, a frame of Event",
      "x.md:1: the table has no row for `three`, a frame of Event",
      "x.md:1: the table has no row for `activity`, a frame of the server",
    ]);
  });

  it("holds `type` where the table prints it, names alone where it prints none", async () => {
    const frames = await unionFrames("bus.ts", UNION, "Event");
    const rows = "| `one` | `{ type, repo, files }` |\n| `two`, `three` | anything |";
    const typed = tablesIn(
      "x.md",
      `${anchor(", fields with type")}\n| E | D |\n|---|---|\n${rows}`,
    );
    const names = tablesIn("x.md", `${anchor(", names")}\n| E | D |\n|---|---|\n${rows}`);
    expect(typed[0] && mismatches(frames, typed[0])).toEqual([
      "x.md:5: `two` prints no field list; Event has { type, quoted-key }",
      "x.md:5: `three` prints no field list; Event has { type, name }",
    ]);
    expect(names[0] && mismatches(frames, names[0])).toEqual([]);
  });

  it("reads no anchor out of a code block", () => {
    const text = ["```md", anchor(", names"), "| E | D |", "|---|---|", "```"].join("\n");
    expect(tablesIn("x.md", text)).toEqual([]);
  });

  it("takes a server frame only in a table that says it carries them", async () => {
    const frames = await unionFrames("bus.ts", UNION, "Event");
    const text = `${anchor(", names")}\n| E | D |\n|---|---|\n| \`one\`, \`two\`, \`three\`, \`activity\` | x |`;
    const [table] = tablesIn("x.md", text);
    expect(table && mismatches(frames, table)).toEqual([
      "x.md:4: `activity` is not a frame of Event",
    ]);
  });
});

describe("the reference's frame tables", () => {
  const files = readdirSync(join(ROOT, REFERENCE)).filter((file) => file.endsWith(".md"));
  const tables = files.flatMap((file) =>
    tablesIn(`${file}`, readFileSync(join(ROOT, REFERENCE, file), "utf8")),
  );

  it("are anchored in each file that has one", () => {
    // Guards the guard: an anchor reworded out of the pattern would check nothing at all.
    for (const [file, { mode, server }] of Object.entries(REQUIRED)) {
      expect(
        tables
          .filter((table) => table.at.startsWith(`${file}:`))
          .map((table) => ({ mode: table.mode, server: table.server })),
        `${file} has no table under a frame anchor of this shape (docs/reference/README.md)`,
      ).toEqual([{ mode, server }]);
    }
  });

  it("agree with the union they mirror", async () => {
    const bus = "src/core/watcher/bus.ts";
    const frames = await unionFrames(bus, readFileSync(join(ROOT, bus), "utf8"), "WatcherEvent");
    expect(frames.length).toBeGreaterThanOrEqual(8);
    // The one union the check reads: an anchor naming another would be held against this one.
    expect(tables.filter((table) => table.union !== "WatcherEvent")).toEqual([]);
    expect(
      tables.flatMap((table) => mismatches(frames, table)),
      `the frame tables of ${REFERENCE} against WatcherEvent in ${bus}`,
    ).toEqual([]);
  });

  it("name as the server's own only frames the server sends", async () => {
    const events = "src/server/events.ts";
    const root = await parseTypeScript(events, readFileSync(join(ROOT, events), "utf8"));
    const strings = new Set(root.descendantsOfType("string").map(stringValue));
    expect(SERVER_FRAMES.filter((name) => !strings.has(name))).toEqual([]);
  });
});

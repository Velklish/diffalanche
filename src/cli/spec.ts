/**
 * What every command takes, written once. `util.parseArgs` is configured from
 * these definitions and `--help` is printed from them, so the flags a command
 * accepts and the flags it documents cannot drift apart (DA-13).
 */

export type OptionSpec = {
  type: "string" | "boolean";
  /** The value's name in the usage line; a boolean option carries none. */
  value?: string;
  about: string;
};

export type CommandSpec = {
  /** The words that select the command, as they are typed: `review new`. */
  name: string;
  /** The positional arguments of the usage line, when it has any: `<name>`. */
  arguments?: string;
  about: string;
  options: Record<string, OptionSpec>;
};

/**
 * The flags every command takes. `--review` and `--data-dir` are the two of
 * `docs/SPEC.md` section 8; `--root` is with them because the data directory
 * defaults to `<root>/.diffalanche`, and without it no command run from
 * anywhere but the root could find the review.
 */
export const GLOBAL: Record<string, OptionSpec> = {
  review: {
    type: "string",
    value: "<name>",
    about: "the review session to work on; default: the current one",
  },
  "data-dir": {
    type: "string",
    value: "<dir>",
    about: "the data directory; default: <root>/.diffalanche",
  },
  root: {
    type: "string",
    value: "<dir>",
    about: "the directory under review; default: the current directory",
  },
  help: { type: "boolean", about: "the options of this command" },
};

function label(name: string, option: OptionSpec): string {
  return `--${name}${option.value === undefined ? "" : ` ${option.value}`}`;
}

function block(title: string, rows: [string, string][]): string {
  const width = Math.max(...rows.map(([left]) => left.length));
  const lines = rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
  return `${title}\n${lines.join("\n")}\n`;
}

/** The global flags as help rows; three blocks print them and none owns them. */
function globalRows(): [string, string][] {
  return Object.entries(GLOBAL).map(([name, option]): [string, string] => [
    label(name, option),
    option.about,
  ]);
}

function options(spec: CommandSpec): string {
  const own = Object.entries(spec.options).map(([name, option]): [string, string] => [
    label(name, option),
    option.about,
  ]);
  const parts = own.length === 0 ? [] : [block("Options:", own)];
  return [...parts, block("Global options:", globalRows())].join("\n");
}

/** The `--help` of one command. */
export function usage(spec: CommandSpec): string {
  const line = ["diffalanche", spec.name, spec.arguments, "[<options>]"].filter(Boolean).join(" ");
  return `${line}\n\n  ${spec.about}\n\n${options(spec)}`;
}

/** The `--help` of a command group: `review` on its own has no meaning, its four do. */
export function group(name: string, specs: CommandSpec[]): string {
  const rows = specs.map((spec): [string, string] => [
    [spec.name.slice(name.length + 1), spec.arguments].filter(Boolean).join(" "),
    spec.about,
  ]);
  return (
    `diffalanche ${name} <subcommand> [<options>]\n\n` +
    `${block("Subcommands:", rows)}\n${block("Global options:", globalRows())}\n` +
    `Run "diffalanche ${name} <subcommand> --help" for the options of one.\n`
  );
}

/** The `--help` of the tool: every command with its one line. */
export function overview(version: string, specs: CommandSpec[]): string {
  const rows = specs.map((spec): [string, string] => [
    [spec.name, spec.arguments].filter(Boolean).join(" "),
    spec.about,
  ]);
  return (
    `diffalanche ${version}\n\ndiffalanche <command> [<options>]\n\n` +
    `${block("Commands:", rows)}\n${block("Global options:", globalRows())}\n` +
    'Run "diffalanche <command> --help" for the options of one command.\n'
  );
}

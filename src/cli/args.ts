/**
 * The command line as `util.parseArgs` reads it — the parser Node 22 and Bun
 * both ship, so the CLI needs no argument library — plus the readers that turn
 * one flag into the value a command wants and refuse anything else with a
 * message naming the flag.
 */
import { parseArgs } from "node:util";
import { UsageError } from "./errors.ts";
import type { CommandSpec } from "./spec.ts";
import { GLOBAL } from "./spec.ts";

export type Arguments = {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

/** Parses the arguments of one command against its own definitions and the global ones. */
export function parse(spec: CommandSpec, argv: string[]): Arguments {
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const [name, option] of Object.entries({ ...GLOBAL, ...spec.options })) {
    options[name] = { type: option.type };
  }
  options.help = { type: "boolean", short: "h" };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
    });
    return { values, positionals };
  } catch (error) {
    // The parser's own message names the flag; it is one line once its hint is
    // folded into it, which is what an exit code 1 may print.
    throw new UsageError(
      (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, " ").trim(),
    );
  }
}

export function text(args: Arguments, name: string): string | undefined {
  const value = args.values[name];
  return typeof value === "string" ? value : undefined;
}

export function flag(args: Arguments, name: string): boolean {
  return args.values[name] === true;
}

/** A flag a command cannot run without. */
export function required(args: Arguments, name: string): string {
  const value = text(args, name);
  if (value === undefined) throw new UsageError(`--${name} is required`);
  return value;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], value: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`--${name}: expected ${allowed.join(", ")}, got "${value}"`);
  }
  return value as T;
}

/** A flag whose value is one of a fixed set; `undefined` when it was not given. */
export function choice<T extends string>(
  args: Arguments,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = text(args, name);
  return value === undefined ? undefined : oneOf(name, allowed, value);
}

/** The same, for a flag the command cannot run without. */
export function requiredChoice<T extends string>(
  args: Arguments,
  name: string,
  allowed: readonly T[],
): T {
  return oneOf(name, allowed, required(args, name));
}

/** A flag holding a whole number: a port, a line. */
export function count(args: Arguments, name: string): number | undefined {
  const value = text(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new UsageError(`--${name}: expected a whole number, got "${value}"`);
  }
  return number;
}

/** A positional argument; `placeholder` is how the usage line spells it. */
export function positional(args: Arguments, index: number, placeholder: string): string {
  const value = args.positionals[index];
  if (value === undefined) throw new UsageError(`${placeholder} is required`);
  return value;
}

/** Everything typed past the arguments a command reads is a mistake, not an extra. */
export function noExtra(args: Arguments, taken: number): void {
  const extra = args.positionals.slice(taken);
  if (extra.length > 0) throw new UsageError(`unexpected argument: ${extra[0]}`);
}

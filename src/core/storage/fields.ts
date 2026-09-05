/**
 * The field readers every file of the data directory is validated with. They
 * exist once because `config.json` is checked the same way the session files
 * are: the files are meant to be edited by hand (`docs/SPEC.md` section 3,
 * decision 5), so every refusal has to name the file and the field.
 */
import { StorageError } from "./errors.ts";

export function fail(file: string, field: string | null, message: string): never {
  throw new StorageError(file, field, message);
}

/** Names the type of a value the way a message about a wrong field should. */
export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

export function parseJson(file: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(file, null, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function asObject(
  file: string,
  field: string | null,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(file, field, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function asString(file: string, field: string, value: unknown): string {
  if (typeof value !== "string") fail(file, field, `expected a string, got ${describe(value)}`);
  return value;
}

export function asNullableString(file: string, field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return asString(file, field, value);
}

export function asNullableNumber(file: string, field: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(file, field, `expected an integer, got ${describe(value)}`);
  }
  return value;
}

export function asArray(file: string, field: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) fail(file, field, `expected an array, got ${describe(value)}`);
  return value;
}

export function asStrings(file: string, field: string, value: unknown): string[] {
  return asArray(file, field, value).map((item, index) =>
    asString(file, `${field}[${index}]`, item),
  );
}

export function asOneOf<T extends string>(
  file: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const text = asString(file, field, value);
  if (!(allowed as readonly string[]).includes(text)) {
    fail(file, field, `expected one of ${allowed.join(", ")}, got ${JSON.stringify(text)}`);
  }
  return text as T;
}

export function asNullableOneOf<T extends string>(
  file: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null) return null;
  return asOneOf(file, field, value, allowed);
}

/**
 * Ordering by code point. `localeCompare` depends on the locale and on the ICU
 * data of the runtime, and diffalanche ships in two of them (`npx` on Node and a
 * Bun binary): the same root has to come out in the same order in both.
 */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

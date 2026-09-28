/** By code point: `localeCompare` depends on the locale and the runtime's ICU data, and the same
 * root has to sort alike from `npx` on Node and from the Bun binary. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

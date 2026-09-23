/** Whether the runtime can start a `.ts` file as a process: Bun can, Node since 22.18. The bundle
 * needs neither, so `engines.node` stays at 22 and only tests that spawn one ask for more. */
export const runsTypeScript = ((): boolean => {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") return true;
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
})();

/** Why a test that spawns a `.ts` file does not run here, said by the skip itself. */
const NEEDS_TYPESCRIPT = `Node ${process.versions.node} cannot start a TypeScript file; this test needs 22.18 or newer, or Bun`;

/** Skips the calling test on a runtime that cannot start a `.ts` file, and says why. */
export function needsTypeScript(context: { skip: (note?: string) => void }): void {
  if (!runsTypeScript) context.skip(NEEDS_TYPESCRIPT);
}

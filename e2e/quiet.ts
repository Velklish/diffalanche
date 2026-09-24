/** The UI suite between two readings of the load, as `bun run test:ui` runs it (08-ui.md, "UI tests"). */
import { spawnSync } from "node:child_process";
import { constants } from "node:os";
import { join } from "node:path";
import type { Load, Wait } from "../perf/load.ts";
import {
  afterRed,
  beforeRun,
  describeLoad,
  ignoringLoad,
  QUIET_WAIT_MS,
  readLoad,
  refusal,
  tooBusy,
} from "../perf/load.ts";

type Spawned = { status: number | null; signal: NodeJS.Signals | null; error?: Error };

/** The checkout's own Playwright, on Node as its shebang says, whether or not `bun run` put it on PATH. */
export const PLAYWRIGHT = join(import.meta.dirname, "..", "node_modules", ".bin", "playwright");

/** Playwright with `argv` after the precondition, and the exit code to leave with: its own, 128 and
 * the signal's number when a signal ended it, or 1 when the machine never came quiet. */
export async function runSuite(
  argv: string[],
  deps: Wait & {
    spawn?: (command: string, args: string[]) => Spawned;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const read: () => Load = deps.read ?? readLoad;
  const say = deps.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  const spawn = deps.spawn ?? ((command, args) => spawnSync(command, args, { stdio: "inherit" }));

  const { load: started, measure } = await beforeRun(env, deps);
  if (!measure) {
    say(`\n${refusal(started, `before the suite, after waiting ${QUIET_WAIT_MS / 1000} s`)}`);
    return 1;
  }
  if (ignoringLoad(env) && tooBusy(started)) {
    say(`**Not evidence.** ${describeLoad(started)}: a red spec on this run may be the machine's.`);
  }
  const run = spawn(PLAYWRIGHT, ["test", "--config", "e2e/playwright.config.ts", ...argv]);
  if (run.error !== undefined) throw run.error;
  // A run a signal ended is not a red the machine decided, and says which signal it was.
  if (run.signal !== null) {
    say(`\nplaywright ended on ${run.signal}`);
    return 128 + constants.signals[run.signal];
  }
  const exit = run.status ?? 1;
  const busy = afterRed(exit, started, read(), "during the suite", env);
  if (busy !== null) say(`\n${busy}`);
  return exit;
}

if (import.meta.main) process.exit(await runSuite(process.argv.slice(2)));

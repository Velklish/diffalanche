/** The watcher fixture's barrier, isolated so its delivery order can be exercised (05-watcher.md). */
import { join } from "node:path";

type Fixture = {
  trees: () => string[];
  other: () => string;
  write: (path: string, text: string) => Promise<unknown>;
  reported: (dir: string, path: string) => boolean;
  signals: (mark: number) => readonly (readonly string[])[];
  locked: () => boolean;
  cached: (file: string) => Promise<boolean>;
  overdue: (settle: number, written: number) => void;
  clock?: { now: () => number; pause: () => Promise<void> };
};

/** Keeps unique names across calls; the test clock replaces elapsed time, never the 20 s deadline. */
export function makeSettle(fixture: Fixture): () => Promise<void> {
  let settled = 0;
  const now = fixture.clock?.now ?? (() => performance.now());
  const pause = fixture.clock?.pause ?? (() => new Promise<void>((done) => setTimeout(done, 5)));
  return async () => {
    const deadline = now() + 20_000;
    settled += 1;
    const marker = `marker-${settled}`;
    const trees = fixture.trees();
    for (const dir of trees) await fixture.write(join(dir, marker), "");
    while (!trees.every((dir) => fixture.reported(dir, marker))) {
      if (now() > deadline) throw new Error(`no tree reported ${marker}`);
      await pause();
    }
    for (;;) {
      settled += 1;
      const file = `settle-${settled}.ts`;
      const mark = now();
      await fixture.write(join(fixture.other(), file), `export const s = ${settled};\n`);
      while (!fixture.signals(mark).some((files) => files.includes(file))) {
        if (now() > deadline) {
          fixture.overdue(settled, mark);
          throw new Error("the watcher never caught up");
        }
        await pause();
      }
      const first = fixture
        .signals(mark)
        .find((files) => files.includes(file)) as readonly string[];
      if (first.join("\n") !== file) continue;
      while (!(await fixture.cached(file)) || fixture.locked()) {
        if (now() > deadline) throw new Error(`diff.json never had ${file}`);
        await pause();
      }
      return;
    }
  };
}

/** The acceptance suite's web server: built, generated and served, in that order, without a shell,
 * so the same command starts on Windows, where `rm` and `./` do not (DA-45.7, 08-ui.md). */
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { argv, execPath, exit } from "node:process";
import { BINARY, FIXTURE, ROOT } from "./binary.ts";

const port = argv[2];
if (port === undefined) throw new Error("usage: bun e2e/serve-acceptance.ts <port>");

// The binary carries the UI, so no `build:ui`, and the fixture is made from scratch because the
// suite writes comments into it.
execFileSync(execPath, ["run", "build", "--", "--target", "current"], {
  cwd: ROOT,
  stdio: "inherit",
});
rmSync(resolve(ROOT, FIXTURE), { recursive: true, force: true });
execFileSync(execPath, ["e2e/fixture.ts", FIXTURE], { cwd: ROOT, stdio: "inherit" });

const server = spawn(resolve(ROOT, BINARY), ["serve", "--root", FIXTURE, "--port", port], {
  cwd: ROOT,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => exit(code ?? (signal === null ? 0 : 1)));

# DA-45.7 · Result

**Closed 2026-09-29.** Completed. The acceptance suite's four web-server steps now run from one script, `e2e/serve-acceptance.ts`, with no shell involved:
1. build the binary of the current target;
2. remove the fixture;
3. generate the fixture;
4. serve it with the binary, run as a child process. The script passes `SIGINT` and `SIGTERM` on to the child and exits with the child's code.

`webServer.command` in `e2e/acceptance.config.ts` is now `bun e2e/serve-acceptance.ts <port>`. Before, it was a POSIX line of the same steps joined by `&&`, which `cmd.exe` cannot run. The script calls Bun as `process.execPath` and the binary by its resolved path, so it never depends on a shell's `PATH` lookup or on `./`.

**Verification.**
- On Velklish/diffalanche#13, all three acceptance cells pass:
  - `ubuntu-latest` and `macos-latest`: green, as before;
  - `windows-latest`: 11 of 11 (job 109261781142).
- Locally, in the cloud container, the script ran through its first steps and stopped at the build. The build embeds the model, and huggingface.co is blocked there, so the rest could not be run locally.
- `bun run lint`, `typecheck` and `check:comments` exit 0.
- Reviewed by the approver, reading the whole diff (a test harness script, small, no product code).

**Documentation in the same pass.** `docs/reference/08-ui.md`, "The acceptance suite".

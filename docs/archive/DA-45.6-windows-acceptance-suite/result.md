# DA-45.6 · Result

**Closed 2026-09-29.** Completed. `windows-latest` is now in the `e2e` matrix, marked `continue-on-error`, and the job's steps run in Git Bash. 11-perf lists the cell among the Windows cells that are not required yet.

**Verification.** The cell's first run on Velklish/diffalanche#13 (job 109260204434) stopped at the web server. The command was a POSIX shell line, which Windows' shell could not start; that is DA-45.7, fixed in the same pull request. After the fix, `acceptance on windows-latest` passed all 11 criteria against `diffalanche-windows-x64.exe` (job 109261781142, `11 passed (17.9s)`). `acceptance on ubuntu-latest` and `acceptance on macos-latest` stayed green. `tests/ci-names.test.ts` passes. The reviewer was the approver, reading the whole diff; it is a CI and docs change, and the script is DA-45.7's.

**Documentation in the same pass.** `docs/reference/11-perf.md` (the job table, "The checks a pull request requires"); `docs/backlog/queue/DA-45-windows-verification.md`, fifth evidence.

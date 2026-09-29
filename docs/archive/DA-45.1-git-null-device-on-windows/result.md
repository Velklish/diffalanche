# DA-45.1 · Result

**Closed 2026-09-29.** Completed. There is now one constant, `GIT_NULL = "/dev/null"`, in `src/core/git/run.ts`. It replaces Node's `os.devNull` in five places: the reader's `readOnlyEnv` (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`), its `core.hooksPath` pin, the generator (`scripts/synth.ts`), the unit-test fixtures and the e2e fixtures. On Windows `os.devNull` is `\\.\nul`, and git refused it with `fatal: unable to access '//./nul'` at the generator's first `git init`, so the Windows smoke never got further.

A new step in the Windows smoke job, `scripts/check-git-null.ts`, guards the trust model of ADR-012 on that platform. It plants a configuration file at `\dev\null` on two drives: the one the process runs on, and the one git's `cwd` is on. It then fails if the reader's own `git()` reads that file, or reads any configuration file outside the repository. The reference (02-git) and ADR-012 name the spelling and the check.

**Verification.** Velklish/diffalanche#8, on the Windows runner (git 2.55.0.windows.5):
- `smoke node on windows-latest` now gets past `synth` ("synthetic review generated"). It stops at the CLI's first write, `review new` → `durability flush failed: EPERM`, which is now recorded in DA-45 as the next item.
- The check step exited 0. Output: `planted D:\dev\null (by this check)`, `planted C:\dev\null (by this check)`, then only `file:.git/config` origins and the `command line:` pins, and no `planted` value.

Locally, on the 4-core container:
- the git-touching unit files pass: `git`, `config`, `browse`, `branches`, `change-set`, `search-text`, `symbols`, `scanner` (133 passed, 1 skipped) and `git`, `scanner`, `write-api` (74 passed, 1 skipped);
- `bun run lint`, `typecheck` and `check:comments` exit 0;
- `bun scripts/check-git-null.ts` exits 0 on Linux without planting anything.

The required checks on the PR are green.

**Review:** two isolated reviewer rounds.
- Round one had six findings (four minor, two hypotheses). The main ones were that the Windows mapping was stated as fact while the verification could not tell it from a silently skipped drive-relative path, and the leftover literal spellings. The fix was the check step.
- Round two had one major and three minor findings and two hypotheses. The major was that the first version of the check planted on the process's drive, D:, while git ran on C:. It was fixed before the review arrived and is confirmed by the run above. The minors were a hooks stderr check that could not see a warning (dropped), planting outside the `try` (moved in), and a line wrap. From the hypotheses, the misleading failure label became a separate "file outside the repository" failure, and `exit()` became `process.exitCode`.
- DA-45.2 (minor) is filed: `GIT_CONFIG_NOSYSTEM` and a minimum git version.

**Documentation in the same pass.** `docs/reference/02-git.md` ("The environment is built rather than inherited"); `docs/adr/adr-012-git-trust-model.md` (point 1); `CHANGELOG.md`, Fixed; `docs/backlog/queue/DA-45-windows-verification.md` (second evidence).

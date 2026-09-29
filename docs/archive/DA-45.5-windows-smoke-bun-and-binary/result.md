# DA-45.5 · Result

**Closed 2026-09-29.** Completed. The smoke matrix now has `bun` and `binary` cells on `windows-latest`, beside `node`. All three are `continue-on-error`, as before. The `binary` cell runs the Bun-compiled `diffalanche-windows-x64.exe` that the release ships, which DA-45.3's review had named as not covered.

11-perf now names all three Windows cells:
- "The job" says the matrix runs all three channels on Windows.
- "The checks a pull request requires" says none is required yet.

`tests/ci-names.test.ts` holds the paragraph that leaves the Windows cells out of the required list. Its expected sentence follows the new wording, "are deliberately not in the list until DA-45".

**Verification.**
- **The new cells pass.** Velklish/diffalanche#12, head `2070dad`: all 15 checks green. Both new cells passed end to end on their first run: `smoke bun on windows-latest`, and `smoke binary on windows-latest` (`smoke: ./dist/diffalanche-windows-x64.exe passed`). `check-git-null` was green in each.
- **CI-names test.** Its first run on `d7d6fdd` was red: the test still expected "is deliberately not in the list", because I had run it before the doc edit. The next commit fixed that, and the test passes on Node and on Bun.
- **Review.** Approver review of the whole diff, a patterned CI and docs change with no product code. DA-45 now records this as its fourth evidence.

**Documentation in the same pass.** `docs/reference/11-perf.md` ("The job", "The checks a pull request requires"); `docs/backlog/queue/DA-45-windows-verification.md`.

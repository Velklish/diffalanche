# DA-110.6 · Result

**Closed 2026-11-01. Completed.** Native directory lifecycle cases now share one scenario implementation and run in a same-runtime child on macOS/Bun, following the card's authorized standalone-child boundary. Node and other platforms retain in-process coverage. The native adapter, event identities/order,20s waits,60s outer deadline,5000-name Node count, Bun count condition and200MiB heap bound remain. Failure state is captured before cleanup.

**Verification.** Three consecutive ordinary `env -u FORCE_COLOR bun run test:bun` invocations on a87 each passed1255/1255 tests in87files, exit0. Targeted Node16/16 and Bun16/16 passed; four final configured lifecycle probes produced actual child assertion red1 and restored pass0. Independent lifecycle review:0Critical/0Major/0Minor. Earlier full-suite failures, two isolated controls each, comparable603 controls and standalone observations are retained. Their root cause remains UNKNOWN; process isolation is a test workaround, not proof of a production native defect or historical causality. Linux runtime was not rerun in this boundary change; shared scenario predicates are preserved.

**Documentation in the same pass.** docs/reference/05-watcher.md describes the boundary, same native path, original failures, unknown cause and dated three-run result.

Verification candidate `5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e`, implementation measurement source `a87e98927cb171464d3fc4911653412f931ccab7`, authorized run base `279e818b5f9ed4c1c8d07c81f6b92bb2fd5d2e8c`; integrated base603d11b8354786f6fbc2cb318534e4d91a481d45.

| Command | Exit | Result |
|---|---:|---|
| `npx --no-install backslop lint` | 0 | configured lint |
| `bun run lint` | 0 | Biome |
| `bun run typecheck` | 0 | three TypeScript projects |
| `bun run check:comments` | 0 | 0 comment blocks over two lines |
| `bun run test` | 0 | 1279/1279 in 88 files |
| `bun run test:bun` | 0 | 1279/1279 in 88 files |
| `bun run test:ui` | 0 | 170/170 |

The seven configured commands were executed directly and sequentially with PLAYWRIGHT_BROWSERS_PATH=/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/browsers, one owned heavy-runtime lock and matched host permissions. This is seven invoked/seven passed, one configured command not rerun, not an eight-gate backslop workflow. Clean source readback surrounds each command. Raw commands, loads, stdout/stderr hashes and exact SHAs: /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/final-seven.json and its linked logs.

The owner answered the additional quiet-perf request: “Закрепляем текущие результаты, они приемлемые”. Current results are accepted with the known performance deviation. The existing three ordinary `bun run perf` invocations on a87 remain300ms/exit0,302ms/exit1,and RESTORE sample4 timeout60000ms/exit1 with no median (three completed samples301/299/326). No fourth qualification invocation or further optimization followed that decision. Budgets, guards, deadlines, runtime and dependencies are unchanged. Numerical three-inside-budget qualification and8/8gate success are not claimed. See /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/OWNER-ACCEPTED-CURRENT-RESULTS.json and qualification-v3-perf.json.

Implementation/acceptance archive03ef4b9fd5f22fd27ba0a7d1c55e0ddfb412883e and fold603d11b8354786f6fbc2cb318534e4d91a481d45 remain ancestors; no squash or reset through them. No publication.

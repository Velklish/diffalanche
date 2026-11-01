# DA-156 · Result

**Closed 2026-11-01. Completed as a locally accepted stabilization result with the owner's explicit performance deviation.** Fixed stale watcher/sidebar/unanswered test expectations, bounded anchor work to the existing eight-wide executor with input ordering, shared pending work and full failure drain, overlapped independent Git/previous-cache inputs while retaining Git error precedence and the second cache read under the writer lock, and isolated the seven Bun/macOS native lifecycle scenarios. Final documentation and its fresh independent reviews are complete. No deferred feature, new independent minor fix, dependency/runtime upgrade, budget/guard/timeout weakening, push/release/tag was made.

**Verification.** Integration tests3configured probes; bounded reanchor5probes; overlapping-input4probes; finalnative4probes; documentation32probes all have actual semantic red and restored pass in their raw receipts. Independent implementation and final documentation reviews have0Critical/0openMajor;3new independent minors remain registered. Node/Bun/UI final counts and commands are below. DA110.6's own three-run macOS/Bun qualification is closed; DA56.9 andDA56.11 remain open because their numerical qualification was not achieved, despite acceptance of the current integrated result.

**What remains open and what was worked around.** Performance300/302/incompleteRESTORE is accepted, not relabelled successful. RESTORE and historical recreation/native event-loss causes remain UNKNOWN; passing diagnostic overlays do not refute those failures. The Bun child boundary is a test workaround. Historical18-measurement A/B packets each stopped early (loadguard; separately authorized retryRESTOREtimeout) and are inconclusive; they were not combined or rerun. Residual profiling observed context work after mandatory core rejection, but no further optimization was applied after owner acceptance. Original deferred/unimplemented subjects and17registration-only minors remain outside this closure.

**Documentation in the same pass.** DA155 final currency pass and31documentation tests; final measured-state table and its caveats are in11-perf, native workaround/qualification in05-watcher.

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

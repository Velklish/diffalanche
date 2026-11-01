# DA-135 · Make native watcher fault-injection tests independent of capability probing

- **Scope:** [05-watcher](../../reference/05-watcher.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-103
- **Audit priority:** P2
- **Evidence status:** confirmed
- **Previous order:** 1000
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

Three watcher tests inject a native watcher callback but let the real capability probe choose the execution mode. When that probe returns false, the injected callback is never installed and the tests throw before checking takeover or draining.

## Evidence

- src/core/watcher/index.ts:121 selects recursive=options.recursive ?? supportsRecursiveWatch(...); src/core/watcher/tree.ts:71 does not use the native watcher when recursive is false.
- tests/watcher.test.ts:1347-1365,1401-1415,1983-1994 inject native callbacks without recursive:true, then :1374,1419,1999 invoke Map.get results. The same file already forces recursive:true in its main beforeAll at :333.
- The audit unit run at 087d3330128f8762ff88b0a9f7a7151dca8db028 had four watcher.test.ts failures: three undefined callback/Map.get TypeErrors and one unconditional true capability expectation at :1007. Each exact failing test failed twice in isolation; all four also failed on origin/main b5092d2 with the same runtime/dependencies. These are stable measured failures, not established flakes or evidence of a production watcher failure. Parent receipts: /Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/root-commands.jsonl and isolated-exact/baseline logs.

## Work to do

- Force recursive:true in tests whose declared subject is an injected native watcher; assert callback registration before injecting faults.
- Separate a real capability measurement from a platform-independent assertion. Preserve the supported false/fallback path rather than imposing an unconditional true result.
- Keep the takeover, in-flight drain, and fallback assertions; do not fix the suite with broad skips, polling substitution, or larger sleeps.

## Acceptance criteria

- Each native injection case deterministically installs its stub even when a separate real capability probe would return false.
- The capability test records or handles a supported false result explicitly.
- Each of the four exact regressions passes twice separately; native and forced-polling behavior still have distinct meaningful checks.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/watcher.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run each corrected exact test twice consecutively on the same runtime; record complete assertions and exit codes` — notRun

## Deduplication

Related to DA-110.6/110.7/110.5 but not a duplicate: those cards investigate Bun native lifecycle/timing behavior, whereas these test stubs are bypassed before fault injection. Link the cards; do not erase the native production investigation.

## Historical failure receipts

These are the audit measurements at the unchanged source snapshot, not new runs during registration.

```json
[
  {
    "assertion_full": "FAIL  |unit| tests/watcher.test.ts > watching a tree > finds that this runtime's recursive watch really recurses\nAssertionError: expected false to be true // Object.is equality\n\n- Expected\n+ Received\n\n- true\n+ false\n\n ❯ tests/watcher.test.ts:1007:58\n    1005|     // Node from 20.13 and Bun from 1.1 recurse on macOS, Linux, and W…\n    1006|     // runtime that does not is what the probe exists to catch.\n    1007|     expect(await supportsRecursiveWatch(config.dataDir)).toBe(true);\n       |                                                          ^\n    1008|   }, 30_000);\n    1009|\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    "runs": [
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "finds\\ that\\ this\\ runtime's\\ recursive\\ watch\\ really\\ recurses",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-08-1.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "finds\\ that\\ this\\ runtime's\\ recursive\\ watch\\ really\\ recurses",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-08-2.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "finds\\ that\\ this\\ runtime's\\ recursive\\ watch\\ really\\ recurses",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline-08.log"
      }
    ]
  },
  {
    "assertion_full": "FAIL  |unit| tests/watcher.test.ts > a watcher whose watches die under it > rescans the repository the walk took over, and says the runtime gave up once\nTypeError: failures.get(...) is not a function\n ❯ tests/watcher.test.ts:1374:38\n    1372|       // the rescan of the whole repository is the only thing that can…\n    1373|       await writeFile(file, \"export const tookOver = 1;\\n\");\n    1374|       (failures.get(join(root, REPO)) as () => void)();\n       |                                      ^\n    1375|       await until(REPO);\n    1376|       expect(changedIn(REPO)).toBe(true);\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    "runs": [
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "rescans\\ the\\ repository\\ the\\ walk\\ took\\ over,\\ and\\ says\\ the\\ runtime\\ gave\\ up\\ once",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-09-1.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "rescans\\ the\\ repository\\ the\\ walk\\ took\\ over,\\ and\\ says\\ the\\ runtime\\ gave\\ up\\ once",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-09-2.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "rescans\\ the\\ repository\\ the\\ walk\\ took\\ over,\\ and\\ says\\ the\\ runtime\\ gave\\ up\\ once",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline-09.log"
      }
    ]
  },
  {
    "assertion_full": "FAIL  |unit| tests/watcher.test.ts > a watcher whose watches die under it > says the data directory changed when the walk takes over its watch\nTypeError: failures.get(...) is not a function\n ❯ tests/watcher.test.ts:1419:29\n    1417|       // A write made while the watch died is in the walk's baseline, …\n    1418|       // of it from the takeover or from nothing.\n    1419|       (failures.get(dataDir) as () => void)();\n       |                             ^\n    1420|       const deadline = performance.now() + 20_000;\n    1421|       while (changed === 0 && performance.now() < deadline) {\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    "runs": [
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "says\\ the\\ data\\ directory\\ changed\\ when\\ the\\ walk\\ takes\\ over\\ its\\ watch",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-10-1.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "says\\ the\\ data\\ directory\\ changed\\ when\\ the\\ walk\\ takes\\ over\\ its\\ watch",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-10-2.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "says\\ the\\ data\\ directory\\ changed\\ when\\ the\\ walk\\ takes\\ over\\ its\\ watch",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline-10.log"
      }
    ]
  },
  {
    "assertion_full": "FAIL  |unit| tests/watcher.test.ts > closing a watcher > waits for the rescan in flight, so nothing is written after it resolves\nTypeError: failing.get(...) is not a function\n ❯ tests/watcher.test.ts:1999:37\n    1997|     try {\n    1998|       await writeFile(file, \"export const drained = 1;\\n\");\n    1999|       (failing.get(join(root, REPO)) as () => void)();\n       |                                     ^\n    2000|       const deadline = performance.now() + 20_000;\n    2001|       while (changed.length === 0 && performance.now() < deadline) {\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
    "runs": [
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "waits\\ for\\ the\\ rescan\\ in\\ flight,\\ so\\ nothing\\ is\\ written\\ after\\ it\\ resolves",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-11-1.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "waits\\ for\\ the\\ rescan\\ in\\ flight,\\ so\\ nothing\\ is\\ written\\ after\\ it\\ resolves",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/AtiWorkspace/workspace/external/diffalanche",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/isolated-exact-11-2.log"
      },
      {
        "command": [
          "node",
          "node_modules/vitest/vitest.mjs",
          "run",
          "tests/watcher.test.ts",
          "-t",
          "waits\\ for\\ the\\ rescan\\ in\\ flight,\\ so\\ nothing\\ is\\ written\\ after\\ it\\ resolves",
          "--project",
          "unit",
          "--no-cache",
          "--configLoader",
          "runner",
          "--maxWorkers",
          "1",
          "--reporter",
          "verbose"
        ],
        "cwd": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline",
        "exit_code": 1,
        "log": "/Users/kim.p/.bb/thread-storage/diffalanche-audit-20261101/baseline-11.log"
      }
    ]
  }
]
```

## Registration boundary

Audit finding PQA-103; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

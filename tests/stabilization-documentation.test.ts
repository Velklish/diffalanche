import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const corrections = [
  [
    "first unchanged rescan invalidates broadly",
    "docs/reference/05-watcher.md",
    "The read can take in an edit made while it runs, so that edit's rescan finds\nnothing new. When that first rescan leaves the entry and persisted anchors unchanged,\n`onRepositoryChanged` receives no path list: other tasks may still hold any part\nof the old repository. Later unchanged rescans report their paths, so held and\npending documents can compare each accepted burst with their own scope\n([07-server.md](07-server.md)).",
  ],
  [
    "same-bytes saves retain named-scope signals",
    "docs/reference/05-watcher.md",
    "is compared with the cached one, patch by patch. When the entries agree and reconciliation persists no anchor changes,\ncurrent emits no unscoped `diff-changed`, rescan callback or activity line. The repository\ncallback still invalidates matching held and pending documents, and followed\nnamed tasks can receive scoped frames even for a same-bytes save. These path\nsignals do not establish that a named task's content changed.\n`session-changed` is the same kind of answer about metadata:",
  ],
  [
    "repository callback differs from a current change",
    "docs/reference/05-watcher.md",
    "  `diff-changed` when the entry or persisted anchors changed. When both are\n  unchanged, it still reports the repository callback and can notify matching named scopes, without refreshing\n  current. The first unchanged rescan after `current` moves omits the path list\n  for broad document invalidation; later unchanged rescans include the reported\n  paths. The move's read may already hold an edit that another task has not read.",
  ],
  [
    "ignore lookup cost names the outside-repository case",
    "docs/reference/05-watcher.md",
    "The price of the outside-repository case is one `git check-ignore` per burst for repositories the",
  ],
  [
    "same-bytes current silence does not suppress named scopes",
    "docs/reference/05-watcher.md",
    "   announces it. A save that leaves both content and persisted anchors unchanged emits no\n   unscoped current\n   `diff-changed` on either runtime; named-scope notifications remain separate.",
  ],
  [
    "server separates first broad and later scoped invalidation",
    "docs/reference/07-server.md",
    "left to drop it. The first rescan after a move that leaves the entry and persisted anchors\nunchanged therefore calls\n`onRepositoryChanged` without paths, invalidating other tasks' documents across\nthat repository ([05-watcher.md](05-watcher.md)). This broad invalidation costs\nonce per repository per move. Later unchanged rescans carry paths and invalidate\nonly documents whose scope intersects the signal. An unchanged current entry with no persisted anchor changes\nproduces no unscoped current frame, rescan callback or activity line; matching\nfollowed named tasks can still receive scoped frames, including for a same-bytes\nsave. An absorbed edit can arrive after the move's read ended, so notification\ntime cannot establish whether that read included it.",
  ],
  [
    "held documents intersect notification paths",
    "docs/reference/07-server.md",
    "**A repository signal arrived.** The watcher reports accepted repository paths,\neven when current's entry is unchanged ([05-watcher.md](05-watcher.md)).\nThe server drops held documents whose scope intersects those paths, decided\nfrom the scope each document carries with no disk read. A signal without paths\nor for a repository control path applies to the whole repository.",
  ],
  [
    "watcher callback documents unchanged-entry signals",
    "src/core/watcher/index.ts",
    "/** A repository signal for other tasks: paths can invalidate their documents even when\n   * current's entry is unchanged; no paths means the whole repository (05-watcher.md). */",
  ],
  [
    "cache-write callback describes changed current entries",
    "src/core/watcher/index.ts",
    "// Current's rescan callback, event and activity precede the cache write when its entry or\n    // persisted anchors changed; the unchanged path still informs other tasks (05-watcher.md).",
  ],
  [
    "rescan callback does not claim global silence",
    "src/core/watcher/index.ts",
    "// This callback reports changed entry or anchor state; the unchanged branch still reports\n      // paths for other tasks without announcing a current change (05-watcher.md).",
  ],
  [
    "first rescan comment distinguishes later paths",
    "src/core/watcher/index.ts",
    "// The first unchanged rescan after a move invalidates the whole repository for other tasks;\n    // later signals retain paths even when current's entry stays unchanged (05-watcher.md).",
  ],
  [
    "anchor work is bounded and failed work drains",
    "docs/reference/04-domain.md",
    "either Git mapping or unique text matching can move a comment.\n\nRepositories are processed sequentially. Within one repository, at most eight\neligible comments compute their proposals at once. Reads, mappings and pending\npatch computations are shared for that pass; a pending patch is stored before\nawaiting its driver configuration. Results retain the input comment order.\nA failed pass finishes all its comment work before throwing the first error in\nthat order, and persists no proposals. The existing single guarded write runs\nonly after every repository has finished successfully.",
  ],
  [
    "rescan inputs overlap and cache is reread under lock",
    "docs/reference/05-watcher.md",
    "A repository rescan starts its Git read and previous-cache read together. Both\nfinish before reconciliation begins or either error escapes; the Git error has\nprecedence when both fail. This early cache supplies legacy anchor history.\nThe cache used for the patch is read again, compared and written under the\nsession's lock. Reusing the earlier snapshot here would overwrite what the CLI\nwrote in between.",
  ],
  [
    "event table includes followed named path signals",
    "docs/reference/05-watcher.md",
    "| `diff-changed` | `{ repo, files, session }` | current's repository entry or persisted anchors changed, or a path signal targets a followed named task whose scope intersects it; `files` are notification paths, not the new change set's files, and are **empty** when a fallback walk or session read names no path |",
  ],
  [
    "changelog describes bounded anchor reads and retained lock",
    "CHANGELOG.md",
    "### Fixed\n\n- Reviews with many line comments reconcile independent anchors concurrently,\n  with a limit of eight comments per repository. Failed passes finish their\n  reads before returning and persist no partial anchor changes. Repository\n  rescans also overlap the Git read with the previous-cache read while retaining\n  the cache reread under the writer lock.\n\n- Directory watches retain child names",
  ],
  [
    "native lifecycle child boundary preserves uncertainty",
    "docs/reference/05-watcher.md",
    "## What the unit tests hold\n\nOn macOS under Bun, the seven directory lifecycle scenarios in\n`tests/watch-tree.test.ts` run through\n`tests/helpers/native-directory-child.ts` in separate Bun processes. The\nscenarios live once in `tests/helpers/native-directory-cases.ts`; Node and\nother platforms execute that same code in process. Each child uses the same\ncapability probe and per-directory native adapter. Event order, replacement,\ncheckout, removal, fallback and heap assertions retain their original bounds,\nincluding the 20 s waits and the outer 60 s deadline.\n\nThis boundary follows two ordinary full-suite failures on 2026-11-01:\n`1bfb4badfc2fd71c74d60e94e5a1d7d1feecc140` did not hear\n`kept/after.ts`; after isolating that case,\n`ac0fe0247e4105ad04c18fd4111de911a64c992d` did not hear\n`made/deep/later.ts`. Each failed case passed two isolated repetitions and\nits integration-base control. Standalone Bun removal and creation each passed\ntwenty cases; bounded instrumented diagnostics also passed. Those passes do\nnot establish the cause of the full-suite failures. Process isolation is a\ntest workaround, not evidence that a native production defect was found or fixed.\n",
  ],
  [
    "burst counts differ by runtime",
    "docs/reference/05-watcher.md",
    "with the strict 5000-name assertion on Node and at least one burst name on Bun.\nA separate new-directory burst case",
  ],
  [
    "search status storage differs from its tag",
    "docs/reference/08-ui.md",
    "names. Schema 3 carries `orphaned` comments; search still tags them\n`comment`, without a separate status tag.",
  ],
  [
    "dated perf results preserve failed qualification",
    "docs/reference/11-perf.md",
    "**Development-machine readings on 2026-11-01.** The current implementation\n`a87e98927cb171464d3fc4911653412f931ccab7` was measured on the 8-core Apple\nM1 Pro, Darwin 27 arm64, Bun 1.3.14, Node v25.2.1 and Chromium 1243.\nThree ordinary `bun run perf` invocations used\n`PLAYWRIGHT_BROWSERS_PATH=/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/browsers`,\nwith the original load guard, budgets and deadlines. Each reading is the median\nof five complete measurements; an interrupted invocation has no median.\n\n| Invocation | Update median | Exit | One/five-minute load before → after | Outcome |\n|---|---|---|---|---|\n| 1 | 300 ms | 0 | 35.21/27.80 → 9.34/18.33 | waited 125 s; measurement admitted at 6.44/19.73; 7/7 budgets |\n| 2 | 302 ms | 1 | 9.34/18.33 → 8.27/16.50 | five complete measurements; 6/7 budgets |\n| 3 | not measured | 1 | 8.27/16.50 → 3.38/12.60 | three complete measurements, then RESTORE timed out at 60000 ms in sample 4 |\n\nThe third invocation retained update samples 301, 299 and 326 ms. These results\ndo not satisfy three consecutive complete invocations inside the 300 ms budget.\nThey do not establish that host load caused the timeout or compare the current\nimplementation with the historical container baseline. The 300 ms budget is\nunchanged. A separate diagnostic run completed all five restores; that does not\nrefute the ordinary timeout or establish its cause.\n\nCPU per frame over the same nine points is 8.5 to 9.1 with no trend, which says",
  ],
  [
    "dated full Bun qualification preserves unknown cause",
    "docs/reference/05-watcher.md",
    "On 2026-11-01, `env -u FORCE_COLOR bun run test:bun` completed three\nconsecutive ordinary runs on macOS 27 arm64, Bun 1.3.14, at\n`a87e98927cb171464d3fc4911653412f931ccab7`. Each passed 1255/1255 tests in\n87 files, exit 0. This qualifies that source's full Bun suite; it does not\nidentify the cause of the earlier unheard directory events.\n\n**`tests/watch-tree.test.ts` holds native directory lifecycle behavior.**",
  ],
  [
    "stream task parameter filters targeted diffs",
    "docs/reference/07-server.md",
    "**The parameter registers the task and selects targeted diff delivery.**\nComment and other unscoped frames remain broadcast; the page drops comment\nframes for other tasks. Session-targeted `diff-changed` frames are filtered by\nthe server for live delivery and replay. The server keeps one replay ring and\none global sequence of ids. A connection may skip ids belonging to other tasks;\n`Last-Event-ID` is compared with the global ring bounds\n([The live stream](#the-live-stream)).",
  ],
  [
    "UI stream documentation retains server filtering",
    "docs/reference/08-ui.md",
    "Comment frames remain broadcast and are filtered by the page.\nSession-targeted `diff-changed` frames are filtered by the server for both live\ndelivery and replay; the ring and id sequence stay global.",
  ],
  [
    "Phase 3 implementation differs from acceptance",
    "docs/ROADMAP.md",
    "4. **Phase 3 — precision.** Comments survive code edits through re-anchoring; lost anchors become `orphaned` with a model proposal; go to definition through a configured language server; Windows verified. Automatic Git/text re-anchoring and `orphaned` status are implemented. Model proposals and their UI, LSP navigation and Windows verification remain deferred; Phase 3 acceptance remains open.",
  ],
  [
    "anchor-only changes publish and write the cache",
    "docs/reference/05-watcher.md",
    "own: no cache write or handover occurs when the recomputed entry equals the\ncached one and reconciliation persisted no anchor changes. If only anchor state\nchanged, the rescan still publishes Ready, the current diff event and activity,\nand writes the cache. The new change set is handed over before that write.",
  ],
] as const;

it.each(corrections)("documents %s", (_contract, file, statement) => {
  const normalize = (text: string) => text.replace(/\s+/g, " ");
  expect(normalize(readFileSync(file, "utf8"))).toContain(normalize(statement));
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const corrections = [
  [
    "first unchanged rescan invalidates broadly",
    "docs/reference/05-watcher.md",
    "The read can take in an edit made while it runs, so that edit's rescan finds\nnothing new. When that first rescan finds an unchanged entry,\n`onRepositoryChanged` receives no path list: other tasks may still hold any part\nof the old repository. Later unchanged rescans report their paths, so held and\npending documents can compare each accepted burst with their own scope\n([07-server.md](07-server.md)).",
  ],
  [
    "same-bytes saves retain named-scope signals",
    "docs/reference/05-watcher.md",
    "is compared with the cached one, patch by patch. When they agree, current emits\nno unscoped `diff-changed`, rescan callback or activity line. The repository\ncallback still invalidates matching held and pending documents, and followed\nnamed tasks can receive scoped frames even for a same-bytes save. These path\nsignals do not establish that a named task's content changed.\n`session-changed` is the same kind of answer about metadata:",
  ],
  [
    "repository callback differs from a current change",
    "docs/reference/05-watcher.md",
    "  `diff-changed` when the entry changed. An unchanged entry still reports the\n  repository callback and can notify matching named scopes, without refreshing\n  current. The first unchanged rescan after `current` moves omits the path list\n  for broad document invalidation; later unchanged rescans include the reported\n  paths. The move's read may already hold an edit that another task has not read.",
  ],
  [
    "ignore lookup cost names the outside-repository case",
    "docs/reference/05-watcher.md",
    "The price of the outside-repository case is one `git check-ignore` per burst for repositories the",
  ],
  [
    "same-bytes current silence does not suppress named scopes",
    "docs/reference/05-watcher.md",
    "   announces it. A save with the same bytes emits no unscoped current\n   `diff-changed` on either runtime; named-scope notifications remain separate.",
  ],
  [
    "server separates first broad and later scoped invalidation",
    "docs/reference/07-server.md",
    "left to drop it. The first unchanged rescan after a move therefore calls\n`onRepositoryChanged` without paths, invalidating other tasks' documents across\nthat repository ([05-watcher.md](05-watcher.md)). This broad invalidation costs\nonce per repository per move. Later unchanged rescans carry paths and invalidate\nonly documents whose scope intersects the signal. An unchanged current entry\nproduces no unscoped current frame, rescan callback or activity line; matching\nfollowed named tasks can still receive scoped frames, including for a same-bytes\nsave. An absorbed edit can arrive after the move's read ended, so notification\ntime cannot establish whether that read included it.",
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
    "// Current's rescan callback, event and activity precede the cache write only when its entry\n    // changed; other tasks also need the unchanged-entry path below (05-watcher.md).",
  ],
  [
    "rescan callback does not claim global silence",
    "src/core/watcher/index.ts",
    "// This callback reports a changed entry; the unchanged branch below still reports paths\n      // for other tasks without announcing a current change (05-watcher.md).",
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
    "| `diff-changed` | `{ repo, files, session }` | current's repository entry changed, or a path signal targets a followed named task whose scope intersects it; `files` are notification paths, not the new change set's files, and are **empty** when a fallback walk or session read names no path |",
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
] as const;

it.each(corrections)("documents %s", (_contract, file, statement) => {
  const normalize = (text: string) => text.replace(/\s+/g, " ");
  expect(normalize(readFileSync(file, "utf8"))).toContain(normalize(statement));
});

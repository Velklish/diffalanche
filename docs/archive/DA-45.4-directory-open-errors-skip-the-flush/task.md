# DA-45.4 · syncDir skips the flush on any error opening the directory, EMFILE and EIO included

- **Scope:** 03-storage
- **Created:** 2026-09-29
- **Parent:** DA-45.3
- **Cost:** minor
- **Previous order:** 1170
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Evidence

Finding discovered while reviewing DA-45.3. `syncDir` in `src/core/storage/atomic.ts` opens the directory with `open(path, "r").catch(() => null)` and skips the flush on a `null`, whatever the error was. That is meant for a platform that will not open a directory at all, but it also swallows `EMFILE`, `EACCES` and `EIO` on Linux and macOS. Scenario, not reproduced: a long-running server runs out of file descriptors, `comment` exits 0, and the directory entry is never flushed. That is the silent loss of durability which 03-storage says must reach the caller.

## Work to do

- Skip only on the codes that mean "a directory cannot be opened here", and let every other open error fail the write, as a failed flush does.

## Execution plan

Storage durability and lock-test track owns atomic.ts, storage-atomic/lock-writers/sessions tests and reference 03. Prefer deterministic filesystem/domain barriers, preserve separate source outcomes and validate hypotheses before changing production locks. Propagate real directory-open durability failures without changing Windows or durable:false policy. Do not implement deferred first-session-directory flush or UI/orphaned features.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

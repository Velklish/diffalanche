# DA-60.4 · The CLI reply's reply-added ran out of 20 s at load 32 and did not come back in 18 loaded runs

- **Scope:** 11-perf, 05-watcher
- **Created:** 2026-09-24
- **Parent:** DA-60.2
- **Cost:** major (hypothesis)
- **Previous order:** 1140
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Evidence

Finding discovered while working on DA-60.2, which named two reds. The first — the
late `settle` of `tests/watcher.test.ts` — was traced and fixed there. The second
was not reproduced:

`tests/events.test.ts > the live stream > carries a reply written by the CLI, and
the activity line with its author`, "Error: no reply-added within 20000 ms", red
once at the acceptance of DA-41 at load 32.5 (DA-60.2's card quotes the record;
not re-run here).

In DA-60.2's probe, 18 full `DIFFALANCHE_TEST_RUNTIME=bun bunx --bun vitest run`
on `55316eb` with the wait raised to 120 s in a probe worktree, under
`/tmp/da-perf.lock` 2026-09-24 03:13–03:40Z, load averages from 5 to 220 when a
run began: the file's own line "reply written to reply-added" printed 8 to 380 ms
every time, and no wait of that file ran past 5 s. The cause of the one red is
unknown; the settle's cause — a lock another test left behind — is not in this
file, which has no `chmod`.

## Earlier return condition

Nothing until it comes back: since DA-60.2 a wait of `tests/events.test.ts` that
runs out at its 20 s is kept, and the file reports at its end when a frame of that
name came, or that none did ([11-perf.md](../../reference/11-perf.md#waits-in-the-suites)).
The next red therefore says late or never, and which of the two it is decides the
next step: a deadline question for 11-perf, or a frame the watcher or the CLI lost.

## Audit follow-up — 2026-11-01

### Context

DA-60.4 records one historical CLI reply timeout without an established cause. A newly identified source-level interleaving could lose an already received frame in the test reader; it is not proven to explain that historical failure.

### Evidence

- tests/events.test.ts:106 snapshots frames.length when next() is called, then only searches frames added after that index.
- At :257-272 the test awaits the CLI reply process before calling next("reply-added"). The storage write and SSE delivery can finish before the child exits, so a frame already in frames is excluded.
- DA-60.4 already tracks exactly this CLI reply reply-added timeout: one historical 20s failure and 18 loaded reproductions without recurrence. The current audit did not observe a matching timeout.

### Work to do

- Test this concrete interleaving hypothesis without treating it as the established cause of the historical timeout.
- Add a deterministic local reader test where the relevant frame arrives before the triggering Promise resolves. If confirmed, establish the cursor/waiter before the write and match the reply/comment identity.
- Preserve real event-loss detection; do not merely increase deadlines or return an unrelated previous frame.

### Acceptance criteria

- The deterministic early-arrival case distinguishes the current reader from the corrected ordering.
- The reply test accepts its own frame whether it arrives before or after child exit and still fails when that frame never arrives.
- The card continues to label historical causality as unknown unless separately measured.

### Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/events.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run the deterministic early-frame case and the exact CLI reply test separately` — notRun

### Deduplication

Exact subject duplicate of docs/backlog/minor/DA-60.4-*.md. Update the existing hypothesis; retain its historical measurements and unknown cause.

### Registration boundary

Audit finding PQA-105; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

### Next step

The owner approves this follow-up separately before implementation. Existing status and unrelated scope remain unchanged.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.

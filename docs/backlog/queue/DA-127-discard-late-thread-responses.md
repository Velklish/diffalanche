# DA-127 · Discard a late thread response after switching review tasks

- **Order:** 930
- **Scope:** [08-ui](../../reference/08-ui.md); [05-watcher](../../reference/05-watcher.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-206
- **Audit priority:** P1
- **Evidence status:** confirmed_probe


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

A thread event from task A can begin an asynchronous read before the window switches to task B. Filtering the event before the read does not prevent its response from updating the new task.

## Evidence

Source:

- `src/ui/live.ts:94-101,177-185`
- `src/ui/store.ts:1460-1469`
- `tests/ui-stream.test.ts:30-56`
- `docs/backlog/minor/DA-55.12-switch-drops-frames-before-document.md`

Observed: The audit Bun probe used real startLive and store with fake EventSource and a deferred fetch. After switching state A to B, resolving A inserted its comment into B; exit 0.

Limits: Controlled store/stream probe, not a full browser E2E; event frequency is unmeasured.

## Work to do

Bind each thread read and subsequent patch/toast to the originating window task generation, including current mode. Preserve the stream queue and valid updates. Coordinate with DA-55.12, which covers the reverse direction of dropped new-task frames.

## Acceptance criteria

- Late comment-added, reply-added and comment-status reads from A do not alter B or raise a stale toast.
- A→B→A does not accept the response from the earlier A generation.
- Current-task events still update their thread and counters, including windows following current.

## Verification

Proposed implementation checks, not run during registration:

- Add deferred-fetch regression tests for A→B and A→B→A in tests/ui-stream.test.ts; cover all three event kinds and current mode.
- Run npx --no-install vitest run tests/ui-stream.test.ts and the repository gates after implementation.

## Related work

- DA-55.12 is related but covers new-task frames dropped before its document arrives; it is not the same interleaving.

## Registration boundary

Audit finding PQA-206; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

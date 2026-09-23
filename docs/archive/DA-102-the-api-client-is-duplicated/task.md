# DA-102 · The API client is duplicated between the store and the live module

- **Order:** 570
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The defect that survives verification is narrower than the title: it is not that the whole HTTP client is copied, but that the two throwing fetches in [src/ui/live.ts](../../../src/ui/live.ts) drop the server's refusal body on the floor and report the status code instead, while every throwing fetch in `store.ts` reads the body. One API, two conventions for the same refusal, and the one the reader meets during a live update is the lossy one.

The store owns the convention. `refusal()` parses `{ error, message, comments }` and falls back to the status code only when the body is not that shape:

[src/ui/store.ts:1624-1640](../../../src/ui/store.ts)

```ts
async function refusal(response: Response): Promise<Refusal> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown; comments?: unknown };
    const code = typeof body.error === "string" ? body.error : null;
    const comments = Array.isArray(body.comments) ? (body.comments as string[]) : [];
    if (typeof body.message === "string" && body.message !== "") {
      return { code, message: body.message, comments };
    }
    return { code, message: `the server answered ${response.status}`, comments };
```

It is used at every store fetch that throws — `grep -n "refusal(response)" src/ui/store.ts` gives 532, 613, 687, 730, 816, 983, 1236, 1268, 1440, 1663 — and it is a module-local `function`, not exported. `live.ts` does the other thing at its two throwing sites:

[src/ui/live.ts:144-149 and 166-169](../../../src/ui/live.ts)

```ts
  const response = await fetch(onTask(`/api/repos/${repo}/diff`));
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `the diff of ${repo} could not be read: the server answered ${response.status}`,
    );
  }
```

```ts
  const response = await fetch(onTask(`/api/comments/${id}`));
  if (!response.ok) {
    throw new Error(`the thread ${id} could not be read: the server answered ${response.status}`);
  }
```

Both land in the toast: the queue in `startLive` catches whatever a task throws and calls `store().setToast(...)` ([src/ui/live.ts:46-51](../../../src/ui/live.ts)).

There is a real message behind the status code to lose. `GET /api/comments/:id` calls `getComment` directly ([src/server/app.ts:157-164](../../../src/server/app.ts)), and [src/server/errors.ts:107-109](../../../src/server/errors.ts) turns a `StorageError` into `c.json<ErrorBody>({ error: "storage", message: error.message }, 500)` — a message that names the file and the field. A hand-edited `comments.json` is exactly that case, and the watcher noticing that edit is what triggers the live fetch in the first place, so the reader sees "the thread c-7 could not be read: the server answered 500" where the same refusal through a store action would have said which file is malformed and where.

Part of the finding does not survive and is not in this task: `readActivity` at [src/ui/live.ts:133-134](../../../src/ui/live.ts) returning silently on `!response.ok` is not a divergence. The store handles its own background GETs the same way — `if (!response.ok) return;` at `store.ts:556` (`/api/config`), `1198` (`/api/scan`) and `1223` (`/api/sessions`). A feed that does not load is not something to put a toast in front of the reader for.

Nothing blocks the fix: `live.ts:18` already imports `{ onTask, useStore }` from `./store.ts`, so the only obstacle is that `refusal` has no `export` keyword. Neither [ADR-005](../../adr/adr-005-live-update.md) nor the module header claims the divergence is deliberate, and `store.ts:1616-1621` cites [07-server.md](../../reference/07-server.md) as the source of the refusal shape that `live.ts` does not follow.

## Work to do

- Decide where the refusal reader lives before moving it. The candidates are exporting `refusal` from `store.ts` and importing it in `live.ts`, or lifting it into a small module of its own (`src/ui/api.ts`) that both import. The second is the cleaner direction if more clients appear, the first is the change that is actually justified by two call sites today; pick one rather than doing both.
- Use it at `live.ts:146` and `live.ts:167`, keeping the sentence the reader gets: the current wording names the repository and the thread, which a raw server message does not, so the toast should read as "the thread `<id>` could not be read: `<server's message>`" and fall back to the status code when the body is not a refusal — which `refusal()` already does.
- Leave the 404 special case at `diffChanged` alone: it means the repository left the review and is handled by `applyRepositoryDiff(repo, null)`, not by a message.
- Record in [docs/reference/08-ui.md](../../reference/08-ui.md) that every UI fetch that throws reports the server's message, and that background GETs stay silent, so the next fetch added to either module has a rule to follow instead of a neighbour to copy.

## Out of scope

- Splitting `store.ts`. At 1757 lines it is one `create<Store>()` over documented slices that already pushes pure logic to `scope.ts`, `patch.ts`, `base.ts` and `anchor.ts` and imports `countReview` from `src/core/domain/counters.ts` rather than copying it; there is no second responsibility to extract, and this task must not grow into that.
- The silent `/api/activity` fetch, for the reason above.
- The server's own error bodies and status codes — `src/server/errors.ts` is not touched.
- The toast queue and how long a toast stays.

## Verification

- A test in `tests/ui-live.test.ts` with a stubbed `fetch` answering `500` and `{ "error": "storage", "message": "comments.json: …" }` for `/api/comments/:id`: the toast contains the server's sentence, not "the server answered 500". Reverting the `live.ts` change turns it red; asserting only that the toast is non-null would not, since the current code already sets one.
- The same shape for `/api/repos/:repo/diff`, plus the existing 404 behaviour still taking the repository out of the review (`tests/ui-live.test.ts:242`).
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.

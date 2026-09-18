# DA-81 · serve accepts the global --review flag and silently ignores it, while every other command validates it

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`--review <name>` is declared in `GLOBAL` ([src/cli/spec.ts](../../../src/cli/spec.ts):36-40) and merged into every command's parser, so it parses cleanly everywhere. The only thing that reads it is `context.session()` ([src/cli/context.ts](../../../src/cli/context.ts):82-87), which resolves the name and refuses an unknown one. `serve` never calls it:

[src/cli/commands/serve.ts](../../../src/cli/commands/serve.ts):61-73

```ts
noExtra(args, 0);
const config = await context.config();
const server = await startReviewServer({
  config,
  ui: context.ui,
  verbose: flag(args, "verbose"),
});

context.io.out(`diffalanche ${VERSION} on ${server.url}\n${await summary(server)}`);
if (flag(args, "open")) openBrowser(server.url, context.io);
```

`ReviewServerOptions` ([src/server/serve.ts](../../../src/server/serve.ts):18-32) has no session field, `summary()` calls `server.review.document()` with no argument — the current session ([src/server/review.ts](../../../src/server/review.ts):166-167) — and the printed URL is `server.url`, which is `http://127.0.0.1:<port>` with no query.

Reproduced on Node v25.2.1, in a scratch root with one repository and a single session `t1` that is current:

```
$ node --experimental-strip-types src/cli/index.ts serve \
    --review definitely-not-a-session --port 45877 --root <tmp>/root --data-dir <tmp>/dd
STDOUT:
diffalanche 0.1.0 on http://127.0.0.1:45877
  1 repositories, 1 files, 1 changed lines
STDERR: (empty)

$ node --experimental-strip-types src/cli/index.ts list \
    --review definitely-not-a-session --root <tmp>/root --data-dir <tmp>/dd
diffalanche: no review session "definitely-not-a-session"
list exit=1
```

The same name is exit 1 on `list`, `diff`, `show`, `comment` and `export`, and exit 0 with no message on `serve`.

What follows from it is not only the unreported typo. A window on a task that is not current is routine — `review new <name> --no-use` prints `http://127.0.0.1:<port>/?review=<name>` ([src/cli/commands/review.ts](../../../src/cli/commands/review.ts):139) precisely so an agent can hand a human a link without moving `current` ([ADR-010](../../adr/adr-010-review-task-scope.md)). `serve --review t2 --open` reads as the same gesture and is not: `--open` opens `server.url`, so the browser lands on whatever `current` points at, and the counters printed under the address are that other task's. The server itself is not the obstacle — `review.document(session?)` takes a name ([review.ts](../../../src/server/review.ts):166-167) and the routes already take the task per request as `?review=` ([src/server/app.ts](../../../src/server/app.ts):119).

The documentation is split on whether this is a hole or a carve-out. [06-cli.md](../../reference/06-cli.md):92-99 introduces the table of global flags with "Every command takes these", and `--review <name>` is its first row; the only command documented as reading no session is `version`. Eight lines further down, [06-cli.md](../../reference/06-cli.md):119-121 describes `serve` as reading "the change set of the current session against that session's base" — which is what the code does, and which no reader of the flag table would take as an exception to it.

## Work to do

- Decide, first, which of the two `serve --review t2` should mean, and write the decision down where the flag is documented. The candidates are: (a) honour it as the window the server opens on — resolve the name through `context.session()`, pass it into `startReviewServer` as the initial task, print `?review=<name>` in the address and open that, leaving `current` alone; or (b) refuse it — `serve` serves every task and the task is chosen per request, so a name on the command line is a usage error like an unknown flag. Option (a) has to answer what the server does when the watcher follows a different session, which is [DA-55.1-watcher-follows-one-session.md](../queue/DA-55.1-watcher-follows-one-session.md)'s subject; option (b) is smaller and costs an agent the one-command gesture.
- Whichever is chosen, the name must be validated before the socket opens: today a misspelling reaches no code that could notice it.
- If (a): the summary line under the address must be that task's counters, not `current`'s, and `--open` must open the URL that was printed rather than a second one built from `server.url`.
- If (b): the refusal belongs with the other usage refusals of [src/cli/errors.ts](../../../src/cli/errors.ts) and must say what to do instead — the `?review=` link, or `review use`.
- Update the global-flags section of [06-cli.md](../../reference/06-cli.md) so the exception, in whichever direction, is stated in the table rather than implied by a paragraph about something else, and align the same claim in `README.md`.

## Out of scope

- Which session the watcher follows while the server runs. That is one session today regardless of what the page asks for, and it is [DA-55.1-watcher-follows-one-session.md](../queue/DA-55.1-watcher-follows-one-session.md).
- Giving the CLI a way to set a scope on a session, [DA-53.1-cli-cannot-set-a-scope.md](DA-53.1-cli-cannot-set-a-scope.md).
- The other things `serve` does not survive: an unreadable data directory is [DA-64-serve-exits-on-unreadable-data.md](../../archive/DA-64-serve-exits-on-unreadable-data/task.md), a refused port is [DA-71-refused-port-exits-2-with-a-stack.md](DA-71-refused-port-exits-2-with-a-stack.md).

## Verification

- A CLI test asserting the chosen behaviour for an unknown name: exit 1 with `no review session "…"` on stderr under either option, since (a) validates through `context.session()` and (b) refuses outright. Removing the resolution makes it red.
- Under (a), a test on the printed line: with `--review t2` the address carries `?review=t2` and the counters are t2's, not the current session's. A second session whose totals differ from the current one's is what makes that assertion able to fail.
- The reference and `README.md` say the same thing as the code about which commands read `--review`.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.

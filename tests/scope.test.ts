/**
 * The scope of a review task (DA-53): what the CLI writes, what it answers
 * inside, and what it refuses. The fixture is the small synthetic review —
 * three repositories — so a scope over one of them and one file of another is
 * the case the card is written against.
 *
 * `run` is called in process, the way `tests/cli.test.ts` does it: it is what
 * both delivery channels call and what returns the exit code.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { run } from "../src/cli/run.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import {
  addComment,
  DomainError,
  get,
  list,
  reopen,
  reply,
  resolve,
} from "../src/core/domain/index.ts";
import type { DiffCache, Review } from "../src/core/storage/index.ts";
import {
  commentsPath,
  readComments,
  readCurrent,
  readDiffCache,
  readReview,
  reviewPath,
  updateComments,
} from "../src/core/storage/index.ts";
import type { ReviewDocument } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createEventStream } from "../src/server/events.ts";
import type { CandidateSet } from "../src/server/review.ts";
import { createReviewService } from "../src/server/review.ts";
import { untouched } from "./helpers/untouched.ts";

const noUi: UiAssets = { read: async () => null };

/** The three repositories the small profile generates, in the order it names them. */
const WHOLE = "repos/core/cargos-api";
const PARTIAL = "repos/platform/loads-search";
const THIRD = "repos/services/quotes-worker";

let root: string;
let config: Config;
/** One file of `PARTIAL` that really has changes: the `--path` of the card. */
let onePath: string;

type Result = { code: number; out: string; err: string };

/** git in a repository of the fixture: the test may write there, the tool may not. */
function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function cli(...argv: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const code = await run([...argv, "--root", root], noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** The change set as `diff --json` prints it, parsed. */
async function diffJson(...argv: string[]): Promise<DiffCache> {
  const result = await cli("diff", "--json", ...argv);
  expect(result, result.err).toMatchObject({ code: 0 });
  return JSON.parse(result.out) as DiffCache;
}

function paths(cache: DiffCache): Record<string, string[]> {
  return Object.fromEntries(
    cache.repositories.map((repository) => [
      repository.path,
      repository.files.map((file) => file.path).sort(),
    ]),
  );
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-scope-"));
  generate({ out: root, seed: 23, profile: PROFILES.small });
  config = await loadConfig({ root });
  const whole = await diffJson();
  const partial = whole.repositories.find((one) => one.path === PARTIAL);
  onePath = partial?.files[0]?.path as string;
  expect(onePath, "the fixture has no file in the partial repository").toEqual(expect.any(String));
}, 180_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a task with a scope", () => {
  beforeEach(async () => {
    // The generator leaves `synth` current; every test starts from that.
    await cli("review", "use", "synth");
  });

  it("is created without moving current, and prints its address", async () => {
    const created = await cli(
      "review",
      "new",
      "t1",
      "--repo",
      WHOLE,
      "--path",
      `${PARTIAL}:${onePath}`,
      "--no-use",
    );
    expect(created, created.err).toMatchObject({ code: 0 });
    expect(await readCurrent(config.dataDir)).toBe("synth");
    expect(created.out).toContain(`/?review=t1`);

    const review = await readReview(config.dataDir, "t1");
    expect(review.scope).toEqual([
      { repo: WHOLE, paths: null },
      { repo: PARTIAL, paths: [onePath] },
    ]);
    expect(review.status).toBe("open");
  });

  it("answers with the repositories and the files it is about, and nothing else", async () => {
    await cli(
      "review",
      "new",
      "t2",
      "--repo",
      WHOLE,
      "--path",
      `${PARTIAL}:${onePath}`,
      "--no-use",
    );
    const whole = await diffJson();
    const scoped = await diffJson("--review", "t2");

    expect(Object.keys(paths(scoped)).sort()).toEqual([WHOLE, PARTIAL].sort());
    expect(paths(scoped)[WHOLE]).toEqual(paths(whole)[WHOLE]);
    expect(paths(scoped)[PARTIAL]).toEqual([onePath]);
    expect(scoped.totals.repositories).toBe(2);

    // And the cache holds exactly what was answered: the next reader of the
    // task — the UI, or a `comment` capturing an anchor — sees the same set.
    const cache = await readDiffCache(config.dataDir, "t2");
    expect(cache?.scope).toEqual([
      { repo: WHOLE, paths: null },
      { repo: PARTIAL, paths: [onePath] },
    ]);
    expect(Object.keys(paths(cache as DiffCache)).sort()).toEqual([WHOLE, PARTIAL].sort());
  });

  it("refuses a repository the root has not, and a path that leaves its repository", async () => {
    const missing = await cli("review", "new", "t3", "--repo", "repos/nope", "--no-use");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no repository "repos/nope" under the root');

    const escaping = await cli(
      "review",
      "new",
      "t3",
      "--path",
      `${WHOLE}:../outside.txt`,
      "--no-use",
    );
    expect(escaping.code).toBe(1);
    expect(escaping.err).toContain("is not a path inside");
  });

  it("refuses `diff --repo` on a repository it is not about", async () => {
    await cli("review", "new", "t4", "--repo", WHOLE, "--no-use");
    const outside = await cli("diff", "--review", "t4", "--repo", THIRD);
    expect(outside.code).toBe(1);
    expect(outside.err).toContain("in the scope of review session");
  });

  it("refuses a comment outside it, naming what the task is about", async () => {
    await cli("review", "new", "t5", "--repo", WHOLE, "--no-use");
    const outside = await cli(
      "comment",
      "--review",
      "t5",
      "--repo",
      THIRD,
      "--severity",
      "nit",
      "--body",
      "not this task",
    );
    expect(outside.code).toBe(1);
    expect(outside.err).toContain("is not in the scope of review task");
    expect(outside.err).toContain(WHOLE);
    expect(await list(config.dataDir, "t5")).toEqual([]);

    const inside = await cli(
      "comment",
      "--review",
      "t5",
      "--repo",
      WHOLE,
      "--severity",
      "nit",
      "--body",
      "this one is in",
    );
    expect(inside, inside.err).toMatchObject({ code: 0 });
  });

  it("shows a file and takes a comment on it under the same name, a rename included", async () => {
    // The one rule, seen from both sides: the scope names paths, and a path it
    // does not name is neither shown nor written on. A renamed file is at a
    // name the scope has not, so the task shows nothing for it — decision 5,
    // the answer a path with no changes gets — and refuses the comment on it,
    // which is the same answer rather than a second one.
    //
    // The rename is made from a file committed here rather than from one the
    // generator wrote: a fixture file carries an edit as well, and whether git
    // then calls the pair a rename or a delete and an addition depends on how
    // much of it the generator rewrote. This one is a pure rename, always.
    const before = "scoped-before.py";
    const after = "scoped-after.py";
    const repository = join(root, PARTIAL);
    writeFileSync(join(repository, before), "def scoped():\n    return 1\n");
    git(repository, ["add", before]);
    git(repository, [
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=fixture",
      "commit",
      "-qm",
      "a file for the rename",
    ]);

    try {
      await cli("review", "new", "t5r", "--path", `${PARTIAL}:${before}`, "--no-use");
      git(repository, ["mv", before, after]);
      // The change set has the rename under its new name; the task, which named
      // the old one, shows nothing of that repository at all.
      const wholeRoot = await diffJson();
      expect(
        wholeRoot.repositories
          .find((one) => one.path === PARTIAL)
          ?.files.find((one) => one.path === after),
      ).toMatchObject({ oldPath: before, status: "renamed" });
      expect(paths(await diffJson("--review", "t5r"))[PARTIAL]).toBeUndefined();

      // The new name is not one the task holds, so it is refused — what the
      // task does not show, it does not take a comment on.
      const refused = await addComment(config.dataDir, "t5r", {
        repo: PARTIAL,
        path: after,
        severity: "nit",
        body: "on a file the task does not show",
        author: "claude",
        role: "agent",
      }).catch((error: unknown) => error);
      expect((refused as DomainError).code).toBe("out-of-scope");

      // The old name is still what the task is about, and a task keeps a path
      // that has nothing to show (decision 5), so a comment on it is taken and
      // read back.
      const kept = await addComment(config.dataDir, "t5r", {
        repo: PARTIAL,
        path: before,
        severity: "nit",
        body: "the path the task named",
        author: "claude",
        role: "agent",
      });
      expect(kept.path).toBe(before);
      expect((await list(config.dataDir, "t5r")).map((one) => one.path)).toEqual([before]);
    } finally {
      // The fixture goes back to what it was: the file is committed, so putting
      // the name back leaves the repository clean of it again.
      git(repository, ["mv", after, before]);
    }
  });

  it("gives one answer for a comment outside it, whichever command asks", async () => {
    await cli("review", "new", "t5o", "--repo", WHOLE, "--no-use");
    // Nothing the tool offers writes a comment outside the scope; this is the
    // `comments.json` edited by hand that `06-cli.md` names, made here through
    // storage so the domain never sees it written.
    await updateComments(config.dataDir, "t5o", (comments) => {
      comments.push({
        id: "c_handed",
        repo: THIRD,
        path: null,
        side: null,
        line: null,
        endLine: null,
        anchor: null,
        severity: "warning",
        status: "open",
        author: "kim.p",
        role: "human",
        body: "written by hand into a task this repository is not in",
        createdAt: "2026-09-01T09:00:00.000Z",
        resolvedAt: null,
        resolvedBy: null,
        replies: [],
      });
    });

    expect(await list(config.dataDir, "t5o")).toEqual([]);
    for (const asks of [
      () => get(config.dataDir, "t5o", "c_handed"),
      () => reply(config.dataDir, "t5o", "c_handed", { body: "x", author: "a", role: "agent" }),
      () => resolve(config.dataDir, "t5o", "c_handed", { author: "kim.p", role: "human" }),
      () => reopen(config.dataDir, "t5o", "c_handed", { author: "kim.p", role: "human" }),
    ]) {
      const refused = await asks().catch((error: unknown) => error);
      expect((refused as DomainError).code).toBe("no-such-comment");
    }
    // And nothing of it was written on the way to those refusals.
    const onDisk = await readComments(config.dataDir, "t5o");
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatchObject({ id: "c_handed", status: "open", replies: [] });
  });

  it("refuses it in the domain as well, for every caller", async () => {
    // The CLI checks the scope before it reads the repository again, so this is
    // the check underneath — the one the HTTP API and anything else goes
    // through. Without it a caller that skipped the CLI could store a comment
    // nothing reads back.
    await cli("review", "new", "t5b", "--repo", WHOLE, "--no-use");
    const refused = await addComment(config.dataDir, "t5b", {
      repo: THIRD,
      severity: "nit",
      body: "not this task either",
      author: "claude",
      role: "agent",
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DomainError);
    expect((refused as DomainError).code).toBe("out-of-scope");
    expect(await list(config.dataDir, "t5b")).toEqual([]);

    // A file of a repository the task holds only some files of is refused the
    // same way, and the whole review — `repo: null` — is always in.
    await cli("review", "new", "t5c", "--path", `${PARTIAL}:${onePath}`, "--no-use");
    const otherFile = await addComment(config.dataDir, "t5c", {
      repo: PARTIAL,
      path: "app/shipment/shipment_249.py",
      severity: "nit",
      body: "another file of the same repository",
      author: "claude",
      role: "agent",
    }).catch((error: unknown) => error);
    expect((otherFile as DomainError).code).toBe("out-of-scope");
    const onReview = await addComment(config.dataDir, "t5c", {
      severity: "question",
      body: "about the task itself",
      author: "claude",
      role: "agent",
    });
    expect(onReview.repo).toBeNull();
  });
});

describe("narrowing a scope", () => {
  it("refuses without consent, names the count, and leaves comments.json byte-identical", async () => {
    await cli(
      "review",
      "new",
      "t6",
      "--repo",
      WHOLE,
      "--path",
      `${PARTIAL}:${onePath}`,
      "--no-use",
    );
    const written = await cli(
      "comment",
      "--review",
      "t6",
      "--repo",
      PARTIAL,
      "--path",
      onePath,
      "--severity",
      "warning",
      "--body",
      "a finding under the path being removed",
    );
    expect(written, written.err).toMatchObject({ code: 0 });
    const unwritten = untouched(commentsPath(config.dataDir, "t6"));

    const refused = await cli(
      "review",
      "scope",
      "remove",
      "--review",
      "t6",
      "--path",
      `${PARTIAL}:${onePath}`,
    );
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("1 comment is anchored under what this removes");
    expect(refused.err).toContain("--drop-comments");
    unwritten();
    expect((await readReview(config.dataDir, "t6")).scope).toHaveLength(2);

    const dropped = await cli(
      "review",
      "scope",
      "remove",
      "--review",
      "t6",
      "--path",
      `${PARTIAL}:${onePath}`,
      "--drop-comments",
    );
    expect(dropped, dropped.err).toMatchObject({ code: 0 });
    expect(await list(config.dataDir, "t6")).toEqual([]);
    // The entry went with its last path: a repository with nothing left to show
    // is not a state the scope has.
    expect((await readReview(config.dataDir, "t6")).scope).toEqual([{ repo: WHOLE, paths: null }]);
  });

  it("widens without asking for consent, and refuses what it cannot do", async () => {
    await cli("review", "new", "t7", "--path", `${PARTIAL}:${onePath}`, "--no-use");
    const widened = await cli("review", "scope", "add", "--review", "t7", "--repo", WHOLE);
    expect(widened, widened.err).toMatchObject({ code: 0 });
    expect((await readReview(config.dataDir, "t7")).scope).toEqual([
      { repo: PARTIAL, paths: [onePath] },
      { repo: WHOLE, paths: null },
    ]);

    // A repository that is in as a whole cannot lose one file: "everything but
    // this" is not an entry the format has.
    const carved = await cli(
      "review",
      "scope",
      "remove",
      "--review",
      "t7",
      "--path",
      `${WHOLE}:some/file.ts`,
    );
    expect(carved.code).toBe(1);
    expect(carved.err).toContain("as a whole repository");

    // And a session with no scope is about the whole root, which is as wide as
    // a task gets.
    const nothing = await cli("review", "scope", "add", "--review", "synth", "--repo", WHOLE);
    expect(nothing.code).toBe(1);
    expect(nothing.err).toContain("no scope");
  });

  it("prints the scope of the session", async () => {
    await cli(
      "review",
      "new",
      "t8",
      "--repo",
      WHOLE,
      "--path",
      `${PARTIAL}:${onePath}`,
      "--no-use",
    );
    const printed = await cli("review", "scope", "--review", "t8", "--json");
    expect(printed, printed.err).toMatchObject({ code: 0 });
    expect(JSON.parse(printed.out)).toEqual({
      name: "t8",
      scope: [
        { repo: WHOLE, paths: null },
        { repo: PARTIAL, paths: [onePath] },
      ],
    });

    const plain = await cli("review", "scope", "--review", "synth");
    expect(plain.out).toContain("the whole root");
  });
});

describe("closing a task", () => {
  it("is a marker and not a lock, and it goes both ways", async () => {
    await cli("review", "new", "t9", "--repo", WHOLE, "--no-use");
    const opened = await cli(
      "comment",
      "--review",
      "t9",
      "--repo",
      WHOLE,
      "--severity",
      "nit",
      "--body",
      "before it closed",
    );
    const id = opened.out.split(" ")[0] as string;

    // A name that is not a session answers about the session, not about the
    // role: the session is looked for first, as it is for `resolve`.
    const mistyped = await cli("review", "close", "t9-typo");
    expect(mistyped.code).toBe(1);
    expect(mistyped.err).toContain('no review session "t9-typo"');

    // Only a human closes a task, the rule `resolve` has had since ADR-004.
    const asAgent = await cli("review", "close", "t9");
    expect(asAgent.code).toBe(1);
    expect(asAgent.err).toContain("only a human may close a review task");
    expect((await readReview(config.dataDir, "t9")).status).toBe("open");

    const closed = await cli("review", "close", "t9", "--role", "human", "--author", "kim.p");
    expect(closed, closed.err).toMatchObject({ code: 0 });
    const review = await readReview(config.dataDir, "t9");
    expect(review).toMatchObject({ status: "closed", closedBy: "kim.p" });
    expect(review.closedAt).toEqual(expect.any(String));

    const listed = await cli("review", "list", "--json");
    const rows = (JSON.parse(listed.out) as { sessions: { name: string; status: string }[] })
      .sessions;
    expect(rows.find((one) => one.name === "t9")?.status).toBe("closed");

    // Closing marks the task; it does not stop anyone writing in it.
    for (const argv of [
      ["reply", id, "--body", "answered after it closed"],
      ["comment", "--review", "t9", "--repo", WHOLE, "--severity", "nit", "--body", "one more"],
      ["resolve", id, "--role", "human", "--author", "kim.p"],
    ]) {
      const result = await cli(...argv, ...(argv[0] === "comment" ? [] : ["--review", "t9"]));
      expect(result, `${argv[0]}: ${result.err}`).toMatchObject({ code: 0 });
    }

    const reopenedByAgent = await cli("review", "reopen", "t9");
    expect(reopenedByAgent.code).toBe(1);
    expect((await readReview(config.dataDir, "t9")).status).toBe("closed");

    const reopened = await cli("review", "reopen", "t9", "--role", "human");
    expect(reopened, reopened.err).toMatchObject({ code: 0 });
    expect(await readReview(config.dataDir, "t9")).toMatchObject({
      status: "open",
      closedAt: null,
      closedBy: null,
    });
  });
});

describe("a session written before the scope existed", () => {
  it("is read as the whole root and open, and is written back as version 2", async () => {
    await cli("review", "new", "t10", "--no-use");
    const path = reviewPath(config.dataDir, "t10");
    const file = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    // A version 1 file: the four fields DA-53 added are not in it at all.
    delete file.scope;
    delete file.status;
    delete file.closedAt;
    delete file.closedBy;
    writeFileSync(path, `${JSON.stringify({ ...file, version: 1 }, null, 2)}\n`);

    const read = await readReview(config.dataDir, "t10");
    expect(read).toMatchObject({ scope: null, status: "open" });

    const based = await cli("review", "base", "head", "--review", "t10");
    expect(based, based.err).toMatchObject({ code: 0 });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(2);
  });
});

describe("the routes the UI reads a task through", () => {
  let app: Hono;

  beforeAll(async () => {
    app = createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
    });
  });

  it("answers a named task with what that task is about", async () => {
    await cli(
      "review",
      "new",
      "t11",
      "--repo",
      WHOLE,
      "--path",
      `${PARTIAL}:${onePath}`,
      "--no-use",
    );
    const response = await app.request("/api/review?review=t11");
    expect(response.status).toBe(200);
    const document = (await response.json()) as ReviewDocument;
    expect(document.session.name).toBe("t11");
    expect(document.repositories.map((one) => one.path).sort()).toEqual([WHOLE, PARTIAL].sort());
    expect(
      document.repositories.find((one) => one.path === PARTIAL)?.files.map((file) => file.path),
    ).toEqual([onePath]);

    // Without the parameter it is still the current session, which is not this
    // task: creating one does not move `current`.
    const current = (await (await app.request("/api/review")).json()) as ReviewDocument;
    expect(current.session.name).toBe("synth");
  });

  it("offers the whole root as candidates, whatever the task is about", async () => {
    const response = await app.request("/api/sessions/candidates");
    expect(response.status).toBe(200);
    const candidates = (await response.json()) as CandidateSet;
    expect(candidates.repositories.map((one) => one.path).sort()).toEqual(
      [WHOLE, PARTIAL, THIRD].sort(),
    );
    // A picker's list: names and counts, no patch and no hunks.
    const first = candidates.repositories[0]?.files[0];
    expect(first).toMatchObject({ path: expect.any(String), status: expect.any(String) });
    expect(first).not.toHaveProperty("patch");
  });

  it("refuses a scope edit that would delete comments, and says how many", async () => {
    await cli("review", "new", "t12", "--repo", WHOLE, "--repo", PARTIAL, "--no-use");
    await cli(
      "comment",
      "--review",
      "t12",
      "--repo",
      PARTIAL,
      "--severity",
      "nit",
      "--body",
      "under the entry being removed",
    );

    const refused = await app.request("/api/sessions/t12/scope", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: [{ repo: WHOLE }] }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "scope-has-comments", count: 1 });
    expect(await list(config.dataDir, "t12")).toHaveLength(1);

    const accepted = await app.request("/api/sessions/t12/scope", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: [{ repo: WHOLE }], dropComments: true }),
    });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as Review).scope).toEqual([{ repo: WHOLE, paths: null }]);
    expect(await list(config.dataDir, "t12")).toEqual([]);
  });

  it("refuses a comment the task is not about", async () => {
    await cli("review", "new", "t12b", "--repo", WHOLE, "--no-use");
    // The write API is the UI's, and it is bounded by the same scope: a comment
    // it stored outside one would be invisible in the review it belongs to.
    await app.request("/api/sessions/t12b/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const refused = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: THIRD, severity: "nit", body: "not this task" }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "out-of-scope" });
    expect(await list(config.dataDir, "t12b")).toEqual([]);
    await cli("review", "use", "synth");
  });

  it("closes and reopens a task", async () => {
    await cli("review", "new", "t13", "--repo", WHOLE, "--no-use");
    const closed = await app.request("/api/sessions/t13/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(closed.status).toBe(200);
    expect((await closed.json()) as Review).toMatchObject({
      status: "closed",
      closedBy: config.user,
    });

    const reopened = await app.request("/api/sessions/t13/reopen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(((await reopened.json()) as Review).status).toBe("open");
  });
});

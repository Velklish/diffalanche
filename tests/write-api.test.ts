/**
 * The write API of DA-17: every write goes through the domain with the name
 * from the configuration and `role: human`, and what it wrote is on disk for
 * the CLI to read a moment later.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { list, readSession } from "../src/core/domain/index.ts";
import type { Comment, Review } from "../src/core/storage/index.ts";
import { readCurrent, readDiffCache } from "../src/core/storage/index.ts";
import type { ReviewDocument } from "../src/core/types.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createReviewService } from "../src/server/review.ts";
import { startReviewServer } from "../src/server/serve.ts";

const run = promisify(execFile);
const appendReply = fileURLToPath(new URL("./helpers/append-reply.ts", import.meta.url));
const SESSION = "synth";
const noUi: UiAssets = { read: async () => null };

let root: string;
let config: Config;
let app: Hono;

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A file and a line the change set really has, so the anchor can be captured. */
async function anchorable(): Promise<{ repo: string; path: string; line: number }> {
  const cache = await readDiffCache(config.dataDir, SESSION);
  for (const repository of cache?.repositories ?? []) {
    for (const file of repository.files) {
      const line = file.hunks[0]?.lines.find((one) => one.newLine !== null);
      if (line?.newLine != null) {
        return { repo: repository.path, path: file.path, line: line.newLine };
      }
    }
  }
  throw new Error("the fixture has no line to anchor to");
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-write-"));
  generate({ out: root, seed: 13, profile: PROFILES.small });
  config = await loadConfig({ root });
  app = createApp({ config, review: createReviewService(config), ui: noUi });
  // The first read of the review is what writes `diff.json`, and a line anchor
  // is captured from it.
  await app.request("/api/review");
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("comments over the API", () => {
  it("writes one signed by the configured user, with the anchor from the change set", async () => {
    const where = await anchorable();
    const response = await post("/api/comments", {
      ...where,
      side: "new",
      severity: "critical",
      body: "the flag is read before it is set",
    });
    expect(response.status).toBe(201);
    const comment = (await response.json()) as Comment;
    expect(comment).toMatchObject({
      repo: where.repo,
      path: where.path,
      line: where.line,
      side: "new",
      severity: "critical",
      status: "open",
      author: config.user,
      role: "human",
    });
    expect(comment.anchor?.lineContent).toEqual(expect.any(String));

    // The same data directory, read again from disk: what the CLI would list.
    const onDisk = await list(config.dataDir, SESSION);
    expect(onDisk.find((one) => one.id === comment.id)).toMatchObject({
      body: "the flag is read before it is set",
      author: config.user,
    });
  });

  it("takes a comment on a repository and on the whole review", async () => {
    const repository = await post("/api/comments", {
      repo: (await anchorable()).repo,
      severity: "nit",
      body: "the whole repository",
    });
    expect(repository.status).toBe(201);
    expect(await repository.json()).toMatchObject({ path: null, line: null, anchor: null });

    const review = await post("/api/comments", { severity: "question", body: "the whole review" });
    expect(await review.json()).toMatchObject({ repo: null, path: null, anchor: null });
  });

  it("replies, resolves with a note, and reopens", async () => {
    const created = (await (
      await post("/api/comments", { severity: "warning", body: "a thread" })
    ).json()) as Comment;

    const replied = (await (
      await post(`/api/comments/${created.id}/replies`, { body: "fixed" })
    ).json()) as Comment;
    expect(replied.replies).toHaveLength(1);
    expect(replied.replies[0]).toMatchObject({ author: config.user, role: "human", body: "fixed" });

    const resolved = (await (
      await post(`/api/comments/${created.id}/resolve`, { note: "verified" })
    ).json()) as Comment;
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: config.user });
    expect(resolved.resolvedAt).toEqual(expect.any(String));
    expect(resolved.replies.at(-1)).toMatchObject({ body: "verified", role: "human" });

    const reopened = (await (
      await post(`/api/comments/${created.id}/reopen`, {})
    ).json()) as Comment;
    expect(reopened).toMatchObject({ status: "open", resolvedBy: null, resolvedAt: null });
  });

  it("refuses what the domain refuses, with the domain's own message", async () => {
    const unknown = await post("/api/comments/c_nope00/replies", { body: "hello" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "no-such-comment" });

    // A line without a file is not an anchor level (`docs/SPEC.md` section 7).
    const anchor = await post("/api/comments", { line: 3, severity: "nit", body: "nowhere" });
    expect(anchor.status).toBe(400);
    expect(await anchor.json()).toMatchObject({ error: "invalid-anchor" });
  });

  it("refuses a write that came from another page, and one shaped like a form", async () => {
    // The server has no authentication: where a write came from is the check.
    const foreign = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ severity: "nit", body: "from somewhere else" }),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: "forbidden" });

    // A form post needs no permission from this server, so it is refused before
    // the body is read at all.
    const form = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "text/plain", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ severity: "nit", body: "as a form" }),
    });
    expect(form.status).toBe(403);

    // Same origin, and the UI's own request shape, still pass.
    const own = await app.request("http://127.0.0.1:4880/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4880" },
      body: JSON.stringify({ severity: "nit", body: "from the review's own page" }),
    });
    expect(own.status).toBe(201);
  });

  it("takes a body only as JSON, and a verdict with no body at all", async () => {
    // `sec-fetch-site` says this one is the page's own, so it is the content
    // type alone that refuses it rather than the guard before it.
    const plain = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "text/plain", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ severity: "nit", body: "not json enough" }),
    });
    expect(plain.status).toBe(400);
    expect(await plain.json()).toMatchObject({
      error: "invalid-request",
      message: expect.stringContaining("application/json"),
    });

    const created = (await (
      await post("/api/comments", { severity: "warning", body: "closed without a note" })
    ).json()) as Comment;
    // `note` is optional, so no body at all is a verdict too. A write with no
    // body carries no content type either, which is the shape a form has, so it
    // has to say it came from the page — as a browser does on its own.
    const resolved = await app.request(`/api/comments/${created.id}/resolve`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ status: "resolved", replies: [] });
  });

  it("refuses a comment on a repository the root does not have", async () => {
    const response = await post("/api/comments", {
      repo: "repos/core/not-here",
      severity: "nit",
      body: "nowhere",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid-request",
      message: expect.stringContaining("repos/core/not-here"),
    });
  });

  it("refuses what never reaches the domain, saying which field", async () => {
    const severity = await post("/api/comments", { severity: "urgent", body: "wrong" });
    expect(severity.status).toBe(400);
    expect(await severity.json()).toMatchObject({
      error: "invalid-request",
      message: expect.stringContaining("severity"),
    });

    const empty = await post("/api/comments", { severity: "nit", body: "  " });
    expect(await empty.json()).toMatchObject({ error: "invalid-request" });

    const broken = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: "invalid-request" });
  });
});

describe("sessions over the API", () => {
  it("creates one, makes it current, and switches back", async () => {
    const created = await post("/api/sessions", {
      name: "ls-240372",
      base: "branch:origin/develop",
      title: "Cargo flags",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      name: "ls-240372",
      title: "Cargo flags",
      base: { mode: "branch", branch: "origin/develop" },
    });
    expect(await readCurrent(config.dataDir)).toBe("ls-240372");

    const back = await post(`/api/sessions/${SESSION}/use`, {});
    expect((await back.json()) as Review).toMatchObject({ name: SESSION });
    expect(await readCurrent(config.dataDir)).toBe(SESSION);
  });

  it("changes the base, and the change set is read again against the new one", async () => {
    expect((await readDiffCache(config.dataDir, SESSION))?.base).toEqual({ mode: "head" });
    const changed = await put(`/api/sessions/${SESSION}/base`, { base: "branch" });
    expect(await changed.json()).toMatchObject({ base: { mode: "branch" } });
    expect(await readSession(config.dataDir, SESSION)).toMatchObject({ base: { mode: "branch" } });

    // The cache still on disk was computed against HEAD, so it answers a
    // different question and the next read of the review does not trust it.
    expect((await app.request("/api/review")).status).toBe(200);
    expect((await readDiffCache(config.dataDir, SESSION))?.base).toEqual({ mode: "branch" });

    await put(`/api/sessions/${SESSION}/base`, { base: "head" });
    await app.request("/api/review");
    expect((await readDiffCache(config.dataDir, SESSION))?.base).toEqual({ mode: "head" });
  });

  it("refuses a name that is not one, a base that is not one, and a session that is not there", async () => {
    expect(await (await post("/api/sessions", { name: "Not A Name" })).json()).toMatchObject({
      error: "invalid-name",
    });
    expect(
      await (await post("/api/sessions", { name: "empty-base", base: "branch:" })).json(),
    ).toMatchObject({ error: "invalid-base" });
    const missing = await post("/api/sessions/nope/use", {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "no-such-session" });
  });
});

describe("the export", () => {
  it("writes markdown grouped by repository, open comments by default", async () => {
    const response = await app.request("/api/export");
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const markdown = await response.text();
    expect(markdown).toContain("the flag is read before it is set");

    const all = await (await app.request("/api/export?status=all&format=json")).json();
    const open = await (await app.request("/api/export?format=json")).json();
    expect((all as Comment[]).length).toBeGreaterThan((open as Comment[]).length);
    expect((open as Comment[]).every((one) => one.status === "open")).toBe(true);
  });

  it("refuses a format it does not have", async () => {
    const response = await app.request("/api/export?format=pdf");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  });
});

describe("a write from another process", () => {
  it("shows up in the review the server serves", async () => {
    const server = await startReviewServer({ config: { ...config, port: 0 } });
    try {
      const before = (await (await fetch(`${server.url}/api/review`)).json()) as ReviewDocument;
      const target = before.comments[0] as Comment;
      await run(process.execPath, [appendReply, config.dataDir, SESSION, target.id, "claude"]);

      // The watcher notices the file, the document is dropped, and the next
      // read is the new state; the CLI writes the same way this helper does.
      const deadline = Date.now() + 5_000;
      let replies = 0;
      while (Date.now() < deadline) {
        const document = (await (await fetch(`${server.url}/api/review`)).json()) as ReviewDocument;
        replies = document.comments.find((one) => one.id === target.id)?.replies.length ?? 0;
        if (replies > 0) break;
        await new Promise((done) => setTimeout(done, 25));
      }
      expect(replies).toBe(1);
    } finally {
      await server.close();
    }
  }, 120_000);
});

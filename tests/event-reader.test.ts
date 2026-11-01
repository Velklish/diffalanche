/** The CLI reader's ordering, driven by an in-memory SSE body rather than the watcher. */
import { describe, expect, it } from "vitest";
import { read, writtenReply } from "./helpers/event-reader.ts";

async function channel() {
  let body: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
  );
  const stream = await read("/events", {}, () => response);
  const send = (id: string, commentId = "own-thread") => {
    body.enqueue(
      new TextEncoder().encode(
        `event: reply-added\ndata: ${JSON.stringify({ id, commentId })}\n\n`,
      ),
    );
  };
  return { stream, send };
}

describe("the CLI reply reader", () => {
  it("accepts its reply before the writer promise resolves", async () => {
    const { stream, send } = await channel();
    try {
      const frame = writtenReply(
        stream,
        "own-thread",
        async () => {
          send("unrelated-reply");
          send("own-reply", "another-thread");
          send("own-reply");
          await stream.waitFor("reply-added");
          return "own-reply";
        },
        25,
      );
      await expect(frame).resolves.toMatchObject({
        data: JSON.stringify({ id: "own-reply", commentId: "own-thread" }),
      });
    } finally {
      await stream.close();
    }
  });

  it("accepts its reply after the writer promise resolves", async () => {
    const { stream, send } = await channel();
    try {
      const frame = writtenReply(
        stream,
        "own-thread",
        async () => {
          setTimeout(() => send("own-reply"), 0);
          return "own-reply";
        },
        100,
      );
      expect(JSON.parse((await frame).data)).toEqual({ id: "own-reply", commentId: "own-thread" });
    } finally {
      await stream.close();
    }
  });

  it("rejects an old reply and an unrelated frame when its own reply never arrives", async () => {
    const { stream, send } = await channel();
    try {
      send("own-reply");
      await stream.waitFor("reply-added");
      await expect(
        writtenReply(
          stream,
          "own-thread",
          async () => {
            send("other-reply");
            send("own-reply", "another-thread");
            return "own-reply";
          },
          25,
        ),
      ).rejects.toThrow("no reply-added within 25 ms");
    } finally {
      await stream.close();
    }
  });
});

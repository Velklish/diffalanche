/** One writer of `tests/storage-concurrency.test.ts`, a process of its own so the lock is taken
 * as the UI and the CLI take it (03-storage.md, "What the unit tests hold"). */
import { updateComments } from "../../src/core/storage/index.ts";

const [dataDir, session, commentId, author] = process.argv.slice(2);
if (!dataDir || !session || !commentId || !author) {
  throw new Error("usage: append-reply <dataDir> <session> <commentId> <author>");
}

await updateComments(dataDir, session, (comments) => {
  const comment = comments.find((one) => one.id === commentId);
  if (!comment) throw new Error(`no comment ${commentId} in ${session}`);
  comment.replies.push({
    id: `r_${comment.replies.length + 1}`,
    author,
    role: "agent",
    body: `reply from ${author}`,
    createdAt: new Date().toISOString(),
  });
});

/**
 * One writer of the concurrency test: appends a single reply to one comment
 * through the storage read-modify-write helper. It runs as its own process, so
 * the lock is exercised the way the UI and several CLI processes exercise it —
 * `node tests/helpers/append-reply.ts <dataDir> <session> <commentId> <author>`.
 * Node runs this `.ts` file without a build step, which needs Node >= 22.18,
 * where type stripping is on by default; CI pins Node 22 and the package asks
 * for >= 22.
 */
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

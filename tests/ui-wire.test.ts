import { describe, expect, it } from "vitest";
import type { SessionList, SessionSummary } from "../src/core/domain/types.ts";
import type { BranchCandidate, BranchList } from "../src/server/routes/branches.ts";
import type {
  BranchCandidate as UiBranchCandidate,
  BranchList as UiBranchList,
  SessionList as UiSessionList,
  SessionSummary as UiSessionSummary,
} from "../src/ui/types.ts";

/**
 * Two shapes the UI writes out again instead of importing: the branch list and
 * the session list. Both producers reach the Node API — git for one, the
 * storage barrel for the other — and `src/ui/tsconfig.json` compiles with
 * `"types": []`, so the UI cannot import either module even for its types.
 *
 * This is the guard the comment in `src/ui/types.ts` points at. It is a
 * type-level check: a field added, removed, or retyped on one side and not the
 * other stops the build rather than reaching the browser as `undefined`.
 */

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const branchCandidate: Same<BranchCandidate, UiBranchCandidate> = true;
const branchList: Same<BranchList, UiBranchList> = true;
const sessionSummary: Same<SessionSummary, UiSessionSummary> = true;
const sessionList: Same<SessionList, UiSessionList> = true;

describe("the wire shapes the UI writes out again", () => {
  it("are the same types the server and the domain answer with", () => {
    expect([branchCandidate, branchList, sessionSummary, sessionList]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});

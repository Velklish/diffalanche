import { describe, expect, it } from "vitest";
import type { SessionList, SessionSummary } from "../src/core/domain/types.ts";
import type {
  CandidateFile,
  CandidateRepository,
  CandidateSet,
  ScannedRepository,
  ScanSummary,
} from "../src/server/review.ts";
import type { BranchCandidate, BranchList } from "../src/server/routes/branches.ts";
import type {
  ScannedRepository as UiScannedRepository,
  ScanSummary as UiScanSummary,
} from "../src/ui/store.ts";
import type {
  BranchCandidate as UiBranchCandidate,
  BranchList as UiBranchList,
  CandidateFile as UiCandidateFile,
  CandidateRepository as UiCandidateRepository,
  CandidateSet as UiCandidateSet,
  SessionList as UiSessionList,
  SessionSummary as UiSessionSummary,
} from "../src/ui/types.ts";

/**
 * Four shapes the UI writes out again instead of importing: the branch list,
 * the session list, the scan summary the first-run screen counts its metrics
 * from, and the candidate set the scope editor picks a task out of. Every
 * producer reaches the Node API — git for three of them, the storage barrel for
 * the other — and `src/ui/tsconfig.json` compiles with `"types": []`, so the UI
 * cannot import those modules even for their types.
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
const scannedRepository: Same<ScannedRepository, UiScannedRepository> = true;
const scanSummary: Same<ScanSummary, UiScanSummary> = true;
const candidateFile: Same<CandidateFile, UiCandidateFile> = true;
const candidateRepository: Same<CandidateRepository, UiCandidateRepository> = true;
const candidateSet: Same<CandidateSet, UiCandidateSet> = true;

describe("the wire shapes the UI writes out again", () => {
  it("are the same types the server and the domain answer with", () => {
    expect([
      branchCandidate,
      branchList,
      sessionSummary,
      sessionList,
      scannedRepository,
      scanSummary,
      candidateFile,
      candidateRepository,
      candidateSet,
    ]).toEqual([true, true, true, true, true, true, true, true, true]);
  });
});

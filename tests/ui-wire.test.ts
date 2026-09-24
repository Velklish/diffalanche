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
import type { SuggestAnswer } from "../src/server/suggest.ts";
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
  SuggestAnswer as UiSuggestAnswer,
} from "../src/ui/types.ts";

/** The shapes the UI writes out again, held to the server's and the domain's own at the type level:
 * a field that drifts on one side stops the build ([08-ui.md](../docs/reference/08-ui.md)). */

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
const suggestAnswer: Same<SuggestAnswer, UiSuggestAnswer> = true;

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
      suggestAnswer,
    ]).toEqual([true, true, true, true, true, true, true, true, true, true]);
  });
});

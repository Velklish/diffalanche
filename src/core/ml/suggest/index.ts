/** `suggest`: the comments nearest a text across every review session, and the severity they
 * vote for. The choice of `k`, the weights and the confidence is 09-ml.md, "Suggestions". */
import type { Severity } from "../../storage/index.ts";
import type { Embedder } from "../embed/embedder.ts";
import type { EmbeddingIndex, IndexUpdate, Neighbour } from "../index/index.ts";
import { nearest, updateIndex } from "../index/index.ts";

/** How many comments are shown, and how many vote. */
export const NEIGHBOURS = 5;

/** A neighbour's vote is `exp((similarity − best) / TEMPERATURE)`: one 0.01 less similar
 * than the best counts about a third as much. Chosen by `perf/suggest-vote.ts` (09-ml.md). */
const TEMPERATURE = 0.01;

/** Below this similarity of the nearest comment nothing is proposed: the history holds nothing
 * like the text, and the neighbours' severities say nothing about it. */
const FLOOR = 0.86;

type SeverityProposal = { severity: Severity; confidence: number };

export type Suggestions = {
  suggestions: Neighbour[];
  /** `null` when there is nothing near enough to vote. */
  severity: SeverityProposal | null;
  update: IndexUpdate;
  /** The index the answer was searched in, for a caller that keeps it for the next one. */
  index: EmbeddingIndex;
};

/** The severity with the most weight, and its share of all the weight as the confidence. A severity
 * the model chose and nobody confirmed does not vote, or a history left on `AUTO` confirms itself. */
export function proposeSeverity(
  neighbours: readonly Neighbour[],
  temperature: number = TEMPERATURE,
  floor: number = FLOOR,
): SeverityProposal | null {
  const voters = neighbours.filter((one) => one.severitySource !== "auto");
  const best = voters[0]?.similarity;
  if (best === undefined || best < floor) return null;
  const weights = new Map<Severity, number>();
  let total = 0;
  for (const one of voters) {
    const weight = Math.exp((one.similarity - best) / temperature);
    weights.set(one.severity, (weights.get(one.severity) ?? 0) + weight);
    total += weight;
  }
  let winner: SeverityProposal | null = null;
  for (const [severity, weight] of weights) {
    if (winner === null || weight > winner.confidence) winner = { severity, confidence: weight };
  }
  return winner && { severity: winner.severity, confidence: round(winner.confidence / total) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Brings the index up to date, embeds the text, and answers with its neighbours and their vote. */
export async function suggest(
  dataDir: string,
  embedder: Pick<Embedder, "identity" | "model" | "embed">,
  body: string,
  current?: EmbeddingIndex,
): Promise<Suggestions> {
  const { index, update } = await updateIndex(dataDir, embedder, { current });
  const [query] = await embedder.embed([body]);
  if (query === undefined) throw new Error("the embedder returned no vector");
  const suggestions = nearest(index, query, { k: NEIGHBOURS });
  return { suggestions, severity: proposeSeverity(suggestions), update, index };
}

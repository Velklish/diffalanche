/** The composer's suggestions from history: when the text is worth asking about, and what `AUTO`
 * resolves to ([08-ui.md](../../docs/reference/08-ui.md), "Commenting"). */
import type { Severity, SuggestAnswer } from "./types.ts";

/** How long typing pauses before the text is sent: about one keystroke at 60 words a minute. */
export const SUGGEST_DEBOUNCE_MS = 200;

/** How long a send in `AUTO` waits for the vote: past the cold start under load, short of a hang. */
export const AUTO_WAIT_MS = 10_000;

/** The longest query asked with: 18 040 bytes of URL were a 431 on Node and Bun, 15 640 passed, and
 * the model reads 512 tokens of it anyway (08-ui.md). */
export const SUGGEST_QUERY_LIMIT = 12_000;

/** The text as a query no longer than the limit, cut between characters, never inside one. */
export function suggestQuery(text: string): string {
  const parts: string[] = [];
  let length = 0;
  for (const character of text) {
    const encoded = encodeCharacter(character);
    if (length + encoded.length > SUGGEST_QUERY_LIMIT) break;
    parts.push(encoded);
    length += encoded.length;
  }
  return parts.join("");
}

/** The panel's rows: the five neighbours `GET /api/suggest` answers with, drawn from the start. */
export const SUGGESTION_SLOTS = 5;

/** The handoff ranks by the words longer than three characters; a text with none asks nothing. */
export function wantsSuggestions(text: string): boolean {
  return /[\p{L}\p{N}_]{4,}/u.test(text);
}

/** What `AUTO` stores: the neighbours' vote, and without one the `warning` the form proposes. */
export function autoSeverity(answer: SuggestAnswer | null): Severity {
  return answer?.severity?.severity ?? "warning";
}

/** A lone surrogate is not a character `encodeURIComponent` can write: it is sent as U+FFFD. */
function encodeCharacter(character: string): string {
  try {
    return encodeURIComponent(character);
  } catch {
    return "%EF%BF%BD";
  }
}

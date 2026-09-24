/** How long a toast stays (DA-102.1): the handoff's 2.2 s for a text as short as the ones it drew,
 * growing with the text past them, and never past 10 s (08-ui.md, "Overlay and toast"). */
import { describe, expect, it } from "vitest";
import { lifetime } from "../src/ui/components/Toast.tsx";

describe("a toast's lifetime", () => {
  it("is 2.2 s for the answers the handoff drew", () => {
    expect(lifetime("Markdown скопирован")).toBe(2_200);
    expect(lifetime("Комментарий сохранён в reviews/ls-240372/comments.json")).toBe(2_200);
    expect(lifetime("x".repeat(60))).toBe(2_200);
  });

  it("grows by 50 ms a character past sixty, and stops at 10 s", () => {
    expect(lifetime("x".repeat(61))).toBe(2_250);
    // DA-102's storage refusal.
    expect(lifetime("x".repeat(116))).toBe(5_000);
    expect(lifetime("x".repeat(216))).toBe(10_000);
    expect(lifetime("x".repeat(2_000))).toBe(10_000);
  });
});

/**
 * Who may do what ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)).
 * Agents open comments and answer them; a human closes. The check lives here
 * rather than in the shipped skills, because a skill is advice and an agent
 * that never read one could still close what it may not, and it lives in its
 * own module because both a thread and a review task are closed by the same
 * rule ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
 */
import type { Role } from "../storage/index.ts";
import { DomainError } from "./errors.ts";

/** Who a write is from: the name on it and what wrote it. */
export type Actor = { author: string; role: Role };

/** Refuses anything but a human, naming what was refused and the role it came with. */
export function assertHuman(who: { role: Role }, action: string): void {
  if (who.role !== "human") {
    throw new DomainError(
      "role-not-human",
      `only a human may ${action}; this call came with role "${who.role}"`,
    );
  }
}

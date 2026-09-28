/** Agents open and answer, a human closes ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)),
 * checked here rather than in the skills, for threads and tasks alike (04-domain.md, "Roles"). */
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

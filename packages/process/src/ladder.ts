import type { FailAction } from "./template-schema.js";

/**
 * Which rung applies at the given fail count (1-based).
 * Rungs with `times` absorb that many failures in order; a terminal rung absorbs the rest.
 */
export function rungFor(ladder: FailAction[], failCount: number): FailAction {
  let remaining = failCount;
  for (const rung of ladder) {
    if (!("times" in rung)) return rung;
    if (remaining <= rung.times) return rung;
    remaining -= rung.times;
  }
  return ladder[ladder.length - 1]!;
}

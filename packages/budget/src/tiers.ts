import type { BudgetTier } from "@karigor/store";

/** Which model does which kind of work at a tier. */
export interface TierModels {
  /** Decisions, reviews, and the retry of a piece that failed its checks. */
  judgment: string;
  /** Routine work, such as the release notes. */
  routine: string;
  /** The developer's first try at a piece. */
  build: string;
}

/**
 * The tier picks the models, on a subscription as much as on a key.
 * - best: the strongest model decides and reviews, a strong one builds.
 * - cheap: a strong mid-priced model decides and reviews, the cheapest one builds; a piece that
 *   fails its checks is retried by the stronger model, so the dear one is only paid for when needed.
 */
export const TIER_MODELS: Record<Exclude<BudgetTier, "free">, TierModels> = {
  best: { judgment: "claude-opus-5-5", routine: "claude-haiku-5-5", build: "claude-sonnet-5-5" },
  cheap: { judgment: "claude-sonnet-5-5", routine: "claude-haiku-5-5", build: "claude-haiku-5-5" },
};

/** Models for a tier. "free" is for local models; on a Claude provider it means the cheap models. */
export function modelsFor(tier: BudgetTier): TierModels {
  return TIER_MODELS[tier === "free" ? "cheap" : tier];
}

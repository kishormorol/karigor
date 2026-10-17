import type { BudgetTier, Role } from "@karigor/store";
import type { Template } from "@karigor/process";
import { costOf, round } from "./prices.js";

/** Expected tokens for one call of a role. Rough priors; refined by real ledgers later. */
export const ROLE_PRIORS: Record<Role, { inputTokens: number; outputTokens: number }> = {
  selector: { inputTokens: 3_000, outputTokens: 400 },
  estimator: { inputTokens: 3_000, outputTokens: 400 },
  "product-owner": { inputTokens: 4_000, outputTokens: 2_500 },
  architect: { inputTokens: 8_000, outputTokens: 2_500 },
  planner: { inputTokens: 10_000, outputTokens: 3_000 },
  developer: { inputTokens: 30_000, outputTokens: 8_000 },
  reviewer: { inputTokens: 20_000, outputTokens: 1_200 },
  skeptic: { inputTokens: 20_000, outputTokens: 1_200 },
  releaser: { inputTokens: 10_000, outputTokens: 1_500 },
};

/** Which roles need the judgment tier when money is available. */
export const JUDGMENT_ROLES: ReadonlySet<Role> = new Set<Role>(["product-owner", "architect", "planner", "reviewer", "skeptic", "selector", "estimator"]);

export interface EstimateOptions {
  /** How many backlog items the planner is expected to produce. */
  expectedItems?: number;
  /** Expected attempts per item (retries included). */
  attemptsPerItem?: number;
  /** Safety multiplier on the final numbers. */
  margin?: number;
  judgmentModel?: string;
  routineModel?: string;
  /** Model used when the user picks the free tier (local or mock). */
  freeModel?: string;
}

export interface TierEstimate {
  tier: BudgetTier;
  currency: string;
  total: number;
  phaseBudgets: Record<string, number>;
  /** Plain-language description for the user. */
  description: string;
  models: { judgment: string; routine: string };
}

interface PhaseCalls {
  judgment: { inputTokens: number; outputTokens: number };
  routine: { inputTokens: number; outputTokens: number };
}

/** Expected token volume per phase, split by which tier each call would want. */
export function phaseVolumes(template: Template, opts: EstimateOptions = {}): Record<string, PhaseCalls> {
  const items = opts.expectedItems ?? 8;
  const attempts = opts.attemptsPerItem ?? 1.4;
  const out: Record<string, PhaseCalls> = {};
  const add = (phase: string, role: Role, times: number) => {
    const v = (out[phase] ??= { judgment: { inputTokens: 0, outputTokens: 0 }, routine: { inputTokens: 0, outputTokens: 0 } });
    const bucket = JUDGMENT_ROLES.has(role) ? v.judgment : v.routine;
    const p = ROLE_PRIORS[role];
    bucket.inputTokens += p.inputTokens * times;
    bucket.outputTokens += p.outputTokens * times;
  };
  // kernel-level calls before the first phase are booked to the initial phase
  add(template.initialPhase, "selector", 1);
  add(template.initialPhase, "estimator", 1);
  for (const [name, phase] of Object.entries(template.phases)) {
    for (const role of phase.roles) add(name, role, 1.2);
    for (const tr of phase.transitions) for (const g of tr.gates) if (isJudgedGate(g)) add(name, g === "skeptic-review" ? "skeptic" : "reviewer", 1.2);
    if (phase.loop) {
      for (const role of phase.loop.itemRoles) add(name, role, items * attempts);
      for (const g of phase.loop.itemGates) if (isJudgedGate(g)) add(name, g === "skeptic-review" ? "skeptic" : "reviewer", items * attempts);
    }
  }
  return out;
}

function isJudgedGate(g: string): boolean {
  return g === "spec-complete" || g === "architecture-sound" || g === "diff-matches-spec" || g === "skeptic-review";
}

/** Three tiers the user chooses from once. Free is always exactly zero. */
export function estimate(template: Template, opts: EstimateOptions = {}): TierEstimate[] {
  const judgment = opts.judgmentModel ?? "claude-opus-5-5";
  const routine = opts.routineModel ?? "claude-haiku-5-5";
  const free = opts.freeModel ?? "ollama/local";
  const margin = opts.margin ?? 1.5;
  const volumes = phaseVolumes(template, opts);
  const build = (tier: BudgetTier, models: { judgment: string; routine: string }, description: string): TierEstimate => {
    const phaseBudgets: Record<string, number> = {};
    let total = 0;
    for (const [phase, v] of Object.entries(volumes)) {
      const c = costOf({ ...v.judgment, cacheReadTokens: 0, cacheWriteTokens: 0 }, models.judgment) + costOf({ ...v.routine, cacheReadTokens: 0, cacheWriteTokens: 0 }, models.routine);
      phaseBudgets[phase] = round(c * margin);
      total += phaseBudgets[phase]!;
    }
    return { tier, currency: "USD", total: round(total), phaseBudgets, description, models };
  };
  return [
    build("free", { judgment: free, routine: free }, "Runs on a free local model. Costs nothing. Slower and less reliable; expect more parked items."),
    build("cheap", { judgment: routine, routine }, "Uses the cheapest cloud model for everything. Good for small, simple ideas."),
    build("best", { judgment, routine }, "Uses the strongest model for decisions and reviews, the cheap one for routine work. Best chance of a working result."),
  ];
}

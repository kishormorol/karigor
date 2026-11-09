import type { BudgetTier, Role } from "@karigor/store";
import type { Template } from "@karigor/process";
import { costOf, round, type Usage } from "./prices.js";
import { TIER_MODELS, type TierModels } from "./tiers.js";

/**
 * Expected tokens for one call of a role, from a real build (docs/runs/2026-11-09-shop-counter.md).
 * `inputTokens` is everything sent. The developer works over many turns, so most of what it sends
 * is read back from cache; the other roles ask once and cache nothing.
 */
export const ROLE_PRIORS: Record<Role, Usage> = {
  selector: one(4_000, 1_000),
  estimator: one(4_000, 1_000),
  "product-owner": one(15_000, 14_000),
  architect: one(35_000, 30_000),
  planner: one(45_000, 8_000),
  developer: { inputTokens: 930_000, outputTokens: 10_000, cacheReadTokens: 870_000, cacheWriteTokens: 57_000 },
  reviewer: one(40_000, 4_000),
  skeptic: one(40_000, 4_500),
  releaser: one(25_000, 2_500),
};

function one(inputTokens: number, outputTokens: number): Usage {
  return { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

/** Which roles need the judgment tier when money is available. */
export const JUDGMENT_ROLES: ReadonlySet<Role> = new Set<Role>(["product-owner", "architect", "planner", "reviewer", "skeptic", "selector", "estimator"]);

export interface EstimateOptions {
  /** How many backlog items the planner is expected to produce. */
  expectedItems?: number;
  /** Expected attempts per item (retries included). */
  attemptsPerItem?: number;
  /** Safety multiplier on the final numbers. */
  margin?: number;
  /** A provider that costs nothing per call (a subscription, a local model, the demo): every call is priced as this model, so every budget is zero. */
  flatModel?: string;
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
  models: TierModels;
}

type Bucket = keyof TierModels;
type PhaseCalls = Record<Bucket, Usage>;

/** Expected token volume per phase, split by which of the tier's models each call would run on. */
export function phaseVolumes(template: Template, opts: EstimateOptions = {}): Record<string, PhaseCalls> {
  const items = opts.expectedItems ?? 12;
  const attempts = opts.attemptsPerItem ?? 1.4;
  const out: Record<string, PhaseCalls> = {};
  const add = (phase: string, role: Role, times: number, bucket: Bucket = role === "developer" ? "build" : JUDGMENT_ROLES.has(role) ? "judgment" : "routine") => {
    const v = (out[phase] ??= { judgment: one(0, 0), routine: one(0, 0), build: one(0, 0) })[bucket];
    const p = ROLE_PRIORS[role];
    v.inputTokens += p.inputTokens * times;
    v.outputTokens += p.outputTokens * times;
    v.cacheReadTokens += p.cacheReadTokens * times;
    v.cacheWriteTokens += p.cacheWriteTokens * times;
  };
  // kernel-level calls before the first phase are booked to the initial phase
  add(template.initialPhase, "selector", 1);
  add(template.initialPhase, "estimator", 1);
  for (const [name, phase] of Object.entries(template.phases)) {
    for (const role of phase.roles) add(name, role, 1.2);
    for (const tr of phase.transitions) for (const g of tr.gates) if (isJudgedGate(g)) add(name, g === "skeptic-review" ? "skeptic" : "reviewer", 1.2);
    if (phase.loop) {
      for (const role of phase.loop.itemRoles) {
        if (role === "developer") {
          // A first try runs on the build model; a piece that failed its checks is retried by the judgment model.
          add(name, role, items, "build");
          add(name, role, items * Math.max(0, attempts - 1), "judgment");
        } else add(name, role, items * attempts);
      }
      for (const g of phase.loop.itemGates) if (isJudgedGate(g)) add(name, g === "skeptic-review" ? "skeptic" : "reviewer", items * attempts);
    }
  }
  return out;
}

function isJudgedGate(g: string): boolean {
  return g === "spec-complete" || g === "architecture-sound" || g === "diff-matches-spec" || g === "skeptic-review";
}

/** The least a paid phase is given, in currency units. */
export const MIN_PHASE_BUDGET = 0.05;

/** Three tiers the user chooses from once. Free is always exactly zero. */
export function estimate(template: Template, opts: EstimateOptions = {}): TierEstimate[] {
  const free = opts.freeModel ?? "ollama/local";
  const margin = opts.margin ?? 1.5;
  const volumes = phaseVolumes(template, opts);
  const all = (model: string): TierModels => ({ judgment: model, routine: model, build: model });
  const build = (tier: BudgetTier, models: TierModels, description: string): TierEstimate => {
    const phaseBudgets: Record<string, number> = {};
    let total = 0;
    for (const [phase, v] of Object.entries(volumes)) {
      const c = costOf(v.judgment, models.judgment) + costOf(v.routine, models.routine) + costOf(v.build, models.build);
      // A small phase (one cheap call) still needs room for a retry: never stop a project for want of a cent.
      phaseBudgets[phase] = c > 0 ? Math.max(round(c * margin), MIN_PHASE_BUDGET) : 0;
      total += phaseBudgets[phase]!;
    }
    return { tier, currency: "USD", total: round(total), phaseBudgets, description, models };
  };
  const paid = (tier: "cheap" | "best") => (opts.flatModel ? all(opts.flatModel) : TIER_MODELS[tier]);
  return [
    build("free", all(free), "Runs on a free local model. Costs nothing. Slower and less reliable; expect more parked items."),
    build("cheap", paid("cheap"), "A strong mid-priced model decides and reviews; the cheapest one builds, and a piece that fails its checks is retried by the stronger one. A fraction of the cost of best."),
    build("best", paid("best"), "The strongest model decides and reviews, and a strong one builds. Best chance of a working result."),
  ];
}
